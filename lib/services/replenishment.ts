/**
 * Restock suggestions per hub and product (Prompt H §2): what each hub sold in
 * the last WINDOW_DAYS, what it holds and what is already on the way, turned
 * into a suggested pickup by lib/domain/replenishment.ts. Read-only; the admin
 * (or the demo's live engine) decides whether to assign it.
 */
import { and, eq, gte, inArray, notInArray, sql } from "drizzle-orm";
import { nowMs } from "@/lib/clock";
import { getDb } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import { authorize, type Actor } from "@/lib/policy";
import { replenishment, type Replenishment } from "@/lib/domain/replenishment";

export const WINDOW_DAYS = 14;
/** A day on the road from the factory to the hub, on top of the supplier's lead time. */
const TRANSIT_DAYS = 1;
const DONE = ["COMPLETED", "CANCELLED", "CLOSED"] as const;

export interface RestockRow extends Replenishment {
  hubId: string;
  hubName: string;
  areaId: string;
  productId: string;
  productName: string;
  onHand: number;
  onTheWay: number;
  soldInWindow: number;
  leadTimeDays: number;
  minStock: number;
}

/** Every active hub × every product its area sells, most urgent first. */
export async function restockSuggestions(actor: Actor | null, opts: { hubId?: string } = {}): Promise<RestockRow[]> {
  if (actor) authorize(actor, "admin.dashboard");
  const db = getDb();
  const since = new Date(nowMs() - WINDOW_DAYS * 86_400_000);
  const hubs = (await db.query.hubs.findMany({ where: eq(s.hubs.active, true), orderBy: s.hubs.name })).filter((h) => !opts.hubId || h.id === opts.hubId);
  const products = await db.query.products.findMany({ where: eq(s.products.active, true) });
  const available = await db.query.productAreaAvailability.findMany({ where: eq(s.productAreaAvailability.available, true) });
  const suppliers = await db.query.suppliers.findMany({ where: eq(s.suppliers.active, true) });
  const sum = (v: unknown) => Number(v ?? 0);
  const rows: RestockRow[] = [];
  for (const hub of hubs) {
    const leadTimes = suppliers.filter((x) => x.serviceAreaId === hub.serviceAreaId).map((x) => x.leadTimeDays);
    const leadTimeDays = (leadTimes.length ? Math.min(...leadTimes) : 2) + TRANSIT_DAYS;
    for (const productId of available.filter((a) => a.serviceAreaId === hub.serviceAreaId).map((a) => a.productId)) {
      const product = products.find((p) => p.id === productId);
      if (!product) continue;
      const [held] = await db
        .select({ n: sql<number>`coalesce(sum(${s.batches.quantity}), 0)::int` })
        .from(s.batches)
        .where(and(eq(s.batches.hubId, hub.id), eq(s.batches.productId, productId), eq(s.batches.custodyState, "AVAILABLE_AT_HUB")));
      const [coming] = await db
        .select({ n: sql<number>`coalesce(sum(${s.orders.quantity}), 0)::int` })
        .from(s.orders)
        .where(and(eq(s.orders.hubId, hub.id), eq(s.orders.productId, productId), inArray(s.orders.kind, ["SUPPLIER_TO_RIDER", "RIDER_TO_HUB", "SUPPLIER_TO_HUB"]), notInArray(s.orders.state, [...DONE])));
      const [sold] = await db
        .select({ n: sql<number>`coalesce(sum(${s.orders.quantity}), 0)::int` })
        .from(s.orders)
        .where(and(eq(s.orders.hubId, hub.id), eq(s.orders.productId, productId), inArray(s.orders.kind, ["HUB_TO_CHAMPION", "HUB_TO_ORG"]), eq(s.orders.state, "COMPLETED"), gte(s.orders.completedAt, since)));
      // A pickup and its delivery are never open at once (the delivery starts when the pickup completes), so nothing counts twice.
      const onTheWay = sum(coming?.n);
      const input = { onHand: sum(held?.n), onTheWay, soldInWindow: sum(sold?.n), windowDays: WINDOW_DAYS, leadTimeDays, minStock: hub.minStockUnits };
      rows.push({ hubId: hub.id, hubName: hub.name, areaId: hub.serviceAreaId, productId, productName: product.name, ...input, minStock: hub.minStockUnits, ...replenishment(input) });
    }
  }
  const rank = { below_minimum: 0, below_reorder_point: 1, ok: 2 } as const;
  return rows.sort((a, b) => rank[a.reason] - rank[b.reason] || b.suggested - a.suggested || a.hubName.localeCompare(b.hubName));
}
