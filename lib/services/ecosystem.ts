/**
 * The ecosystem snapshot (Prompt B §3.2): one typed object behind
 * /admin/ecosystem — nodes, edges, money, attention, system, feed. Read-only,
 * admin-only, aggregated in SQL. Nothing person-identifying about customers
 * leaves this module (counts only); stakeholders appear by display name.
 */
import { z } from "zod";
import { and, desc, eq, gte, inArray, ne, sql } from "drizzle-orm";
import { now, nowMs } from "@/lib/clock";
import { getDb } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import { authorize, type Actor } from "@/lib/policy";
import { LOCKED_CUSTODY_STATES, ORDER_KINDS, type OrderKind } from "@/lib/domain/types";
import { securityLabelKey, ADMIN_ACTIONS } from "@/lib/domain/events";
import { SUPPLIER_QUALITY_TYPES } from "@/lib/domain/suppliers";
import { PLAN_KINDS } from "@/lib/domain/sales";
import { paidByUserSince, receivedByUserSince } from "./earnings";
import { aiEnabled, aiModel, appEnv, chainNetwork, paymentProviderId, smsProviderId } from "@/lib/env";
import { tzMonthStart } from "@/lib/util/time";
import { unanchoredCount } from "@/lib/ledger/anchor";
import { getSetting, logAdminAction } from "./core";

export const WINDOWS = ["24h", "7d", "30d"] as const;
export type Window = (typeof WINDOWS)[number];
const WINDOW_MS: Record<Window, number> = { "24h": 86_400_000, "7d": 7 * 86_400_000, "30d": 30 * 86_400_000 };

/** Days without a confirmed payment before a plan counts as stalled. */
export const STALLED_PLAN_DAYS = 10;
/** Days without any order activity before a stakeholder counts as silent. */
export const SILENT_NODE_DAYS = 7;

const NodeStatus = z.enum(["active", "inactive", "locked", "suspended", "pending", "invited"]);
const PaymentState = z.enum(["pending", "confirmed", "review", "hold"]);

export const NodeSchema = z.object({
  id: z.string(),
  kind: z.enum(["SUPPLIER", "RIDER", "HUB", "CHAMPION", "CUSTOMERS", "ORGANISATION"]),
  name: z.string(),
  status: NodeStatus,
  areaId: z.string().nullable(),
  areaName: z.string(),
  hubId: z.string().nullable(),
  lastActivityAt: z.string().nullable(),
  href: z.string(),
  stock: z.object({ units: z.number(), byState: z.record(z.string(), z.number()), lockedUnits: z.number(), oldestBatchDays: z.number().nullable() }).nullable(),
  hub: z.object({ minStockUnits: z.number(), available: z.number(), manager: z.string().nullable(), pendingIn: z.number(), pendingOut: z.number() }).nullable(),
  champion: z.object({ customers: z.number(), activePlans: z.number(), stalledPlans: z.number(), lastSaleAt: z.string().nullable() }).nullable(),
  supplier: z.object({ waitingPastLeadTime: z.number(), qualityShare: z.number(), qualityBatches: z.number(), confirmedTzs: z.number() }).nullable(),
  customers: z.object({ count: z.number(), activePlans: z.number(), handoverPending: z.number() }).nullable(),
  organisation: z.object({ kind: z.string(), openOrders: z.number(), confirmedTzs: z.number() }).nullable(),
  /** Provider-confirmed money received minus paid in the window (prompt §8.8.1); null for nodes that do not earn. */
  earnedTzs: z.number().nullable(),
});
export type EcoNode = z.infer<typeof NodeSchema>;

export const EdgeSchema = z.object({
  kind: z.enum(ORDER_KINDS),
  fromId: z.string(),
  toId: z.string(),
  count: z.number(),
  units: z.number(),
  expectedTzs: z.number(),
  confirmedTzs: z.number(),
  oldestDays: z.number(),
  inReview: z.number(),
  onHold: z.number(),
  awaitingConfirmation: z.number(),
  paymentState: PaymentState,
});
export type EcoEdge = z.infer<typeof EdgeSchema>;

export const OpenOrderSchema = z.object({
  id: z.string(),
  ref: z.string(),
  kind: z.enum(ORDER_KINDS),
  state: z.string(),
  fromName: z.string(),
  toName: z.string(),
  units: z.number(),
  totalTzs: z.number(),
  confirmedTzs: z.number(),
  ageDays: z.number(),
  paymentState: PaymentState,
  hubId: z.string().nullable(),
});
export type OpenOrder = z.infer<typeof OpenOrderSchema>;

export const AttentionSchema = z.object({
  paymentReviews: z.number(),
  paymentsPendingLong: z.number(),
  lockedBatches: z.number(),
  approvalsWaiting: z.number(),
  openExceptions: z.number(),
  openExceptionsByType: z.record(z.string(), z.number()),
  reconFlags: z.number(),
  deadJobs: z.number(),
  silentNodes: z.number(),
  hubsBelowMin: z.number(),
  handoverPending: z.number(),
  waitingOnSupplier: z.number(),
  supplierQuality: z.number(),
  orgOrdersUnpaid: z.number(),
});
export type Attention = z.infer<typeof AttentionSchema>;
export const ATTENTION_KEYS = ["paymentReviews", "paymentsPendingLong", "lockedBatches", "approvalsWaiting", "openExceptions", "reconFlags", "deadJobs", "silentNodes", "hubsBelowMin", "handoverPending", "waitingOnSupplier", "supplierQuality", "orgOrdersUnpaid"] as const satisfies readonly (keyof Attention)[];
export type AttentionKey = (typeof ATTENTION_KEYS)[number];

export const FeedItemSchema = z.object({
  id: z.string(),
  at: z.string(),
  source: z.enum(["ledger", "security", "admin"]),
  /** Label key inside the `ecosystem.feed.<source>` catalogue; never raw database text. */
  labelKey: z.string(),
  /** For PROBLEM_* security events: the problem type, labelled separately. */
  problem: z.string().nullable(),
  actor: z.string().nullable(),
  subject: z.string().nullable(),
  severity: z.enum(["INFO", "WARN", "ALERT"]).nullable(),
});
export type FeedItem = z.infer<typeof FeedItemSchema>;

export const SnapshotSchema = z.object({
  asOf: z.string(),
  window: z.enum(WINDOWS),
  filters: z.object({ areaId: z.string().nullable(), hubId: z.string().nullable() }),
  areas: z.array(z.object({ id: z.string(), name: z.string() })),
  hubs: z.array(z.object({ id: z.string(), name: z.string(), areaId: z.string() })),
  nodes: z.array(NodeSchema),
  edges: z.array(EdgeSchema),
  openOrders: z.array(OpenOrderSchema),
  money: z.object({
    byKind: z.record(z.string(), z.number()),
    pendingIntents: z.number(),
    reviewIntents: z.number(),
    plans: z.object({ active: z.number(), completedInWindow: z.number(), stalled: z.number() }),
  }),
  attention: AttentionSchema,
  system: z.object({
    heartbeats: z.array(z.object({ name: z.string(), lastRunAt: z.string(), status: z.string(), ageSeconds: z.number(), manual: z.boolean() })),
    anchoring: z.object({ configured: z.boolean(), network: z.string(), lastAnchorAt: z.string().nullable(), lastStatus: z.string().nullable(), unanchored: z.number() }),
    smsOutbox24h: z.number(),
    paymentProvider: z.string(),
    smsProvider: z.string(),
    ai: z.object({ enabled: z.boolean(), model: z.string(), monthCalls: z.number(), monthCostMicroUsd: z.number() }),
    environment: z.string(),
    version: z.string(),
    seedProfile: z.string(),
    demo: z.boolean(),
  }),
  feed: z.array(FeedItemSchema),
});
export type EcosystemSnapshot = z.infer<typeof SnapshotSchema>;

export interface SnapshotQuery {
  areaId?: string | null;
  hubId?: string | null;
  window: Window;
}

type Db = ReturnType<typeof getDb>;
const n = (v: unknown) => Number(v ?? 0);
const iso = (d: Date | string | null | undefined) => (d ? new Date(d).toISOString() : null);
const days = (from: Date | string, to: number) => Math.max(0, Math.round(((to - new Date(from).getTime()) / 86_400_000) * 10) / 10);

function paymentState(row: { onHold: number; inReview: number; confirmedTzs: number; expectedTzs: number }): z.infer<typeof PaymentState> {
  if (row.onHold > 0) return "hold";
  if (row.inReview > 0) return "review";
  if (row.confirmedTzs >= row.expectedTzs && row.expectedTzs > 0) return "confirmed";
  return "pending";
}

function userStatus(status: string): z.infer<typeof NodeStatus> {
  switch (status) {
    case "ACTIVE":
      return "active";
    case "LOCKED":
      return "locked";
    case "SUSPENDED":
      return "suspended";
    case "INVITED":
      return "invited";
    default:
      return "inactive";
  }
}

/** The whole picture, or one area / one hub of it. */
export async function ecosystemSnapshot(actor: Actor, q: SnapshotQuery): Promise<EcosystemSnapshot> {
  authorize(actor, "admin.ecosystem.view");
  if (!WINDOWS.includes(q.window)) throw new Error("ecosystem_window_invalid");
  const db = getDb();
  const at = now();
  const atMs = at.getTime();
  const since = new Date(atMs - WINDOW_MS[q.window]);

  const areas = await db.query.serviceAreas.findMany({ orderBy: s.serviceAreas.name });
  const areaName = new Map(areas.map((a) => [a.id, a.name]));
  const allHubs = await db.query.hubs.findMany({ orderBy: s.hubs.name });
  const hubFilter = q.hubId ? allHubs.filter((h) => h.id === q.hubId) : q.areaId ? allHubs.filter((h) => h.serviceAreaId === q.areaId) : allHubs;
  const hubIds = hubFilter.map((h) => h.id);
  const areaIds = q.areaId ? [q.areaId] : q.hubId ? [...new Set(hubFilter.map((h) => h.serviceAreaId))] : areas.map((a) => a.id);
  const scoped = !!(q.areaId || q.hubId);

  // ---------- people and organisations ----------
  const users = await db.query.users.findMany({ where: and(ne(s.users.status, "REMOVED"), inArray(s.users.role, ["BOSS_RIDER", "HUB_MANAGER", "FIELD_CHAMPION", "SUPPLIER"])), orderBy: s.users.displayName });
  const userName = new Map(users.map((u) => [u.id, u.displayName]));
  const inScopeUser = (u: (typeof users)[number]) => {
    if (!scoped) return true;
    if (u.role === "BOSS_RIDER") return !u.serviceAreaId || areaIds.includes(u.serviceAreaId);
    if (u.hubId) return hubIds.includes(u.hubId);
    return !u.serviceAreaId || areaIds.includes(u.serviceAreaId);
  };
  const suppliers = await db.query.suppliers.findMany({ orderBy: s.suppliers.businessName });
  const supplierName = new Map(suppliers.map((x) => [x.id, x.businessName]));
  const suppliersInScope = suppliers.filter((x) => !scoped || (x.serviceAreaId !== null && areaIds.includes(x.serviceAreaId)));
  const pendingSupplierIds = new Set(
    (await db.select({ id: sql<string>`${s.approvalRequests.payload}->>'supplierId'` }).from(s.approvalRequests).where(and(eq(s.approvalRequests.type, "STAKEHOLDER_ACTIVATE"), eq(s.approvalRequests.status, "PENDING")))).map((r) => r.id),
  );

  // Last order activity per user (seller or buyer), one pass.
  const activity = await db.execute<{ uid: string; at: Date }>(sql`
    select uid, max(updated_at) as at from (
      select seller_user_id as uid, updated_at from orders
      union all
      select buyer_user_id as uid, updated_at from orders where buyer_user_id is not null
    ) x group by uid`);
  const lastActivity = new Map(activity.rows.map((r) => [r.uid, new Date(r.at)]));

  // ---------- stock ----------
  const stockByCustodian = await db.execute<{ custodian: string | null; hub_id: string | null; state: string; units: string; oldest: Date }>(sql`
    select custodian_user_id as custodian, hub_id, custody_state as state, sum(quantity)::text as units, min(created_at) as oldest
    from batches where quantity > 0 group by custodian_user_id, hub_id, custody_state`);
  type StockAgg = { units: number; byState: Record<string, number>; lockedUnits: number; oldest: number | null };
  const emptyStock = (): StockAgg => ({ units: 0, byState: {}, lockedUnits: 0, oldest: null });
  const stockOfUser = new Map<string, StockAgg>();
  const stockOfHub = new Map<string, StockAgg>();
  const HUB_STATES = new Set(["AT_HUB_INSPECTION", "ACCEPTED_AT_HUB", "AVAILABLE_AT_HUB", "RESERVED_FOR_CHAMPION", "INSPECTION_ISSUE", "DAMAGED_OR_QUARANTINED"]);
  for (const r of stockByCustodian.rows) {
    const units = n(r.units);
    const add = (m: Map<string, StockAgg>, key: string) => {
      const agg = m.get(key) ?? emptyStock();
      agg.units += units;
      agg.byState[r.state] = (agg.byState[r.state] ?? 0) + units;
      if ((LOCKED_CUSTODY_STATES as readonly string[]).includes(r.state)) agg.lockedUnits += units;
      const o = new Date(r.oldest).getTime();
      agg.oldest = agg.oldest === null ? o : Math.min(agg.oldest, o);
      m.set(key, agg);
    };
    if (r.hub_id && HUB_STATES.has(r.state)) add(stockOfHub, r.hub_id);
    else if (r.custodian) add(stockOfUser, r.custodian);
  }
  const stockOut = (agg: StockAgg | undefined) => (agg ? { units: agg.units, byState: agg.byState, lockedUnits: agg.lockedUnits, oldestBatchDays: agg.oldest === null ? null : days(new Date(agg.oldest), atMs) } : { units: 0, byState: {}, lockedUnits: 0, oldestBatchDays: null });

  // ---------- customers and plans per champion ----------
  const customerCounts = await db.execute<{ champion_id: string; n: string }>(sql`select champion_id, count(*)::text as n from customers where status = 'ACTIVE' group by champion_id`);
  const customersOf = new Map(customerCounts.rows.map((r) => [r.champion_id, n(r.n)]));
  const stalledCutoff = new Date(atMs - STALLED_PLAN_DAYS * 86_400_000);
  const plansPerChampion = await db.execute<{ seller: string; active: string; stalled: string; handover: string; last_sale: Date | null }>(sql`
    select o.seller_user_id as seller,
      count(*) filter (where o.state in ('PLAN_ACTIVE','FULLY_PAID','HANDOVER_PENDING'))::text as active,
      count(*) filter (where o.state = 'PLAN_ACTIVE' and coalesce((select max(pi.confirmed_at) from payment_intents pi where pi.order_id = o.id and pi.status = 'PAYMENT_CONFIRMED'), o.created_at) < ${stalledCutoff})::text as stalled,
      count(*) filter (where o.state in ('FULLY_PAID','HANDOVER_PENDING'))::text as handover,
      max(o.completed_at) as last_sale
    from orders o where o.kind in (${sql.join(PLAN_KINDS.map((k) => sql`${k}`), sql`, `)}) group by o.seller_user_id`);
  const plansOf = new Map(plansPerChampion.rows.map((r) => [r.seller, { active: n(r.active), stalled: n(r.stalled), handover: n(r.handover), lastSale: r.last_sale ? new Date(r.last_sale) : null }]));

  // ---------- supplier signals ----------
  const supplierPickups = await db.execute<{ supplier_id: string; waiting: string }>(sql`
    select o.supplier_id, count(*) filter (where o.state = 'PICKUP_ASSIGNED' and o.created_at < ${at}::timestamptz - make_interval(days => sp.lead_time_days))::text as waiting
    from orders o join suppliers sp on sp.id = o.supplier_id where o.kind = 'SUPPLIER_TO_RIDER' group by o.supplier_id`);
  const waitingOf = new Map(supplierPickups.rows.map((r) => [r.supplier_id, n(r.waiting)]));
  const thirtyDays = new Date(atMs - 30 * 86_400_000);
  const supplierQuality = await db.execute<{ supplier_id: string; batches: string; with_issue: string }>(sql`
    select b.supplier_id, count(distinct b.id)::text as batches,
      count(distinct b.id) filter (where exists (select 1 from exceptions e where e.batch_id = b.id and e.type in (${sql.join(SUPPLIER_QUALITY_TYPES.map((t) => sql`${t}`), sql`, `)})))::text as with_issue
    from batches b where b.created_at >= ${thirtyDays} group by b.supplier_id`);
  const qualityOf = new Map(supplierQuality.rows.map((r) => [r.supplier_id, { batches: n(r.batches), withIssue: n(r.with_issue) }]));
  const supplierMoney = await db.execute<{ supplier_id: string; tzs: string }>(sql`
    select u.supplier_id, coalesce(sum(pi.confirmed_amount_tzs), 0)::text as tzs
    from payment_intents pi join users u on u.id = pi.payee_user_id
    where pi.status = 'PAYMENT_CONFIRMED' and pi.confirmed_at >= ${since} and u.supplier_id is not null group by u.supplier_id`);
  const supplierTzs = new Map(supplierMoney.rows.map((r) => [r.supplier_id, n(r.tzs)]));
  const receivedBy = await receivedByUserSince(db, since);
  const paidBy = await paidByUserSince(db, since);
  const earnedOf = (userIds: string[]) => userIds.reduce((a, id) => a + (receivedBy.get(id) ?? 0) - (paidBy.get(id) ?? 0), 0);

  // ---------- pending in/out per hub ----------
  const hubPending = await db.execute<{ hub_id: string; pending_in: string; pending_out: string }>(sql`
    select hub_id,
      count(*) filter (where kind in ('SUPPLIER_TO_RIDER','RIDER_TO_HUB'))::text as pending_in,
      count(*) filter (where kind = 'HUB_TO_CHAMPION')::text as pending_out
    from orders where hub_id is not null and state not in ('COMPLETED','CANCELLED','CLOSED') group by hub_id`);
  const pendingOf = new Map(hubPending.rows.map((r) => [r.hub_id, { pendingIn: n(r.pending_in), pendingOut: n(r.pending_out) }]));

  // ---------- nodes ----------
  const nodes: EcoNode[] = [];
  for (const sup of suppliersInScope) {
    const qual = qualityOf.get(sup.id) ?? { batches: 0, withIssue: 0 };
    const orgUsers = users.filter((u) => u.supplierId === sup.id);
    const last = orgUsers.map((u) => lastActivity.get(u.id)?.getTime() ?? 0).reduce((a, b) => Math.max(a, b), 0);
    const stock = orgUsers.map((u) => stockOfUser.get(u.id)).filter((x): x is StockAgg => !!x);
    const merged = stock.reduce<StockAgg>((acc, x) => {
      acc.units += x.units;
      acc.lockedUnits += x.lockedUnits;
      for (const [k, v] of Object.entries(x.byState)) acc.byState[k] = (acc.byState[k] ?? 0) + v;
      acc.oldest = acc.oldest === null ? x.oldest : x.oldest === null ? acc.oldest : Math.min(acc.oldest, x.oldest);
      return acc;
    }, emptyStock());
    nodes.push({
      id: `supplier:${sup.id}`,
      kind: "SUPPLIER",
      name: sup.businessName,
      status: sup.active ? "active" : pendingSupplierIds.has(sup.id) ? "pending" : "inactive",
      areaId: sup.serviceAreaId,
      areaName: areaName.get(sup.serviceAreaId ?? "") ?? "—",
      hubId: null,
      lastActivityAt: last ? new Date(last).toISOString() : null,
      href: `/admin/suppliers/${sup.id}`,
      stock: stockOut(merged),
      hub: null,
      champion: null,
      supplier: { waitingPastLeadTime: waitingOf.get(sup.id) ?? 0, qualityShare: qual.batches ? qual.withIssue / qual.batches : 0, qualityBatches: qual.batches, confirmedTzs: supplierTzs.get(sup.id) ?? 0 },
      customers: null,
      organisation: null,
      earnedTzs: earnedOf(orgUsers.map((u) => u.id)),
    });
  }
  for (const u of users.filter((x) => x.role === "BOSS_RIDER" && inScopeUser(x))) {
    nodes.push({ id: `user:${u.id}`, kind: "RIDER", name: u.displayName, status: userStatus(u.status), areaId: u.serviceAreaId, areaName: areaName.get(u.serviceAreaId ?? "") ?? "—", hubId: null, lastActivityAt: iso(lastActivity.get(u.id)), href: `/admin/stakeholders/${u.id}`, stock: stockOut(stockOfUser.get(u.id)), hub: null, champion: null, supplier: null, customers: null, organisation: null, earnedTzs: earnedOf([u.id]) });
  }
  for (const h of hubFilter) {
    const manager = users.find((u) => u.role === "HUB_MANAGER" && u.hubId === h.id);
    const st = stockOfHub.get(h.id);
    const champs = users.filter((u) => u.role === "FIELD_CHAMPION" && u.hubId === h.id);
    const lastTimes = [manager, ...champs].map((u) => (u ? lastActivity.get(u.id)?.getTime() ?? 0 : 0));
    const last = Math.max(0, ...lastTimes);
    nodes.push({
      id: `hub:${h.id}`,
      kind: "HUB",
      name: h.name,
      status: h.active ? (manager ? userStatus(manager.status) : "inactive") : "inactive",
      areaId: h.serviceAreaId,
      areaName: areaName.get(h.serviceAreaId) ?? "—",
      hubId: h.id,
      lastActivityAt: last ? new Date(last).toISOString() : null,
      href: `/admin/inventory`,
      stock: stockOut(st),
      hub: { minStockUnits: h.minStockUnits, available: st?.byState.AVAILABLE_AT_HUB ?? 0, manager: manager?.displayName ?? null, ...(pendingOf.get(h.id) ?? { pendingIn: 0, pendingOut: 0 }) },
      champion: null,
      supplier: null,
      customers: null,
      organisation: null,
      earnedTzs: manager ? earnedOf([manager.id]) : null,
    });
  }
  for (const u of users.filter((x) => x.role === "FIELD_CHAMPION" && inScopeUser(x))) {
    const p = plansOf.get(u.id) ?? { active: 0, stalled: 0, handover: 0, lastSale: null };
    nodes.push({ id: `user:${u.id}`, kind: "CHAMPION", name: u.displayName, status: userStatus(u.status), areaId: u.serviceAreaId, areaName: areaName.get(u.serviceAreaId ?? "") ?? "—", hubId: u.hubId, lastActivityAt: iso(lastActivity.get(u.id)), href: `/admin/stakeholders/${u.id}`, stock: stockOut(stockOfUser.get(u.id)), hub: null, champion: { customers: customersOf.get(u.id) ?? 0, activePlans: p.active, stalledPlans: p.stalled, lastSaleAt: iso(p.lastSale) }, supplier: null, customers: null, organisation: null, earnedTzs: earnedOf([u.id]) });
  }
  // Customers appear as one box per hub — counts only, never names (§3.5).
  for (const h of hubFilter) {
    const champs = users.filter((u) => u.role === "FIELD_CHAMPION" && u.hubId === h.id);
    const count = champs.reduce((a, c) => a + (customersOf.get(c.id) ?? 0), 0);
    const activePlans = champs.reduce((a, c) => a + (plansOf.get(c.id)?.active ?? 0), 0);
    const handoverPending = champs.reduce((a, c) => a + (plansOf.get(c.id)?.handover ?? 0), 0);
    nodes.push({ id: `customers:${h.id}`, kind: "CUSTOMERS", name: `${h.name}`, status: "active", areaId: h.serviceAreaId, areaName: areaName.get(h.serviceAreaId) ?? "—", hubId: h.id, lastActivityAt: null, href: `/admin/orders`, stock: null, hub: null, champion: null, supplier: null, customers: { count, activePlans, handoverPending }, organisation: null, earnedTzs: null });
  }
  // Customers served directly by riders or suppliers (village drops, factory gate — prompt §8.8): one box per area, counts only.
  for (const areaId of areaIds) {
    const direct = users.filter((u) => (u.role === "BOSS_RIDER" || u.role === "SUPPLIER") && inScopeUser(u) && (u.serviceAreaId === areaId || (u.role === "SUPPLIER" && suppliers.find((x) => x.id === u.supplierId)?.serviceAreaId === areaId)));
    const count = direct.reduce((a, u) => a + (customersOf.get(u.id) ?? 0), 0);
    const activePlans = direct.reduce((a, u) => a + (plansOf.get(u.id)?.active ?? 0), 0);
    const handoverPending = direct.reduce((a, u) => a + (plansOf.get(u.id)?.handover ?? 0), 0);
    if (count === 0 && activePlans === 0) continue;
    nodes.push({ id: `customers:area:${areaId}`, kind: "CUSTOMERS", name: `${areaName.get(areaId) ?? "—"} · direct`, status: "active", areaId, areaName: areaName.get(areaId) ?? "—", hubId: null, lastActivityAt: null, href: `/admin/orders`, stock: null, hub: null, champion: null, supplier: null, customers: { count, activePlans, handoverPending }, organisation: null, earnedTzs: null });
  }
  // Buyer organisations (prompt §8.8.4).
  const orgs = await db.query.organisations.findMany({ orderBy: s.organisations.name });
  const orgStats = await db.execute<{ organisation_id: string; open: string; tzs: string }>(sql`
    select o.organisation_id, count(*) filter (where o.state not in ('COMPLETED','CANCELLED','CLOSED'))::text as open,
      coalesce(sum((select sum(pi.confirmed_amount_tzs) from payment_intents pi where pi.order_id = o.id and pi.status = 'PAYMENT_CONFIRMED' and pi.confirmed_at >= ${since})), 0)::text as tzs
    from orders o where o.organisation_id is not null group by o.organisation_id`);
  const orgStatOf = new Map(orgStats.rows.map((r) => [r.organisation_id, { open: n(r.open), tzs: n(r.tzs) }]));
  const orgName = new Map(orgs.map((o) => [o.id, o.name]));
  for (const o of orgs.filter((x) => !scoped || (x.serviceAreaId !== null && areaIds.includes(x.serviceAreaId)))) {
    const st = orgStatOf.get(o.id) ?? { open: 0, tzs: 0 };
    nodes.push({ id: `org:${o.id}`, kind: "ORGANISATION", name: o.name, status: o.active ? "active" : "inactive", areaId: o.serviceAreaId, areaName: areaName.get(o.serviceAreaId ?? "") ?? "—", hubId: null, lastActivityAt: null, href: `/admin/organisations/${o.id}`, stock: null, hub: null, champion: null, supplier: null, customers: null, organisation: { kind: o.kind, openOrders: st.open, confirmedTzs: st.tzs }, earnedTzs: null });
  }

  // ---------- edges and open orders ----------
  const openRows = await db.execute<{ id: string; ref: string; kind: OrderKind; state: string; seller: string; buyer: string | null; supplier_id: string | null; hub_id: string | null; organisation_id: string | null; quantity: string; total_tzs: string; created_at: Date; confirmed: string; in_review: string; sender_confirmed_at: Date | null; receiver_confirmed_at: Date | null }>(sql`
    select o.id, o.ref, o.kind, o.state, o.seller_user_id as seller, o.buyer_user_id as buyer, o.supplier_id, o.hub_id, o.organisation_id, o.quantity::text, o.total_tzs::text, o.created_at,
      coalesce((select sum(pi.confirmed_amount_tzs) from payment_intents pi where pi.order_id = o.id and pi.status = 'PAYMENT_CONFIRMED'), 0)::text as confirmed,
      (select count(*) from payment_intents pi where pi.order_id = o.id and pi.status = 'PAYMENT_FAILED_OR_REVIEW')::text as in_review,
      o.sender_confirmed_at, o.receiver_confirmed_at
    from orders o where o.state not in ('COMPLETED','CANCELLED','CLOSED')
    ${hubIds.length && scoped ? sql`and (o.hub_id in (${sql.join(hubIds.map((h) => sql`${h}`), sql`, `)}) or o.hub_id is null)` : sql``}
    order by o.created_at asc limit 500`);
  const hubNameOf = new Map(allHubs.map((h) => [h.id, h.name]));
  const areaOfUser = new Map(users.map((u) => [u.id, u.serviceAreaId ?? (u.supplierId ? suppliers.find((x) => x.id === u.supplierId)?.serviceAreaId ?? null : null)]));
  const endpoints = (r: (typeof openRows.rows)[number]): { fromId: string; toId: string; fromName: string; toName: string } => {
    const supplierEnd = { id: `supplier:${r.supplier_id}`, name: supplierName.get(r.supplier_id ?? "") ?? "—" };
    const sellerEnd = { id: `user:${r.seller}`, name: userName.get(r.seller) ?? "—" };
    const buyerEnd = { id: `user:${r.buyer}`, name: userName.get(r.buyer ?? "") ?? "—" };
    const hubEnd = { id: `hub:${r.hub_id}`, name: hubNameOf.get(r.hub_id ?? "") ?? "—" };
    const orgEnd = { id: `org:${r.organisation_id}`, name: orgName.get(r.organisation_id ?? "") ?? "—" };
    // Direct customer sales point at the area's "direct" customers box; ladder sales at the hub's.
    const directCustomers = { id: `customers:area:${areaOfUser.get(r.seller) ?? ""}`, name: `${areaName.get(areaOfUser.get(r.seller) ?? "") ?? "—"} · direct` };
    const hubCustomers = { id: `customers:${r.hub_id}`, name: hubNameOf.get(r.hub_id ?? "") ?? "—" };
    const pair = (from: { id: string; name: string }, to: { id: string; name: string }) => ({ fromId: from.id, toId: to.id, fromName: from.name, toName: to.name });
    switch (r.kind) {
      case "SUPPLIER_TO_RIDER":
      case "SUPPLIER_TO_CHAMPION":
        return pair(supplierEnd, buyerEnd);
      case "SUPPLIER_TO_HUB":
        return pair(supplierEnd, hubEnd);
      case "RIDER_TO_HUB":
        return pair(sellerEnd, hubEnd);
      case "HUB_TO_CHAMPION":
        return pair(hubEnd, buyerEnd);
      case "CHAMPION_TO_CUSTOMER":
        return pair(sellerEnd, hubCustomers);
      case "RIDER_TO_CUSTOMER":
        return pair(sellerEnd, directCustomers);
      case "SUPPLIER_TO_CUSTOMER":
        return pair(supplierEnd, directCustomers);
      case "SUPPLIER_TO_ORG":
        return pair(supplierEnd, orgEnd);
      case "HUB_TO_ORG":
        return pair(hubEnd, orgEnd);
      case "RIDER_TO_ORG":
        return pair(sellerEnd, orgEnd);
    }
  };
  const edgeMap = new Map<string, EcoEdge>();
  const openOrders: OpenOrder[] = [];
  for (const r of openRows.rows) {
    const e = endpoints(r);
    const onHold = r.state === "ON_HOLD" ? 1 : 0;
    const inReview = n(r.in_review) > 0 ? 1 : 0;
    const awaiting = r.state === "PAID" && (!r.sender_confirmed_at || !r.receiver_confirmed_at) ? 1 : 0;
    const confirmedTzs = n(r.confirmed);
    const expectedTzs = n(r.total_tzs);
    openOrders.push({ id: r.id, ref: r.ref, kind: r.kind, state: r.state, fromName: e.fromName, toName: e.toName, units: n(r.quantity), totalTzs: expectedTzs, confirmedTzs, ageDays: days(r.created_at, atMs), paymentState: paymentState({ onHold, inReview, confirmedTzs, expectedTzs }), hubId: r.hub_id });
    const key = `${r.kind}|${e.fromId}|${e.toId}`;
    const edge = edgeMap.get(key) ?? { kind: r.kind, fromId: e.fromId, toId: e.toId, count: 0, units: 0, expectedTzs: 0, confirmedTzs: 0, oldestDays: 0, inReview: 0, onHold: 0, awaitingConfirmation: 0, paymentState: "pending" as const };
    edge.count++;
    edge.units += n(r.quantity);
    edge.expectedTzs += expectedTzs;
    edge.confirmedTzs += confirmedTzs;
    edge.oldestDays = Math.max(edge.oldestDays, days(r.created_at, atMs));
    edge.inReview += inReview;
    edge.onHold += onHold;
    edge.awaitingConfirmation += awaiting;
    edgeMap.set(key, edge);
  }
  const edges = [...edgeMap.values()].map((e) => ({ ...e, paymentState: paymentState(e) }));

  // ---------- money ----------
  const moneyRows = await db.execute<{ kind: string; tzs: string }>(sql`
    select o.kind, coalesce(sum(pi.confirmed_amount_tzs), 0)::text as tzs from payment_intents pi join orders o on o.id = pi.order_id
    where pi.status = 'PAYMENT_CONFIRMED' and pi.confirmed_at >= ${since} group by o.kind`);
  const byKind: Record<string, number> = Object.fromEntries(ORDER_KINDS.map((k) => [k, 0]));
  for (const r of moneyRows.rows) byKind[r.kind] = n(r.tzs);
  const intentCounts = await db.execute<{ status: string; n: string }>(sql`select status, count(*)::text as n from payment_intents where status <> 'PAYMENT_CONFIRMED' group by status`);
  const intentOf = new Map(intentCounts.rows.map((r) => [r.status, n(r.n)]));
  const planTotals = await db.execute<{ active: string; completed: string; stalled: string }>(sql`
    select count(*) filter (where state in ('PLAN_ACTIVE','FULLY_PAID','HANDOVER_PENDING'))::text as active,
      count(*) filter (where state = 'COMPLETED' and completed_at >= ${since})::text as completed,
      count(*) filter (where state = 'PLAN_ACTIVE' and coalesce((select max(pi.confirmed_at) from payment_intents pi where pi.order_id = o.id and pi.status = 'PAYMENT_CONFIRMED'), o.created_at) < ${stalledCutoff})::text as stalled
    from orders o where kind in (${sql.join(PLAN_KINDS.map((k) => sql`${k}`), sql`, `)})`);
  const pt = planTotals.rows[0]!;

  // ---------- attention ----------
  const pendingMinutes = await getSetting("paymentPendingAlertMinutes");
  const [att] = (
    await db.execute<Record<string, string>>(sql`
    select
      (select count(*) from payment_intents where status = 'PAYMENT_FAILED_OR_REVIEW')::text as payment_reviews,
      (select count(*) from payment_intents where status = 'PAYMENT_PENDING' and created_at < ${new Date(atMs - pendingMinutes * 60_000)})::text as payments_pending_long,
      (select count(*) from batches where custody_state in ('INSPECTION_ISSUE','DAMAGED_OR_QUARANTINED') and quantity > 0)::text as locked_batches,
      (select count(*) from approval_requests where status = 'PENDING')::text as approvals_waiting,
      (select count(*) from reconciliation_flags where resolved_at is null)::text as recon_flags,
      (select count(*) from verification_jobs where status = 'DEAD')::text as dead_jobs,
      (select count(*) from orders where kind in (${sql.join(PLAN_KINDS.map((k) => sql`${k}`), sql`, `)}) and state in ('FULLY_PAID','HANDOVER_PENDING'))::text as handover_pending,
      (select count(*) from orders where organisation_id is not null and state = 'AWAITING_PAYMENT' and created_at < ${new Date(atMs - 3 * 86_400_000)})::text as org_orders_unpaid,
      (select count(*) from orders o join suppliers sp on sp.id = o.supplier_id where o.kind = 'SUPPLIER_TO_RIDER' and o.state = 'PICKUP_ASSIGNED' and o.created_at < ${at}::timestamptz - make_interval(days => sp.lead_time_days))::text as waiting_on_supplier`)
  ).rows;
  const exceptionsByType = await db.execute<{ type: string; n: string }>(sql`select type, count(*)::text as n from exceptions where status <> 'RESOLVED' group by type`);
  const openExceptionsByType = Object.fromEntries(exceptionsByType.rows.map((r) => [r.type, n(r.n)]));
  const silentCutoff = atMs - SILENT_NODE_DAYS * 86_400_000;
  const silentNodes = users.filter((u) => u.status === "ACTIVE" && inScopeUser(u) && (lastActivity.get(u.id)?.getTime() ?? 0) < silentCutoff).length;
  const hubsBelowMin = nodes.filter((x) => x.kind === "HUB" && x.hub && x.hub.available < x.hub.minStockUnits).length;
  const supplierQualityCount = nodes.filter((x) => x.kind === "SUPPLIER" && x.supplier && x.supplier.qualityBatches >= 3 && x.supplier.qualityShare > 0.2).length;
  const attention: Attention = {
    paymentReviews: n(att?.payment_reviews),
    paymentsPendingLong: n(att?.payments_pending_long),
    lockedBatches: n(att?.locked_batches),
    approvalsWaiting: n(att?.approvals_waiting),
    openExceptions: Object.values(openExceptionsByType).reduce((a, b) => a + b, 0),
    openExceptionsByType,
    reconFlags: n(att?.recon_flags),
    deadJobs: n(att?.dead_jobs),
    silentNodes,
    hubsBelowMin,
    handoverPending: n(att?.handover_pending),
    waitingOnSupplier: n(att?.waiting_on_supplier),
    supplierQuality: supplierQualityCount,
    orgOrdersUnpaid: n(att?.org_orders_unpaid),
  };

  // ---------- system ----------
  const heartbeats = (await db.query.jobHeartbeats.findMany()).map((h) => ({ name: h.name, lastRunAt: h.lastRunAt.toISOString(), status: h.lastStatus, ageSeconds: Math.max(0, Math.round((atMs - h.lastRunAt.getTime()) / 1000)), manual: h.lastStatus.includes("(manual)") }));
  const lastAnchor = await db.query.ledgerAnchors.findFirst({ orderBy: desc(s.ledgerAnchors.createdAt) });
  const [sms] = (await db.select({ n: sql<number>`count(*)::int` }).from(s.smsOutbox).where(gte(s.smsOutbox.createdAt, new Date(atMs - 86_400_000)))) as { n: number }[];
  const [ai] = (await db.select({ calls: sql<number>`count(*)::int`, cost: sql<number>`coalesce(sum(${s.aiInteractionLog.costMicroUsd}), 0)::int` }).from(s.aiInteractionLog).where(gte(s.aiInteractionLog.createdAt, tzMonthStart(at)))) as { calls: number; cost: number }[];
  const seedProfile = String(await getSetting("seedProfile"));
  const system: EcosystemSnapshot["system"] = {
    heartbeats,
    anchoring: { configured: !!(process.env.ANCHOR_SIGNER_KEY || process.env.ANCHOR_KMS_KEY_ID), network: chainNetwork(), lastAnchorAt: iso(lastAnchor?.createdAt), lastStatus: lastAnchor?.status ?? null, unanchored: await unanchoredCount() },
    smsOutbox24h: n(sms?.n),
    paymentProvider: paymentProviderId(),
    smsProvider: smsProviderId(),
    ai: { enabled: aiEnabled(), model: aiModel(), monthCalls: n(ai?.calls), monthCostMicroUsd: n(ai?.cost) },
    environment: appEnv(),
    version: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? "dev",
    seedProfile,
    demo: seedProfile === "demo",
  };

  const feed = await recentFeed(db, users, supplierName);

  return SnapshotSchema.parse({
    asOf: at.toISOString(),
    window: q.window,
    filters: { areaId: q.areaId ?? null, hubId: q.hubId ?? null },
    areas: areas.map((a) => ({ id: a.id, name: a.name })),
    hubs: allHubs.map((h) => ({ id: h.id, name: h.name, areaId: h.serviceAreaId })),
    nodes,
    edges,
    openOrders,
    money: { byKind, pendingIntents: intentOf.get("PAYMENT_PENDING") ?? 0, reviewIntents: intentOf.get("PAYMENT_FAILED_OR_REVIEW") ?? 0, plans: { active: n(pt.active), completedInWindow: n(pt.completed), stalled: n(pt.stalled) } },
    attention,
    system,
    feed,
  });
}

/** The last 50 events across the three logs, labelled by key — no free text from the database. */
async function recentFeed(db: Db, users: { id: string; displayName: string }[], supplierName: Map<string, string>): Promise<FeedItem[]> {
  const userName = new Map(users.map((u) => [u.id, u.displayName]));
  const adminNames = new Map((await db.query.users.findMany({ where: eq(s.users.role, "SUPER_ADMIN"), columns: { id: true, displayName: true } })).map((u) => [u.id, u.displayName]));
  const name = (id: string | null) => (id ? userName.get(id) ?? adminNames.get(id) ?? null : null);
  const ledger = await db.query.ledgerEvents.findMany({ orderBy: desc(s.ledgerEvents.id), limit: 50, columns: { id: true, type: true, subjectRef: true, createdAt: true } });
  const security = await db.query.securityEventLog.findMany({ orderBy: desc(s.securityEventLog.id), limit: 50, columns: { id: true, type: true, severity: true, userId: true, createdAt: true } });
  const admin = await db.query.adminActionLog.findMany({ orderBy: desc(s.adminActionLog.id), limit: 50, columns: { id: true, action: true, adminId: true, targetType: true, targetId: true, createdAt: true } });
  const orderIds = admin.filter((a) => a.targetType === "order" && a.targetId).map((a) => a.targetId!);
  const orderRefs = new Map(orderIds.length ? (await db.query.orders.findMany({ where: inArray(s.orders.id, orderIds), columns: { id: true, ref: true } })).map((o) => [o.id, o.ref]) : []);
  const subjectOf = (a: (typeof admin)[number]): string | null => {
    if (!a.targetId) return null;
    if (a.targetType === "user") return name(a.targetId);
    if (a.targetType === "order") return orderRefs.get(a.targetId) ?? null;
    if (a.targetType === "supplier") return supplierName.get(a.targetId) ?? null;
    return a.targetType ?? null;
  };
  const items: FeedItem[] = [
    ...ledger.map((e) => ({ id: `l${e.id}`, at: e.createdAt.toISOString(), source: "ledger" as const, labelKey: e.type, problem: null, actor: null, subject: e.subjectRef, severity: null })),
    ...security.map((e) => {
      const k = securityLabelKey(e.type);
      return { id: `s${e.id}`, at: e.createdAt.toISOString(), source: "security" as const, labelKey: k.key, problem: k.problem, actor: name(e.userId), subject: null, severity: e.severity };
    }),
    // Message keys cannot contain dots, so "user.create" is labelled under "user_create".
    ...admin.map((a) => ({ id: `a${a.id}`, at: a.createdAt.toISOString(), source: "admin" as const, labelKey: (ADMIN_ACTIONS as readonly string[]).includes(a.action) ? a.action.replace(/\./g, "_") : "UNKNOWN", problem: null, actor: name(a.adminId), subject: subjectOf(a), severity: null })),
  ];
  items.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  return items.slice(0, 50);
}

/** One "viewed ecosystem" entry per admin session per day (§3.5), not one per refresh. */
export async function logEcosystemView(actor: Actor, sessionId: string): Promise<boolean> {
  authorize(actor, "admin.ecosystem.view");
  const db = getDb();
  const dayStart = new Date(nowMs() - 86_400_000);
  const existing = await db.query.adminActionLog.findFirst({ where: and(eq(s.adminActionLog.adminId, actor.userId), eq(s.adminActionLog.action, "ecosystem.view"), eq(s.adminActionLog.targetId, sessionId), gte(s.adminActionLog.createdAt, dayStart)), columns: { id: true } });
  if (existing) return false;
  await logAdminAction(db, actor.userId, "ecosystem.view", { type: "session", id: sessionId });
  return true;
}

/** True when the serialised snapshot carries no phone number — used by the tests and the page's guard. */
export function containsPhone(text: string): boolean {
  return /\+?255\s?7\d{2}\s?\d{3}\s?\d{3}|\b0[67]\d{2}\s?\d{3}\s?\d{3}\b/.test(text);
}

