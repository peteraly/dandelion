/**
 * Restock suggestions per hub and product (Prompt H §2, Prompt I §2): what
 * each hub sold in the last WINDOW_DAYS on the days it had stock, what it
 * holds, what is already on the way and what local sellers are waiting for,
 * turned into a suggested pickup by lib/domain/replenishment.ts, with a lead
 * time from the road to the hub and its record of real trips
 * (lib/domain/routes.ts). Read-only, apart from the nightly stock record; the
 * admin (or the demo's live engine) decides whether to assign a pickup.
 */
import { and, eq, gte, gt, inArray, isNull, notInArray, or, sql } from "drizzle-orm";
import { now, nowMs } from "@/lib/clock";
import { getDb } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import { authorize, type Actor } from "@/lib/policy";
import { replenishment, type Replenishment } from "@/lib/domain/replenishment";
import { isRainyMonth, leadTime, percentile, type LeadTime } from "@/lib/domain/routes";
import { LOCKED_CUSTODY_STATES, type RoadType } from "@/lib/domain/types";
import { tzDay } from "@/lib/util/time";

export const WINDOW_DAYS = 14;
/** Trips older than this no longer describe the road. */
export const TRIP_WINDOW_DAYS = 90;
/** Fewer nightly records than this in the window and empty days are not counted yet. */
const MIN_RECORDED_DAYS = 7;
const DONE = ["COMPLETED", "CANCELLED", "CLOSED"] as const;
const DAY_MS = 86_400_000;

export interface HubRoad {
  hubId: string;
  hubName: string;
  areaId: string;
  road: RoadType | null;
  distanceKm: number | null;
  slowInRains: boolean;
  rainyNow: boolean;
  lead: LeadTime;
  /** Typical days on the road (median, rider collected → hub inspection) over recent trips; null with none. */
  roadDaysTypical: number | null;
}

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
  daysOutOfStock: number;
  waiting: number;
  road: HubRoad;
}

const num = (v: unknown) => Number(v ?? 0);

/** The current month (1–12) in Dar es Salaam. */
function currentMonth(): number {
  return Number(tzDay().slice(5, 7));
}

/** Every active hub's road and lead time: the plan from its road and the area's rains, against the record of real trips. */
export async function hubRoads(opts: { hubId?: string } = {}): Promise<Map<string, HubRoad>> {
  const db = getDb();
  const hubs = (await db.query.hubs.findMany({ where: eq(s.hubs.active, true), orderBy: s.hubs.name })).filter((h) => !opts.hubId || h.id === opts.hubId);
  const areas = await db.query.serviceAreas.findMany();
  const suppliers = await db.query.suppliers.findMany({ where: eq(s.suppliers.active, true) });
  const since = new Date(nowMs() - TRIP_WINDOW_DAYS * DAY_MS).toISOString();
  // One row per completed delivery: pickup assigned → on the hub's shelf, and collected → arrived at the hub.
  const trips = await db.execute<{ hubId: string; leadDays: string | number | null; roadDays: string | number | null }>(sql`
    select d.hub_id as "hubId",
      extract(epoch from (d.completed_at - coalesce(p.created_at, d.created_at))) / 86400 as "leadDays",
      (select extract(epoch from (min(ce.created_at) - d.created_at)) / 86400 from custody_events ce
        where ce.batch_id = d.batch_id and ce.order_id = d.id and ce.to_state = 'AT_HUB_INSPECTION') as "roadDays"
    from orders d left join orders p on p.id = d.parent_order_id
    where d.kind in ('RIDER_TO_HUB', 'SUPPLIER_TO_HUB') and d.state = 'COMPLETED' and d.hub_id is not null
      and d.completed_at >= ${since}::timestamptz`);
  const month = currentMonth();
  const out = new Map<string, HubRoad>();
  for (const hub of hubs) {
    const area = areas.find((a) => a.id === hub.serviceAreaId);
    const rainyNow = isRainyMonth(Array.isArray(area?.rainyMonths) ? area.rainyMonths : [], month);
    const leadTimes = suppliers.filter((x) => x.serviceAreaId === hub.serviceAreaId).map((x) => x.leadTimeDays);
    const mine = trips.rows.filter((r) => r.hubId === hub.id);
    const tripDays = mine.map((r) => num(r.leadDays));
    const roadDays = mine.filter((r) => r.roadDays !== null).map((r) => num(r.roadDays));
    const road = { road: hub.road, distanceKm: hub.distanceKm, slowInRains: hub.slowInRains, rainyNow };
    out.set(hub.id, {
      hubId: hub.id,
      hubName: hub.name,
      areaId: hub.serviceAreaId,
      ...road,
      lead: leadTime({ ...road, supplierLeadDays: leadTimes.length ? Math.min(...leadTimes) : 2, tripDays }),
      roadDaysTypical: percentile(roadDays, 0.5),
    });
  }
  return out;
}

/** Every active hub × every product its area sells, most urgent first. */
export async function restockSuggestions(actor: Actor | null, opts: { hubId?: string } = {}): Promise<RestockRow[]> {
  if (actor) authorize(actor, "admin.dashboard");
  const db = getDb();
  const since = new Date(nowMs() - WINDOW_DAYS * DAY_MS);
  const roads = await hubRoads(opts);
  const hubs = (await db.query.hubs.findMany({ where: eq(s.hubs.active, true), orderBy: s.hubs.name })).filter((h) => roads.has(h.id));
  const products = await db.query.products.findMany({ where: eq(s.products.active, true) });
  const available = await db.query.productAreaAvailability.findMany({ where: eq(s.productAreaAvailability.available, true) });
  // The nightly record of each hub's shelf over the window: how many nights were recorded, how many found it empty.
  const nights = await db
    .select({ hubId: s.hubStockDays.hubId, productId: s.hubStockDays.productId, recorded: sql<number>`count(*)::int`, empty: sql<number>`(count(*) filter (where ${s.hubStockDays.onHand} = 0))::int` })
    .from(s.hubStockDays)
    .where(gt(s.hubStockDays.day, tzDay(since)))
    .groupBy(s.hubStockDays.hubId, s.hubStockDays.productId);
  // What local sellers asked for and are still waiting on.
  const waitingRows = await db
    .select({ hubId: s.orders.hubId, productId: s.orders.productId, n: sql<number>`coalesce(sum(${s.orders.quantity}), 0)::int` })
    .from(s.orders)
    .where(and(eq(s.orders.kind, "HUB_TO_CHAMPION"), eq(s.orders.state, "REQUESTED")))
    .groupBy(s.orders.hubId, s.orders.productId);
  const rows: RestockRow[] = [];
  for (const hub of hubs) {
    const road = roads.get(hub.id)!;
    for (const productId of available.filter((a) => a.serviceAreaId === hub.serviceAreaId).map((a) => a.productId)) {
      const product = products.find((p) => p.id === productId);
      if (!product) continue;
      const [held] = await db
        .select({ n: sql<number>`coalesce(sum(${s.batches.quantity}), 0)::int` })
        .from(s.batches)
        .where(and(eq(s.batches.hubId, hub.id), eq(s.batches.productId, productId), eq(s.batches.custodyState, "AVAILABLE_AT_HUB")));
      // A delivery whose lot is locked (damaged, seal broken, on hold) is not coming until two admins resolve it, so it does not count.
      const [coming] = await db
        .select({ n: sql<number>`coalesce(sum(${s.orders.quantity}), 0)::int` })
        .from(s.orders)
        .leftJoin(s.batches, eq(s.batches.id, s.orders.batchId))
        .where(
          and(
            eq(s.orders.hubId, hub.id),
            eq(s.orders.productId, productId),
            inArray(s.orders.kind, ["SUPPLIER_TO_RIDER", "RIDER_TO_HUB", "SUPPLIER_TO_HUB"]),
            notInArray(s.orders.state, [...DONE]),
            or(isNull(s.batches.custodyState), notInArray(s.batches.custodyState, [...LOCKED_CUSTODY_STATES])),
          ),
        );
      const [sold] = await db
        .select({ n: sql<number>`coalesce(sum(${s.orders.quantity}), 0)::int` })
        .from(s.orders)
        .where(and(eq(s.orders.hubId, hub.id), eq(s.orders.productId, productId), inArray(s.orders.kind, ["HUB_TO_CHAMPION", "HUB_TO_ORG"]), eq(s.orders.state, "COMPLETED"), gte(s.orders.completedAt, since)));
      const night = nights.find((n) => n.hubId === hub.id && n.productId === productId);
      const daysOutOfStock = night && num(night.recorded) >= MIN_RECORDED_DAYS ? Math.round((num(night.empty) / num(night.recorded)) * WINDOW_DAYS) : 0;
      const waiting = num(waitingRows.find((w) => w.hubId === hub.id && w.productId === productId)?.n);
      // A pickup and its delivery are never open at once (the delivery starts when the pickup completes), so nothing counts twice.
      const input = { onHand: num(held?.n), onTheWay: num(coming?.n), soldInWindow: num(sold?.n), windowDays: WINDOW_DAYS, leadTimeDays: road.lead.days, minStock: hub.minStockUnits, daysOutOfStock, waiting };
      rows.push({ hubId: hub.id, hubName: hub.name, areaId: hub.serviceAreaId, productId, productName: product.name, ...input, road, ...replenishment(input) });
    }
  }
  const rank = { below_minimum: 0, below_reorder_point: 1, ok: 2 } as const;
  return rows.sort((a, b) => rank[a.reason] - rank[b.reason] || b.suggested - a.suggested || a.hubName.localeCompare(b.hubName));
}

/**
 * The nightly stock record (Prompt I §2.3): what each active hub holds of each product its area sells, once per day
 * (a second run the same day overwrites). Runs with the nightly reconciliation; the demo writes it for every seeded day.
 */
export async function recordHubStock(): Promise<{ rows: number }> {
  const r = await getDb().execute(sql`
    insert into hub_stock_days (hub_id, product_id, day, on_hand, created_at)
    select h.id, a.product_id, ${tzDay()}::date,
      coalesce((select sum(b.quantity) from batches b where b.hub_id = h.id and b.product_id = a.product_id and b.custody_state = 'AVAILABLE_AT_HUB'), 0)::int,
      ${now().toISOString()}::timestamptz
    from hubs h join product_area_availability a on a.service_area_id = h.service_area_id and a.available
    where h.active
    on conflict (hub_id, product_id, day) do update set on_hand = excluded.on_hand, created_at = excluded.created_at`);
  return { rows: r.rowCount ?? 0 };
}
