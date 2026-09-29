/**
 * Morning brief items (handbook §15–16). Deterministic queries select the
 * items and flag stop-and-fix triggers; AI (when on) only orders/explains.
 */
import { and, desc, eq, gte, isNull, lt, ne, sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import { authorize, type Actor } from "@/lib/policy";
import { getSetting } from "./core";
import type { BriefItem } from "@/lib/domain/brief";

export type { BriefItem };

export async function buildBriefItems(actor: Actor): Promise<BriefItem[]> {
  authorize(actor, "admin.dashboard");
  const db = getDb();
  const items: BriefItem[] = [];
  const hours = (d: Date) => Math.round((Date.now() - d.getTime()) / 3_600_000);

  const review = await db
    .select({ i: s.paymentIntents, ref: s.orders.ref })
    .from(s.paymentIntents)
    .innerJoin(s.orders, eq(s.orders.id, s.paymentIntents.orderId))
    .where(eq(s.paymentIntents.status, "PAYMENT_FAILED_OR_REVIEW"))
    .orderBy(desc(s.paymentIntents.updatedAt))
    .limit(20);
  for (const { i, ref } of review) {
    items.push({
      id: `pay:${i.id}`,
      kind: "PAYMENT_REVIEW",
      title: `Payment review: ${ref}`,
      detail: `${i.reviewReason ?? "review"} · ${i.amountTzs} TZS`,
      href: `/admin/orders/${i.orderId}`,
      triggers: ["payment cannot be reconciled"],
      ageHours: hours(i.updatedAt),
    });
  }
  const exceptions = await db.query.exceptions.findMany({ where: ne(s.exceptions.status, "RESOLVED"), orderBy: desc(s.exceptions.createdAt), limit: 20 });
  for (const e of exceptions) {
    const triggers: string[] = [];
    if (e.type === "SUSPECTED_THEFT") triggers.push("suspected fraud");
    if (e.type === "WASH_CONCERN") triggers.push("reusable product where safe washing unavailable");
    if (e.lockedBatch && hours(e.createdAt) > 72) triggers.push("exception lock unresolved > 72h");
    items.push({ id: `ex:${e.id}`, kind: "EXCEPTION", title: `${e.type.replace(/_/g, " ")}: ${e.ref}`, detail: e.note ?? "", href: "/admin/exceptions", triggers, ageHours: hours(e.createdAt) });
  }
  const approvals = await db.query.approvalRequests.findMany({ where: eq(s.approvalRequests.status, "PENDING"), orderBy: desc(s.approvalRequests.createdAt), limit: 20 });
  for (const a of approvals) {
    items.push({ id: `ap:${a.id}`, kind: "APPROVAL", title: `Approval waiting: ${a.summary}`, detail: a.type, href: "/admin/approvals", triggers: [], ageHours: hours(a.createdAt) });
  }
  const flags = await db.query.reconciliationFlags.findMany({ where: isNull(s.reconciliationFlags.resolvedAt), orderBy: desc(s.reconciliationFlags.createdAt), limit: 20 });
  for (const f of flags) {
    items.push({ id: `rf:${f.id}`, kind: "RECON_FLAG", title: `Reconciliation: ${f.kind.replace(/_/g, " ")}`, detail: JSON.stringify(f.details), href: "/admin/reconciliation", triggers: ["payment cannot be reconciled"], ageHours: hours(f.createdAt) });
  }
  const pendingMinutes = await getSetting("paymentPendingAlertMinutes");
  const stuck = await db
    .select({ i: s.paymentIntents, ref: s.orders.ref })
    .from(s.paymentIntents)
    .innerJoin(s.orders, eq(s.orders.id, s.paymentIntents.orderId))
    .where(and(eq(s.paymentIntents.status, "PAYMENT_PENDING"), lt(s.paymentIntents.payerClaimedAt, new Date(Date.now() - pendingMinutes * 60_000))))
    .limit(20);
  for (const { i, ref } of stuck) {
    items.push({ id: `stuck:${i.id}`, kind: "PENDING_TOO_LONG", title: `Payment pending too long: ${ref}`, detail: `claimed ${hours(i.payerClaimedAt!)}h ago`, href: `/admin/orders/${i.orderId}`, triggers: ["provider API unavailable or unreliable?"], ageHours: hours(i.payerClaimedAt!) });
  }
  const hubs = await db.query.hubs.findMany({ where: eq(s.hubs.active, true) });
  for (const h of hubs) {
    const [n] = await db.select({ n: sql<number>`coalesce(sum(${s.batches.quantity}),0)::int` }).from(s.batches).where(and(eq(s.batches.hubId, h.id), eq(s.batches.custodyState, "AVAILABLE_AT_HUB")));
    if (Number(n?.n ?? 0) < h.minStockUnits) items.push({ id: `hub:${h.id}`, kind: "LOW_STOCK", title: `Low stock: ${h.name}`, detail: `${n?.n ?? 0} < ${h.minStockUnits}`, href: "/admin/inventory", triggers: [], ageHours: 0 });
  }
  const [alerts] = await db.select({ n: sql<number>`count(*)::int` }).from(s.securityEventLog).where(and(eq(s.securityEventLog.severity, "ALERT"), gte(s.securityEventLog.createdAt, new Date(Date.now() - 86_400_000))));
  if (Number(alerts?.n ?? 0) > 0) {
    items.push({ id: "sec:24h", kind: "SECURITY", title: `${alerts!.n} security alerts in 24h`, detail: "", href: "/admin/logs", triggers: ["personal data accessed improperly?"], ageHours: 0 });
  }
  // Deterministic order: triggers first, then age.
  return items.sort((a, b) => b.triggers.length - a.triggers.length || b.ageHours - a.ageHours);
}
