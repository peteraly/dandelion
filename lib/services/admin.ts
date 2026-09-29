/**
 * Admin dashboard reads and exports (handbook §13). Every function checks
 * the policy first. Exports are logged as security events; large exports
 * need an executed dual approval.
 */
import { now, nowMs } from "@/lib/clock";
import { and, desc, eq, gte, inArray, isNull, lt, ne, or, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import { authorize, type Actor } from "@/lib/policy";
import { decryptString } from "@/lib/crypto/envelope";
import { maskPhone } from "@/lib/phone";
import { DomainError, getSetting, logAdminAction, logSecurityEvent, withTx } from "./core";
import { unanchoredCount, walletStatus } from "@/lib/ledger/anchor";

export interface Priorities {
  paymentsReview: number;
  deliveriesInspection: number;
  lowStockHubs: number;
  pendingApprovals: number;
  openExceptions: number;
  reconFlags: number;
  ledgerUnanchored: number;
  wallet: Awaited<ReturnType<typeof walletStatus>>;
  alerts24h: number;
}

export async function priorities(actor: Actor): Promise<Priorities> {
  authorize(actor, "admin.dashboard");
  const db = getDb();
  const count = async (q: Promise<{ n: number }[]>) => Number((await q)[0]?.n ?? 0);
  const paymentsReview = await count(db.select({ n: sql<number>`count(*)::int` }).from(s.paymentIntents).where(eq(s.paymentIntents.status, "PAYMENT_FAILED_OR_REVIEW")));
  const deliveriesInspection = await count(
    db.select({ n: sql<number>`count(*)::int` }).from(s.orders).where(and(eq(s.orders.kind, "RIDER_TO_HUB"), inArray(s.orders.state, ["EN_ROUTE", "INSPECTING"]))),
  );
  const hubs = await db.query.hubs.findMany({ where: eq(s.hubs.active, true) });
  let lowStockHubs = 0;
  for (const h of hubs) {
    const n = await count(db.select({ n: sql<number>`coalesce(sum(${s.batches.quantity}),0)::int` }).from(s.batches).where(and(eq(s.batches.hubId, h.id), eq(s.batches.custodyState, "AVAILABLE_AT_HUB"))));
    if (n < h.minStockUnits) lowStockHubs++;
  }
  const pendingApprovals = await count(db.select({ n: sql<number>`count(*)::int` }).from(s.approvalRequests).where(eq(s.approvalRequests.status, "PENDING")));
  const openExceptions = await count(db.select({ n: sql<number>`count(*)::int` }).from(s.exceptions).where(ne(s.exceptions.status, "RESOLVED")));
  const reconFlags = await count(db.select({ n: sql<number>`count(*)::int` }).from(s.reconciliationFlags).where(isNull(s.reconciliationFlags.resolvedAt)));
  const alerts24h = await count(
    db.select({ n: sql<number>`count(*)::int` }).from(s.securityEventLog).where(and(eq(s.securityEventLog.severity, "ALERT"), gte(s.securityEventLog.createdAt, new Date(nowMs() - 86_400_000)))),
  );
  return { paymentsReview, deliveriesInspection, lowStockHubs, pendingApprovals, openExceptions, reconFlags, ledgerUnanchored: await unanchoredCount(), wallet: await walletStatus(), alerts24h };
}

export async function listUsers(actor: Actor) {
  authorize(actor, "admin.user.view");
  const rows = await getDb().query.users.findMany({ where: ne(s.users.status, "REMOVED"), orderBy: [s.users.role, s.users.displayName] });
  return Promise.all(rows.map(async (u) => ({ ...u, phoneMasked: maskPhone(await decryptString(u.phoneEnc)) })));
}

export async function referenceData(actor: Actor) {
  authorize(actor, "admin.dashboard");
  const db = getDb();
  return {
    areas: await db.query.serviceAreas.findMany(),
    hubs: await db.query.hubs.findMany(),
    suppliers: await db.query.suppliers.findMany(),
    products: await db.query.products.findMany(),
    riders: await db.query.users.findMany({ where: and(eq(s.users.role, "BOSS_RIDER"), eq(s.users.status, "ACTIVE")) }),
  };
}

export async function recentOrders(actor: Actor, limit = 100) {
  authorize(actor, "admin.dashboard");
  return getDb()
    .select({ o: s.orders, product: s.products.name })
    .from(s.orders)
    .innerJoin(s.products, eq(s.products.id, s.orders.productId))
    .orderBy(desc(s.orders.updatedAt))
    .limit(limit);
}

export async function paymentsInReview(actor: Actor) {
  authorize(actor, "admin.dashboard");
  return getDb()
    .select({ intent: s.paymentIntents, ref: s.orders.ref, orderId: s.orders.id })
    .from(s.paymentIntents)
    .innerJoin(s.orders, eq(s.orders.id, s.paymentIntents.orderId))
    .where(eq(s.paymentIntents.status, "PAYMENT_FAILED_OR_REVIEW"))
    .orderBy(desc(s.paymentIntents.updatedAt))
    .limit(100);
}

export async function inventoryByCustodian(actor: Actor) {
  authorize(actor, "admin.dashboard");
  return getDb()
    .select({ batch: s.batches, product: s.products.name, custodian: s.users.displayName, role: s.users.role })
    .from(s.batches)
    .innerJoin(s.products, eq(s.products.id, s.batches.productId))
    .leftJoin(s.users, eq(s.users.id, s.batches.custodianUserId))
    .where(or(gte(s.batches.quantity, 1), inArray(s.batches.custodyState, ["INSPECTION_ISSUE", "DAMAGED_OR_QUARANTINED"])))
    .orderBy(s.users.role, desc(s.batches.updatedAt));
}

export async function adminLog(actor: Actor, limit = 200) {
  authorize(actor, "admin.logs.view");
  return getDb().query.adminActionLog.findMany({ orderBy: desc(s.adminActionLog.id), limit });
}

export async function securityLog(actor: Actor, limit = 200) {
  authorize(actor, "admin.logs.view");
  return getDb().query.securityEventLog.findMany({ orderBy: desc(s.securityEventLog.id), limit });
}

export async function alertThresholds(actor: Actor) {
  authorize(actor, "admin.logs.view");
  const since = new Date(nowMs() - 86_400_000);
  const rows = await getDb()
    .select({ type: s.securityEventLog.type, n: sql<number>`count(*)::int` })
    .from(s.securityEventLog)
    .where(gte(s.securityEventLog.createdAt, since))
    .groupBy(s.securityEventLog.type);
  const thresholds: Record<string, number> = { PIN_FAILED: 20, PIN_TEMP_LOCKOUT: 3, OTP_BURST: 1, OTP_NEW_DEVICE: 3, CALLBACK_REJECTED: 5, CALLBACK_RATE_LIMITED: 1, CALLBACK_SPOOFED: 1, ADMIN_2FA_FAILED: 3, SELF_APPROVAL_ATTEMPT: 1, EXPORT: 5 };
  return rows.map((r) => ({ type: r.type, count: Number(r.n), threshold: thresholds[r.type] ?? null, breached: thresholds[r.type] !== undefined && Number(r.n) >= thresholds[r.type]! }));
}

export async function reconOverview(actor: Actor) {
  authorize(actor, "admin.dashboard");
  const db = getDb();
  return {
    lastRun: await db.query.reconciliationRuns.findFirst({ orderBy: desc(s.reconciliationRuns.createdAt) }),
    flags: await db
      .select({ flag: s.reconciliationFlags, ref: s.orders.ref })
      .from(s.reconciliationFlags)
      .leftJoin(s.orders, eq(s.orders.id, s.reconciliationFlags.orderId))
      .where(isNull(s.reconciliationFlags.resolvedAt))
      .orderBy(desc(s.reconciliationFlags.createdAt))
      .limit(200),
  };
}

export async function resolveReconFlag(actor: Actor, flagId: string): Promise<void> {
  authorize(actor, "admin.dashboard");
  await withTx(async (tx) => {
    await tx.update(s.reconciliationFlags).set({ resolvedAt: now(), resolvedBy: actor.userId }).where(eq(s.reconciliationFlags.id, flagId));
    await logAdminAction(tx, actor.userId, "recon.flag.resolve", { type: "recon_flag", id: flagId });
  });
}

// ---------- exports ----------

export const EXPORT_DATASETS = ["orders", "payments", "exceptions", "stakeholders", "ledger"] as const;
export type ExportDataset = (typeof EXPORT_DATASETS)[number];

function csv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return "";
  const cols = Object.keys(rows[0]!);
  const esc = (v: unknown) => {
    const str = v instanceof Date ? v.toISOString() : v === null || v === undefined ? "" : String(v);
    return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
  };
  return [cols.join(","), ...rows.map((r) => cols.map((c) => esc(r[c])).join(","))].join("\n");
}

async function exportRows(dataset: ExportDataset): Promise<Record<string, unknown>[]> {
  const db = getDb();
  switch (dataset) {
    case "orders":
      return (await db.query.orders.findMany({ orderBy: desc(s.orders.createdAt) })).map((o) => ({
        ref: o.ref,
        kind: o.kind,
        state: o.state,
        quantity: o.quantity,
        unit_price_tzs: o.unitPriceTzs,
        total_tzs: o.totalTzs,
        created_at: o.createdAt,
        completed_at: o.completedAt,
      }));
    case "payments":
      return (
        await db
          .select({ i: s.paymentIntents, ref: s.orders.ref })
          .from(s.paymentIntents)
          .innerJoin(s.orders, eq(s.orders.id, s.paymentIntents.orderId))
          .orderBy(desc(s.paymentIntents.createdAt))
      ).map(({ i, ref }) => ({
        order_ref: ref,
        purpose: i.purpose,
        provider: i.provider,
        status: i.status,
        amount_tzs: i.amountTzs,
        confirmed_amount_tzs: i.confirmedAmountTzs,
        provider_tx_ref: i.providerTxRef,
        payee_account: i.payeeAccount,
        confirmed_at: i.confirmedAt,
        review_reason: i.reviewReason,
      }));
    case "exceptions":
      return (await db.query.exceptions.findMany({ orderBy: desc(s.exceptions.createdAt) })).map((e) => ({ ref: e.ref, type: e.type, status: e.status, locked_batch: e.lockedBatch, created_at: e.createdAt, resolved_at: e.resolvedAt, resolution: e.resolution }));
    case "stakeholders":
      // No phone numbers in exports.
      return (await db.query.users.findMany()).map((u) => ({ display_name: u.displayName, role: u.role, status: u.status, enrolled_at: u.enrolledAt }));
    case "ledger":
      return (await db.query.ledgerEvents.findMany({ orderBy: s.ledgerEvents.id })).map((e) => ({ id: e.id, type: e.type, subject_ref: e.subjectRef, event_date: e.eventDate, leaf_hash: e.leafHash }));
  }
}

export async function exportCsv(actor: Actor, datasetRaw: string, approvalRequestId?: string): Promise<{ filename: string; content: string; rows: number }> {
  const dataset = z.enum(EXPORT_DATASETS).parse(datasetRaw);
  authorize(actor, "admin.export.small");
  const rows = await exportRows(dataset);
  const limit = await getSetting("largeExportRows");
  if (rows.length > limit) {
    authorize(actor, "admin.export.large");
    if (!approvalRequestId) throw new DomainError("large_export_needs_approval");
    const req = await getDb().query.approvalRequests.findFirst({ where: eq(s.approvalRequests.id, approvalRequestId) });
    const payload = req?.payload as { dataset?: string } | undefined;
    if (!req || req.type !== "LARGE_EXPORT" || req.status !== "EXECUTED" || payload?.dataset !== dataset) throw new DomainError("large_export_needs_approval");
    if (req.executedAt && req.executedAt < new Date(nowMs() - 24 * 60 * 60_000)) throw new DomainError("large_export_needs_approval");
  }
  await withTx(async (tx) => {
    await logAdminAction(tx, actor.userId, "export.csv", { type: "dataset", id: dataset }, { rows: rows.length, approvalRequestId: approvalRequestId ?? null });
    await logSecurityEvent(tx, "EXPORT", "INFO", { userId: actor.userId, details: { dataset, rows: rows.length } });
  });
  return { filename: `dandelion-${dataset}-${now().toISOString().slice(0, 10)}.csv`, content: csv(rows), rows: rows.length };
}

// ---------- data requests (§4.12) ----------

export async function createDataRequest(actor: Actor, input: { kind: "CORRECTION" | "DELETION"; subjectType: "USER" | "CUSTOMER"; subjectId: string; details: string }): Promise<void> {
  authorize(actor, "admin.data_request.handle");
  const parsed = z.object({ kind: z.enum(["CORRECTION", "DELETION"]), subjectType: z.enum(["USER", "CUSTOMER"]), subjectId: z.string().uuid(), details: z.string().trim().min(3).max(1000) }).parse(input);
  await withTx(async (tx) => {
    await tx.insert(s.dataRequests).values({ ...parsed, createdBy: actor.userId });
    await logAdminAction(tx, actor.userId, "data_request.create", { type: parsed.subjectType.toLowerCase(), id: parsed.subjectId }, { kind: parsed.kind });
  });
}

/**
 * Handle a request. Deletion pseudonymises the subject: name replaced, phone
 * ciphertext and blind index replaced with random values (unlinkable), the
 * row itself kept so financial records stay consistent. Ledger leaves never
 * carried personal data.
 */
export async function handleDataRequest(actor: Actor, requestId: string, outcome: "DONE" | "DECLINED", note: string): Promise<void> {
  authorize(actor, "admin.data_request.handle");
  await withTx(async (tx) => {
    const req = await tx.query.dataRequests.findFirst({ where: eq(s.dataRequests.id, requestId) });
    if (!req || req.status !== "OPEN") throw new DomainError("not_found");
    if (outcome === "DONE" && req.kind === "DELETION") {
      const tomb = `deleted-${crypto.randomUUID()}`;
      if (req.subjectType === "CUSTOMER") {
        await tx.update(s.customers).set({ displayName: "[deleted]", phoneEnc: tomb, phoneIndex: tomb, status: "DELETED", updatedAt: now() }).where(eq(s.customers.id, req.subjectId));
      } else {
        const u = await tx.query.users.findFirst({ where: eq(s.users.id, req.subjectId) });
        if (u && u.role === "SUPER_ADMIN") throw new DomainError("cannot_delete_admin");
        await tx.update(s.users).set({ displayName: "[deleted]", phoneEnc: tomb, phoneIndex: tomb, status: "REMOVED", pinHash: null, updatedAt: now() }).where(eq(s.users.id, req.subjectId));
        await tx.update(s.sessions).set({ revokedAt: now() }).where(eq(s.sessions.userId, req.subjectId));
      }
    }
    await tx.update(s.dataRequests).set({ status: outcome, handledBy: actor.userId, closedAt: now(), details: `${req.details}\n---\n${note.slice(0, 500)}` }).where(eq(s.dataRequests.id, requestId));
    await logAdminAction(tx, actor.userId, "data_request.handle", { type: "data_request", id: requestId }, { outcome, kind: req.kind });
  });
}

export async function openDataRequests(actor: Actor) {
  authorize(actor, "admin.data_request.handle");
  return getDb().query.dataRequests.findMany({ orderBy: desc(s.dataRequests.createdAt), limit: 100 });
}

/** Retention purge (settings-driven). Called by the daily cron. */
export async function retentionPurge(): Promise<{ sessions: number; otps: number; securityEvents: number }> {
  const db = getDb();
  const sessDays = await getSetting("retentionSessionsDays");
  const otpDays = await getSetting("retentionOtpDays");
  const secDays = await getSetting("retentionSecurityLogDays");
  const sessions = (await db.delete(s.sessions).where(lt(s.sessions.expiresAt, new Date(nowMs() - sessDays * 86_400_000))).returning({ id: s.sessions.id })).length;
  const otps = (await db.delete(s.otpChallenges).where(lt(s.otpChallenges.createdAt, new Date(nowMs() - otpDays * 86_400_000))).returning({ id: s.otpChallenges.id })).length;
  const securityEvents = await withTx(async (tx) => {
    await tx.execute(sql`select set_config('app.retention_purge', 'on', true)`);
    const r = await tx.execute(sql`delete from security_event_log where created_at < now() - make_interval(days => ${secDays})`);
    return Number(r.rowCount ?? 0);
  });
  return { sessions, otps, securityEvents };
}
