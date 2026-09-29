/**
 * Daily reconciliation (handbook §15, build prompt §8): payments ↔ custody
 * events ↔ handovers. Deterministic rules; flags feed the admin brief and
 * the "under review" marker on /verify. It never changes an order.
 */
import { now, nowMs } from "@/lib/clock";
import { and, eq, isNull, lt, sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import { tzDay } from "@/lib/util/time";
import { getSetting, recordLedgerEvent, withTx } from "./core";

export interface ReconFlag {
  orderId: string | null;
  batchId: string | null;
  kind: string;
  details: Record<string, unknown>;
}

/** Pure checks over a joined snapshot, so they can be unit-tested. */
export interface OrderSnapshotForRecon {
  id: string;
  kind: string;
  state: string;
  totalTzs: number;
  confirmedTzs: number;
  donorTzs: number;
  batchId: string | null;
  batchState: string | null;
  transferEvents: number; // CUSTODY_TRANSFERRED / HANDOVER events linked to this order
  completedAt: Date | null;
  pendingIntentAgeMinutes: number | null;
  reviewIntents: number;
}

export function reconcileOrder(o: OrderSnapshotForRecon, pendingAlertMinutes: number): ReconFlag[] {
  const flags: ReconFlag[] = [];
  const covered = o.confirmedTzs + o.donorTzs;
  if (covered > o.totalTzs) flags.push({ orderId: o.id, batchId: o.batchId, kind: "OVER_COVERED", details: { covered, total: o.totalTzs } });
  if (o.state === "COMPLETED" && covered < o.totalTzs) flags.push({ orderId: o.id, batchId: o.batchId, kind: "COMPLETED_WITHOUT_FULL_PAYMENT", details: { covered, total: o.totalTzs } });
  if (o.state === "COMPLETED" && o.transferEvents === 0) flags.push({ orderId: o.id, batchId: o.batchId, kind: "COMPLETED_WITHOUT_CUSTODY_EVENT", details: {} });
  if (o.state !== "COMPLETED" && o.transferEvents > 0 && o.kind !== "SUPPLIER_TO_RIDER") {
    flags.push({ orderId: o.id, batchId: o.batchId, kind: "CUSTODY_MOVED_BEFORE_COMPLETION", details: { state: o.state } });
  }
  if (o.kind === "CHAMPION_TO_CUSTOMER" && o.state === "COMPLETED" && o.batchState !== "HANDED_TO_CUSTOMER") {
    flags.push({ orderId: o.id, batchId: o.batchId, kind: "HANDOVER_WITHOUT_BATCH_STATE", details: { batchState: o.batchState } });
  }
  if (o.pendingIntentAgeMinutes !== null && o.pendingIntentAgeMinutes > pendingAlertMinutes) {
    flags.push({ orderId: o.id, batchId: o.batchId, kind: "PAYMENT_PENDING_TOO_LONG", details: { minutes: Math.round(o.pendingIntentAgeMinutes) } });
  }
  if (o.reviewIntents > 0) flags.push({ orderId: o.id, batchId: o.batchId, kind: "PAYMENT_IN_REVIEW", details: { count: o.reviewIntents } });
  return flags;
}

export async function runDailyReconciliation(): Promise<{ checked: number; matched: number; mismatched: number }> {
  const db = getDb();
  const pendingAlert = await getSetting("paymentPendingAlertMinutes");
  const since = new Date(nowMs() - 45 * 86_400_000);
  const rows = await db.execute<Record<string, unknown>>(sql`
    select o.id, o.kind, o.state, o.total_tzs as "totalTzs", o.batch_id as "batchId", o.completed_at as "completedAt",
      coalesce((select sum(confirmed_amount_tzs) from payment_intents p where p.order_id = o.id and p.status = 'PAYMENT_CONFIRMED'), 0)::int as "confirmedTzs",
      coalesce((select sum(amount_tzs) from donor_fundings d where d.order_id = o.id), 0)::int as "donorTzs",
      b.custody_state as "batchState",
      (select count(*) from custody_events ce where ce.order_id = o.id and ce.event in ('PICKUP','HUB_ACCEPT','CHAMPION_HANDOVER','CUSTOMER_HANDOVER'))::int as "transferEvents",
      (select extract(epoch from (now() - min(p.payer_claimed_at)))/60 from payment_intents p where p.order_id = o.id and p.status = 'PAYMENT_PENDING' and p.payer_claimed_at is not null) as "pendingIntentAgeMinutes",
      (select count(*) from payment_intents p where p.order_id = o.id and p.status = 'PAYMENT_FAILED_OR_REVIEW')::int as "reviewIntents"
    from orders o left join batches b on b.id = o.batch_id
    where o.updated_at > ${since}
  `);
  const flags: ReconFlag[] = [];
  for (const raw of rows.rows) {
    const r = raw as unknown as OrderSnapshotForRecon;
    flags.push(...reconcileOrder({ ...r, pendingIntentAgeMinutes: r.pendingIntentAgeMinutes === null ? null : Number(r.pendingIntentAgeMinutes) }, pendingAlert));
  }
  const flaggedOrders = new Set(flags.map((f) => f.orderId));
  const result = { checked: rows.rows.length, matched: rows.rows.length - flaggedOrders.size, mismatched: flaggedOrders.size };
  await withTx(async (tx) => {
    const [run] = await tx.insert(s.reconciliationRuns).values({ runDate: tzDay(), ...result }).returning({ id: s.reconciliationRuns.id });
    for (const f of flags) {
      await tx
        .insert(s.reconciliationFlags)
        .values({ runId: run!.id, orderId: f.orderId, batchId: f.batchId, kind: f.kind, details: f.details })
        .onConflictDoNothing();
    }
    // Auto-clear flags whose condition no longer holds.
    const open = await tx.query.reconciliationFlags.findMany({ where: isNull(s.reconciliationFlags.resolvedAt) });
    const stillOpen = new Set(flags.map((f) => `${f.orderId}:${f.kind}`));
    for (const f of open) {
      if (!stillOpen.has(`${f.orderId}:${f.kind}`)) {
        await tx.update(s.reconciliationFlags).set({ resolvedAt: now() }).where(eq(s.reconciliationFlags.id, f.id));
      }
    }
    await recordLedgerEvent(tx, { type: "DAILY_RECONCILIATION", subjectRef: `RECON-${tzDay()}`, amountTzs: null, role: "SYSTEM" });
    await tx
      .insert(s.jobHeartbeats)
      .values({ name: "reconciliation", lastRunAt: now(), lastStatus: "ok", details: result })
      .onConflictDoUpdate({ target: s.jobHeartbeats.name, set: { lastRunAt: now(), lastStatus: "ok", details: result } });
  });
  return result;
}

export async function orderUnderReview(orderId: string): Promise<boolean> {
  const f = await getDb().query.reconciliationFlags.findFirst({ where: and(eq(s.reconciliationFlags.orderId, orderId), isNull(s.reconciliationFlags.resolvedAt)) });
  if (f) return true;
  const ex = await getDb().query.exceptions.findFirst({ where: and(eq(s.exceptions.orderId, orderId), sql`${s.exceptions.status} <> 'RESOLVED'`) });
  return !!ex;
}

export async function staleFlags(days = 7) {
  return getDb().query.reconciliationFlags.findMany({ where: and(isNull(s.reconciliationFlags.resolvedAt), lt(s.reconciliationFlags.createdAt, new Date(nowMs() - days * 86_400_000))) });
}
