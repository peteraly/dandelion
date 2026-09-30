/**
 * Service-layer plumbing: errors, transactions, the ledger writer hook,
 * audit/security logging, and settings. Every state change and its
 * LedgerEvent are written in the SAME transaction (§5).
 */
import { now } from "@/lib/clock";
import type { AdminAction, SecurityEventType } from "@/lib/domain/events";
import { and, eq, sql } from "drizzle-orm";
import { getDb, type DbOrTx, type Tx } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import { canonicalJson, leafHash, newSalt, type LedgerFact } from "@/lib/ledger/leaf";
import { tzDay } from "@/lib/util/time";
import type { ActorKind, LedgerEventType } from "@/lib/domain/types";
import { sha256Hex } from "@/lib/crypto/random";

/** A failure the user can understand. `code` is an i18n key under "errors". */
export class DomainError extends Error {
  constructor(
    public readonly code: string,
    message?: string,
  ) {
    super(message ?? code);
    this.name = "DomainError";
  }
}

export interface ServiceActor {
  kind: ActorKind;
  userId: string | null;
}

export const SYSTEM: ServiceActor = { kind: "SYSTEM", userId: null };
export const VERIFIER: ServiceActor = { kind: "SYSTEM_VERIFIER", userId: null };
export const APPROVALS: ServiceActor = { kind: "SYSTEM_APPROVALS", userId: null };

export async function withTx<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return getDb().transaction(fn);
}

/** Mark this transaction as the verification job (DB trigger guard, §3.1). */
export async function actAsVerifier(tx: Tx): Promise<void> {
  await tx.execute(sql`select set_config('app.verifier', 'on', true)`);
}

/** Mark this transaction as the dual-approval executor (DB trigger guard, §3.4/§3.5). */
export async function actAsApprovals(tx: Tx): Promise<void> {
  await tx.execute(sql`select set_config('app.approvals', 'on', true)`);
}

// ---------- ledger ----------

export interface LedgerInput {
  type: LedgerEventType;
  subjectRef: string;
  orderId?: string | null;
  batchId?: string | null;
  amountTzs?: number | null;
  role?: string | null;
  at?: Date;
}

/** Append a LedgerEvent inside the caller's transaction. */
export async function recordLedgerEvent(tx: DbOrTx, e: LedgerInput): Promise<void> {
  const date = tzDay(e.at ?? now());
  const fact: LedgerFact = { type: e.type, ref: e.subjectRef, amountTzs: e.amountTzs ?? null, role: e.role ?? null, date };
  const canonical = canonicalJson(fact);
  const salt = newSalt();
  await tx.insert(s.ledgerEvents).values({
    type: e.type,
    subjectRef: e.subjectRef,
    orderId: e.orderId ?? null,
    batchId: e.batchId ?? null,
    canonical,
    salt,
    leafHash: leafHash(canonical, salt),
    eventDate: date,
  });
}

// ---------- logs ----------

export async function logAdminAction(
  tx: DbOrTx,
  adminId: string | null,
  action: AdminAction,
  target: { type?: string; id?: string } = {},
  details: Record<string, unknown> = {},
  highlighted = false,
): Promise<void> {
  await tx.insert(s.adminActionLog).values({
    adminId,
    action,
    targetType: target.type ?? null,
    targetId: target.id ?? null,
    details,
    highlighted,
  });
}

export type SecuritySeverity = "INFO" | "WARN" | "ALERT";

export async function logSecurityEvent(
  tx: DbOrTx,
  type: SecurityEventType,
  severity: SecuritySeverity,
  opts: { userId?: string | null; subjectIndex?: string | null; ip?: string | null; details?: Record<string, unknown> } = {},
): Promise<void> {
  await tx.insert(s.securityEventLog).values({
    type,
    severity,
    userId: opts.userId ?? null,
    subjectIndex: opts.subjectIndex ?? null,
    ipHash: opts.ip ? sha256Hex(`ip:${opts.ip}`).slice(0, 32) : null,
    details: opts.details ?? {},
  });
}

// ---------- settings ----------

export const SETTING_DEFAULTS = {
  /** Distinct admins (requester included) needed to approve. Recommended 2-of-3. */
  approvalThreshold: 2,
  /** Monthly cap on approved donor funding, TZS. */
  donorMonthlyCapTzs: 500_000,
  /** Days without a confirmed payment before a plan shows as paused. */
  customerPauseDays: 14,
  /** Exports above this many rows need dual approval. */
  largeExportRows: 100,
  /** Retention, days. */
  retentionSecurityLogDays: 365,
  retentionSessionsDays: 30,
  retentionOtpDays: 7,
  /** Minutes a payment may stay pending before it is flagged. */
  paymentPendingAlertMinutes: 60,
  /** Wallet low-balance alert threshold (wei, as a decimal string). */
  walletLowBalanceWei: "100000000000000000",
  /** AI monthly budget in US cents. */
  aiMonthlyBudgetCents: 2000,
  /** Education assistant stays off until the pack is approved. */
  educationPackApproved: false,
  /** Which seed populated this database ("" = none, "minimal", "demo"); drives the simulated-data banner. */
  seedProfile: "",
  demoScale: "",
  demoSeed: "",
  /** JSON manifest of the deliberate anomalies the demo generator created. */
  demoManifest: "",
  /** Number of "simulate time" ticks run on this database. */
  demoTicks: 0,
  /** The deliveries the "one hour" tick moves one step at a time (a JSON list of order ids; lib/demo/live.ts). */
  demoLiveOrders: "",
  /** When the live district last took a step (ISO time; lib/demo/tick.ts). */
  demoLastLiveAt: "",
  /** Why the last build could not make the demo district (scripts/seed.ts); shown on the admin home. */
  demoSeedError: "",
  /** A setup note from the last seed, e.g. a preview's derived sign-in secret (lib/seed-identities.ts); shown on the admin home. */
  seedNotice: "",
} as const;

export type SettingKey = keyof typeof SETTING_DEFAULTS;
type SettingValue<K extends SettingKey> = (typeof SETTING_DEFAULTS)[K] extends number
  ? number
  : (typeof SETTING_DEFAULTS)[K] extends boolean
    ? boolean
    : string;

export async function getSetting<K extends SettingKey>(k: K, tx: DbOrTx = getDb()): Promise<SettingValue<K>> {
  const row = await tx.query.settings.findFirst({ where: eq(s.settings.key, k) });
  return (row ? row.value : SETTING_DEFAULTS[k]) as SettingValue<K>;
}

export async function putSetting(tx: DbOrTx, k: SettingKey, value: unknown, by: string | null): Promise<void> {
  await tx
    .insert(s.settings)
    .values({ key: k, value: value as object, updatedBy: by })
    .onConflictDoUpdate({ target: s.settings.key, set: { value: value as object, updatedBy: by, updatedAt: now() } });
}

// ---------- idempotency (§5) ----------

/**
 * Run `fn` at most once per (user, key). The key row is inserted in the same
 * transaction as the mutation, so a failed attempt releases the key; a
 * concurrent duplicate blocks on the unique index and then sees the result.
 */
export async function idempotent<T extends object | null>(
  userId: string | null,
  clientKey: string | undefined,
  action: string,
  fn: (tx: Tx) => Promise<T>,
): Promise<{ result: T; replayed: boolean }> {
  if (!clientKey || !/^[A-Za-z0-9_-]{8,64}$/.test(clientKey)) throw new DomainError("missing_idempotency_key");
  const key = `${userId ?? "anon"}:${clientKey}`;
  const existing = await getDb().query.idempotencyKeys.findFirst({ where: eq(s.idempotencyKeys.key, key) });
  if (existing) {
    if (existing.action !== action) throw new DomainError("idempotency_key_reused");
    return { result: existing.response as T, replayed: true };
  }
  try {
    return await withTx(async (tx) => {
      await tx.insert(s.idempotencyKeys).values({ key, userId, action, response: null });
      const result = await fn(tx);
      await tx.update(s.idempotencyKeys).set({ response: result as object }).where(and(eq(s.idempotencyKeys.key, key)));
      return { result, replayed: false };
    });
  } catch (e) {
    if (isUniqueViolation(e)) {
      const row = await getDb().query.idempotencyKeys.findFirst({ where: eq(s.idempotencyKeys.key, key) });
      if (row) return { result: row.response as T, replayed: true };
    }
    throw e;
  }
}

export function isUniqueViolation(e: unknown): boolean {
  const err = e as { code?: string; cause?: { code?: string } };
  return err?.code === "23505" || err?.cause?.code === "23505";
}

export function pgErrorMessage(e: unknown): string {
  const err = e as { message?: string; cause?: { message?: string } };
  return err?.cause?.message ?? err?.message ?? String(e);
}
