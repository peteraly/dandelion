/**
 * Is the marketplace working? (Prompt L §4.) The numbers that decide whether a two-sided market lives: are customers'
 * orders taken, how fast, how many lapse unanswered (unmet demand), how many come back, and who holds stock to serve
 * them — per area, for the admins. And the public's view (§4.3): what was delivered and where the money went, in
 * district totals, with small numbers hidden so no person can be picked out.
 */
import { and, desc, eq, gte, inArray, isNotNull, sql } from "drizzle-orm";
import { now, nowMs } from "@/lib/clock";
import { getDb } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import { authorize, type Actor } from "@/lib/policy";
import { PLAN_KINDS } from "@/lib/domain/sales";
import { firstName } from "@/lib/util/names";
import { expireShopRequests, passOnLateShopOrders, shopAreas } from "./shop";

const DAY = 86_400_000;

export interface AreaHealth {
  id: string;
  name: string;
  shopOpen: boolean;
  ridersSell: boolean;
  places: number;
  requests: number;
  accepted: number;
  expired: number;
  cancelled: number;
  womenOnly: number;
  /** Share of the window's requests that a seller took, 0–100; null without requests. */
  acceptedPct: number | null;
  /** Median hours from order to a seller taking it; null without accepted requests. */
  medianHoursToAccept: number | null;
  waitingNow: number;
  oldestWaitingHours: number | null;
  /** Customers who ordered at least twice, of those who ordered at all (ever). */
  repeatBuyers: number;
  buyers: number;
  sellersWithStock: number;
  /** What to do about it, if anything: a key under admin.shop.verdict. */
  verdict: "noSellers" | "slow" | "unmet" | "quiet" | "healthy";
}

export async function marketplaceHealth(actor: Actor, days = 30): Promise<{ areas: AreaHealth[]; waiting: WaitingRequest[]; days: number }> {
  authorize(actor, "admin.dashboard");
  await expireShopRequests();
  await passOnLateShopOrders();
  const db = getDb();
  const since = new Date(nowMs() - days * DAY);
  const at = now();
  const open = new Map((await shopAreas(db)).map((a) => [a.id, a]));
  const reqRows = await db.execute<Record<string, string | null>>(sql`
    select service_area_id as area,
      count(*) filter (where created_at >= ${since})::int as requests,
      count(*) filter (where created_at >= ${since} and state = 'ACCEPTED')::int as accepted,
      count(*) filter (where created_at >= ${since} and state = 'EXPIRED')::int as expired,
      count(*) filter (where created_at >= ${since} and state = 'CANCELLED')::int as cancelled,
      count(*) filter (where created_at >= ${since} and women_only)::int as women_only,
      count(*) filter (where state = 'OPEN')::int as waiting,
      extract(epoch from (${at}::timestamptz - min(created_at) filter (where state = 'OPEN'))) / 3600 as oldest_hours,
      percentile_cont(0.5) within group (order by extract(epoch from (accepted_at - created_at)) / 3600) filter (where state = 'ACCEPTED' and created_at >= ${since}) as median_hours
    from customer_requests group by 1`);
  const byArea = new Map(reqRows.rows.map((r) => [String(r.area), r]));
  const repeatRows = await db.execute<{ area: string; repeat: number; buyers: number }>(sql`
    select service_area_id as area, count(*) filter (where n >= 2)::int as repeat, count(*)::int as buyers
    from (select service_area_id, customer_id, count(*) as n from customer_requests where state = 'ACCEPTED' group by 1, 2) x group by 1`);
  const repeat = new Map(repeatRows.rows.map((r) => [String(r.area), r]));
  const stockRows = await db.execute<{ area: string; n: number }>(sql`
    select area, count(distinct user_id)::int as n from (
      select h.service_area_id as area, b.custodian_user_id as user_id from batches b
        join users u on u.id = b.custodian_user_id join hubs h on h.id = u.hub_id
        where b.custody_state = 'WITH_CHAMPION' and b.quantity > 0 and u.status = 'ACTIVE'
      union all
      select u.service_area_id as area, b.custodian_user_id as user_id from batches b
        join users u on u.id = b.custodian_user_id
        where b.custody_state = 'WITH_RIDER' and b.quantity > 0 and u.status = 'ACTIVE' and u.service_area_id is not null
    ) x group by 1`);
  const stock = new Map(stockRows.rows.map((r) => [String(r.area), Number(r.n)]));
  const placeRows = await db.select({ area: s.meetingPoints.serviceAreaId, n: sql<number>`count(*)::int` }).from(s.meetingPoints).where(eq(s.meetingPoints.active, true)).groupBy(s.meetingPoints.serviceAreaId);
  const places = new Map(placeRows.map((r) => [r.area, Number(r.n)]));

  const areas: AreaHealth[] = [];
  for (const a of await db.query.serviceAreas.findMany({ where: eq(s.serviceAreas.active, true), orderBy: s.serviceAreas.name })) {
    const r = byArea.get(a.id);
    const num = (k: string) => Number(r?.[k] ?? 0);
    const requests = num("requests");
    const accepted = num("accepted");
    const expired = num("expired");
    const median = r?.median_hours == null ? null : Math.round(Number(r.median_hours) * 10) / 10;
    const oldest = r?.oldest_hours == null ? null : Math.round(Number(r.oldest_hours) * 10) / 10;
    const sellersWithStock = stock.get(a.id) ?? 0;
    const shop = open.get(a.id);
    const verdict: AreaHealth["verdict"] =
      shop && sellersWithStock === 0 ? "noSellers" : (oldest ?? 0) > 24 || (median ?? 0) > 24 ? "slow" : requests >= 5 && expired / requests > 0.2 ? "unmet" : requests === 0 ? "quiet" : "healthy";
    areas.push({
      id: a.id,
      name: a.name,
      shopOpen: !!shop,
      ridersSell: shop?.ridersSell ?? false,
      places: places.get(a.id) ?? 0,
      requests,
      accepted,
      expired,
      cancelled: num("cancelled"),
      womenOnly: num("women_only"),
      acceptedPct: requests ? Math.round((accepted / requests) * 100) : null,
      medianHoursToAccept: median,
      waitingNow: num("waiting"),
      oldestWaitingHours: oldest,
      repeatBuyers: Number(repeat.get(a.id)?.repeat ?? 0),
      buyers: Number(repeat.get(a.id)?.buyers ?? 0),
      sellersWithStock,
      verdict,
    });
  }
  return { areas, waiting: await waitingRequests(), days };
}

export interface WaitingRequest {
  id: string;
  ref: string;
  areaName: string;
  placeName: string;
  productName: string;
  customerName: string;
  womenOnly: boolean;
  hours: number;
}

/** Orders nobody has taken yet, oldest first: who to call (a seller with stock nearby) before they lapse. */
async function waitingRequests(): Promise<WaitingRequest[]> {
  const rows = await getDb()
    .select({ r: s.customerRequests, area: s.serviceAreas.name, place: s.meetingPoints.name, product: s.products.name, customer: s.customers.displayName })
    .from(s.customerRequests)
    .innerJoin(s.serviceAreas, eq(s.serviceAreas.id, s.customerRequests.serviceAreaId))
    .innerJoin(s.meetingPoints, eq(s.meetingPoints.id, s.customerRequests.meetingPointId))
    .innerJoin(s.products, eq(s.products.id, s.customerRequests.productId))
    .innerJoin(s.customers, eq(s.customers.id, s.customerRequests.customerId))
    .where(eq(s.customerRequests.state, "OPEN"))
    .orderBy(s.customerRequests.createdAt)
    .limit(30);
  return rows.map((x) => ({
    id: x.r.id,
    ref: x.r.ref,
    areaName: x.area,
    placeName: x.place,
    productName: x.product,
    customerName: firstName(x.customer),
    womenOnly: x.r.womenOnly,
    hours: Math.round(((nowMs() - x.r.createdAt.getTime()) / 3_600_000) * 10) / 10,
  }));
}

/** For the admin home's to-do list: customers' safety reports not yet closed, and orders waiting more than 12 hours. */
export async function marketplaceNeeds(db = getDb()): Promise<{ safetyReports: number; customersWaiting: number }> {
  const [safety] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(s.exceptions)
    .where(and(eq(s.exceptions.type, "SAFETY_CONCERN"), sql`${s.exceptions.status} <> 'RESOLVED'`));
  const [waiting] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(s.customerRequests)
    .where(and(eq(s.customerRequests.state, "OPEN"), sql`${s.customerRequests.createdAt} < ${new Date(nowMs() - 12 * 3_600_000)}`));
  return { safetyReports: Number(safety?.n ?? 0), customersWaiting: Number(waiting?.n ?? 0) };
}

// ---------- the public's view ----------

const hide = (n: number): number | null => (n < 10 ? null : n);

export interface PublicImpact {
  handovers: { all: number | null; last30: number | null; byCategory: { category: string; n: number | null }[] };
  organisations: { orders: number | null; packs: number | null };
  sellers: number | null;
  areasServed: number;
  /** Median days from a customer's order to her hand-over, last 30 days (null under 10 hand-overs). */
  medianDaysToHandover: number | null;
  money: { paidByBuyersTzs: number; paidOutToMembersTzs: number | null; feesTzs: number };
  record: { anchors: number; eventsAnchored: number; lastRoot: string | null; lastTx: string | null; lastAt: Date | null; chainId: number | null };
}

/**
 * What anyone may see (Prompt K §1.3 "open to see"): district totals only. Counts under 10 are hidden, and so is the
 * total paid out to members while fewer than 10 have been paid, so no one's income can be worked out.
 */
export async function publicImpact(): Promise<PublicImpact> {
  const db = getDb();
  const since = new Date(nowMs() - 30 * DAY);
  const completed = and(inArray(s.orders.kind, [...PLAN_KINDS]), eq(s.orders.state, "COMPLETED"));
  const [all] = await db.select({ n: sql<number>`count(*)::int` }).from(s.orders).where(completed);
  const [recent] = await db.select({ n: sql<number>`count(*)::int` }).from(s.orders).where(and(completed, gte(s.orders.completedAt, since)));
  const cats = await db
    .select({ category: s.products.category, n: sql<number>`count(*)::int` })
    .from(s.orders)
    .innerJoin(s.products, eq(s.products.id, s.orders.productId))
    .where(completed)
    .groupBy(s.products.category);
  const [org] = await db
    .select({ orders: sql<number>`count(*)::int`, packs: sql<number>`coalesce(sum(${s.orders.quantity}), 0)::int` })
    .from(s.orders)
    .where(and(isNotNull(s.orders.organisationId), eq(s.orders.state, "COMPLETED")));
  const [sellers] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(s.users)
    .where(and(inArray(s.users.role, ["FIELD_CHAMPION", "BOSS_RIDER"]), eq(s.users.status, "ACTIVE")));
  const served = await db.execute<{ n: number }>(sql`select count(distinct coalesce(h.service_area_id, c.service_area_id))::int as n from orders o left join hubs h on h.id = o.hub_id left join customers c on c.id = o.customer_id where o.state = 'COMPLETED' and o.customer_id is not null`);
  const median = await db.execute<{ d: string | null; n: number }>(
    sql`select percentile_cont(0.5) within group (order by extract(epoch from (completed_at - created_at)) / 86400) as d, count(*)::int as n from orders where state = 'COMPLETED' and customer_id is not null and completed_at >= ${since}`,
  );
  const [paid] = await db
    .select({ n: sql<number>`coalesce(sum(${s.paymentIntents.confirmedAmountTzs}), 0)::int` })
    .from(s.paymentIntents)
    .where(and(eq(s.paymentIntents.status, "PAYMENT_CONFIRMED"), eq(s.paymentIntents.collectedByPlatform, true)));
  const [out] = await db
    .select({ n: sql<number>`coalesce(sum(${s.withdrawals.amountTzs}), 0)::int`, people: sql<number>`count(distinct ${s.withdrawals.userId})::int` })
    .from(s.withdrawals)
    .where(eq(s.withdrawals.state, "SENT"));
  const [fees] = await db.select({ n: sql<number>`coalesce(sum(${s.orders.platformFeeTzs}), 0)::int` }).from(s.orders).where(eq(s.orders.state, "COMPLETED"));
  const [anch] = await db
    .select({ n: sql<number>`count(*)::int`, events: sql<number>`coalesce(sum(${s.ledgerAnchors.eventCount}), 0)::int` })
    .from(s.ledgerAnchors)
    .where(eq(s.ledgerAnchors.status, "CONFIRMED"));
  const last = await db.query.ledgerAnchors.findFirst({ where: eq(s.ledgerAnchors.status, "CONFIRMED"), orderBy: desc(s.ledgerAnchors.confirmedAt) });
  const m = median.rows[0];
  return {
    handovers: { all: hide(Number(all?.n ?? 0)), last30: hide(Number(recent?.n ?? 0)), byCategory: cats.map((c) => ({ category: c.category, n: hide(Number(c.n)) })) },
    organisations: { orders: hide(Number(org?.orders ?? 0)), packs: hide(Number(org?.packs ?? 0)) },
    sellers: hide(Number(sellers?.n ?? 0)),
    areasServed: Number(served.rows[0]?.n ?? 0),
    medianDaysToHandover: m && Number(m.n) >= 10 && m.d != null ? Math.round(Number(m.d) * 10) / 10 : null,
    money: { paidByBuyersTzs: Number(paid?.n ?? 0), paidOutToMembersTzs: Number(out?.people ?? 0) >= 10 ? Number(out?.n ?? 0) : null, feesTzs: Number(fees?.n ?? 0) },
    record: { anchors: Number(anch?.n ?? 0), eventsAnchored: Number(anch?.events ?? 0), lastRoot: last?.root ?? null, lastTx: last?.txHash ?? null, lastAt: last?.confirmedAt ?? null, chainId: last?.chainId ?? null },
  };
}
