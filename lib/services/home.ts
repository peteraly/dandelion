/**
 * Builds the role-scoped snapshots the One Screen decision tables consume.
 * Read-only.
 */
import { nowMs } from "@/lib/clock";
import { and, desc, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import { homeView, type HomeView, type OrderSnapshot, type RoleExtras } from "@/lib/domain/workflows";
import type { FieldRole } from "@/lib/domain/types";
import type { Actor } from "@/lib/policy";
import { isPlanKind, SUPPLIER_SELLER_KINDS } from "@/lib/domain/sales";
import { getSetting } from "./core";
import { paidTotals, latestIntent, type Order } from "./payments";
import { recentOrdersFor } from "./orders";

export async function snapshotFor(actor: Actor, o: Order): Promise<OrderSnapshot> {
  const db = getDb();
  const t = await paidTotals(db, o);
  const intent = await latestIntent(db, o.id);
  const b = o.batchId ? await db.query.batches.findFirst({ where: eq(s.batches.id, o.batchId), columns: { custodyState: true } }) : null;
  let daysSinceLastPayment: number | undefined;
  if (isPlanKind(o.kind)) {
    const last = await db.query.paymentIntents.findFirst({
      where: and(eq(s.paymentIntents.orderId, o.id), eq(s.paymentIntents.status, "PAYMENT_CONFIRMED")),
      orderBy: desc(s.paymentIntents.confirmedAt),
    });
    const since = last?.confirmedAt ?? o.createdAt;
    daysSinceLastPayment = (nowMs() - since.getTime()) / 86_400_000;
  }
  return {
    id: o.id,
    ref: o.ref,
    verifyRef: o.verifyRef,
    kind: o.kind,
    state: o.state,
    side: o.sellerUserId === actor.userId || (actor.role === "SUPPLIER" && SUPPLIER_SELLER_KINDS.includes(o.kind) && o.supplierId === actor.supplierId) ? "seller" : "buyer",
    totalTzs: o.totalTzs,
    confirmedPaidTzs: t.confirmedTzs,
    donorFundedTzs: t.donorTzs,
    latestPaymentStatus: intent?.status ?? null,
    paymentClaimed: !!intent && intent.status === "PAYMENT_PENDING" && intent.payerClaimedAt !== null,
    batchState: b?.custodyState ?? null,
    senderConfirmed: o.senderConfirmedAt !== null,
    receiverConfirmed: o.receiverConfirmedAt !== null,
    daysSinceLastPayment,
    updatedAt: o.updatedAt,
  };
}

export async function extrasFor(actor: Actor): Promise<RoleExtras> {
  const db = getDb();
  const extras: RoleExtras = {};
  if (actor.role === "HUB_MANAGER" && actor.hubId) {
    const hub = await db.query.hubs.findFirst({ where: eq(s.hubs.id, actor.hubId) });
    const [stock] = await db
      .select({ n: sql<number>`coalesce(sum(${s.batches.quantity}), 0)::int` })
      .from(s.batches)
      .where(and(eq(s.batches.hubId, actor.hubId), eq(s.batches.custodyState, "AVAILABLE_AT_HUB")));
    extras.lowStock = Number(stock?.n ?? 0) < (hub?.minStockUnits ?? 0);
  }
  if (actor.role === "FIELD_CHAMPION") {
    const [units] = await db
      .select({ n: sql<number>`coalesce(sum(${s.batches.quantity}), 0)::int` })
      .from(s.batches)
      .where(and(eq(s.batches.custodianUserId, actor.userId), eq(s.batches.custodyState, "WITH_CHAMPION")));
    extras.championStockUnits = Number(units?.n ?? 0);
    const customers = await db.query.customers.findMany({ where: and(eq(s.customers.championId, actor.userId), eq(s.customers.status, "ACTIVE")), columns: { id: true } });
    const withPlan = customers.length
      ? await db.query.orders.findMany({
          where: and(inArray(s.orders.customerId, customers.map((c) => c.id)), inArray(s.orders.state, ["PLAN_ACTIVE", "FULLY_PAID", "HANDOVER_PENDING"])),
          columns: { customerId: true },
        })
      : [];
    const planned = new Set(withPlan.map((o) => o.customerId));
    extras.customersWithoutPlan = customers.filter((c) => !planned.has(c.id)).length;
  }
  return extras;
}

export async function homeFor(actor: Actor): Promise<HomeView & { snapshots: OrderSnapshot[] }> {
  const orders = await recentOrdersFor(actor);
  const snapshots = await Promise.all(orders.map((o) => snapshotFor(actor, o)));
  const extras = await extrasFor(actor);
  const view = homeView(actor.role as FieldRole, snapshots, extras);
  return { ...view, snapshots };
}

/** The single action for one order, as the home screen would compute it for that order alone. */
export async function viewForOrder(actor: Actor, o: Order): Promise<HomeView & { snapshot: OrderSnapshot }> {
  const snapshot = await snapshotFor(actor, o);
  const extras = await extrasFor(actor);
  return { ...homeView(actor.role as FieldRole, [snapshot], extras), snapshot };
}

export async function hubInventory(hubId: string) {
  return getDb()
    .select({ batch: s.batches, product: s.products.name })
    .from(s.batches)
    .innerJoin(s.products, eq(s.products.id, s.batches.productId))
    .where(and(eq(s.batches.hubId, hubId), gte(s.batches.quantity, 1), isNull(s.batches.parentBatchId)))
    .orderBy(desc(s.batches.updatedAt));
}

export { getSetting };
