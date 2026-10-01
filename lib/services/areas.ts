/**
 * Per-area sale-path switches (prompt §8.8.2). The handbook ladder is always
 * allowed; every other path is off until two admins turn it on for an area,
 * because it decides who earns. The demo profile turns everything on.
 */
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { DbOrTx } from "@/lib/db/client";
import { getDb } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import { authorize, type Actor } from "@/lib/policy";
import { DIRECT_KINDS, LADDER_KINDS, saleAllowed, saleFor } from "@/lib/domain/sales";
import { ROAD_TYPES, type OrderKind } from "@/lib/domain/types";
import { DomainError, logAdminAction, withTx } from "./core";
import { requestApproval } from "./approvals";

/** The area a seller sells in: the hub's for hub staff and champions, the organisation's for supplier users, the user's own otherwise (riders). */
export async function sellerAreaId(actor: { userId: string; role: string; hubId: string | null; supplierId: string | null }): Promise<string | null> {
  const db = getDb();
  if (actor.hubId) return (await db.query.hubs.findFirst({ where: eq(s.hubs.id, actor.hubId) }))?.serviceAreaId ?? null;
  if (actor.supplierId) return (await db.query.suppliers.findFirst({ where: eq(s.suppliers.id, actor.supplierId) }))?.serviceAreaId ?? null;
  return (await db.query.users.findFirst({ where: eq(s.users.id, actor.userId) }))?.serviceAreaId ?? null;
}

export async function allowedSalesFor(db: DbOrTx, serviceAreaId: string): Promise<OrderKind[]> {
  const area = await db.query.serviceAreas.findFirst({ where: eq(s.serviceAreas.id, serviceAreaId), columns: { allowedSales: true } });
  const extra = Array.isArray(area?.allowedSales) ? (area!.allowedSales as OrderKind[]) : [];
  return [...LADDER_KINDS, ...extra.filter((k) => DIRECT_KINDS.includes(k))];
}

/** Refuse a sale path the area has not switched on. Ladder kinds always pass. */
export async function assertSaleAllowed(db: DbOrTx, serviceAreaId: string, kind: OrderKind): Promise<void> {
  if (LADDER_KINDS.includes(kind)) return;
  const allowed = await allowedSalesFor(db, serviceAreaId);
  if (!saleAllowed(kind, allowed)) throw new DomainError("sale_not_allowed", `${kind} is not enabled in this area`);
}

/** What a seller may do beyond the ladder in their area — drives which buttons the field app shows. */
export async function directSalesFor(db: DbOrTx, actor: Actor, serviceAreaId: string | null): Promise<{ toCustomers: boolean; toOrganisations: boolean }> {
  if (!serviceAreaId) return { toCustomers: false, toOrganisations: false };
  const allowed = await allowedSalesFor(db, serviceAreaId);
  const mine = allowed.map(saleFor).filter((r) => r.seller === actor.role);
  return { toCustomers: mine.some((r) => r.buyer === "CUSTOMER" && !r.ladder), toOrganisations: mine.some((r) => r.buyer === "ORGANISATION") };
}

export interface AreaSalesRow {
  id: string;
  name: string;
  region: string;
  active: boolean;
  allowedSales: OrderKind[];
  pendingRequest: boolean;
}

export async function listAreasWithSales(actor: Actor): Promise<AreaSalesRow[]> {
  authorize(actor, "admin.area.sales");
  const db = getDb();
  const areas = await db.query.serviceAreas.findMany({ orderBy: s.serviceAreas.name });
  const pending = new Set(
    (await db.select({ id: sql<string>`${s.approvalRequests.payload}->>'serviceAreaId'` }).from(s.approvalRequests).where(and(eq(s.approvalRequests.type, "AREA_SALES_CHANGE"), eq(s.approvalRequests.status, "PENDING")))).map((r) => r.id),
  );
  return areas.map((a) => ({ id: a.id, name: a.name, region: a.region, active: a.active, allowedSales: (Array.isArray(a.allowedSales) ? a.allowedSales : []) as OrderKind[], pendingRequest: pending.has(a.id) }));
}

/** Ask for a new set of switches for an area; the second admin decides in the approvals inbox. */
export async function requestAreaSales(actor: Actor, serviceAreaId: string, allowedSales: OrderKind[]): Promise<{ requestId: string }> {
  authorize(actor, "admin.area.sales");
  const area = await getDb().query.serviceAreas.findFirst({ where: eq(s.serviceAreas.id, serviceAreaId) });
  if (!area) throw new DomainError("not_found");
  const kinds = [...new Set(allowedSales)].filter((k) => DIRECT_KINDS.includes(k));
  const rows = await listAreasWithSales(actor);
  if (rows.find((r) => r.id === serviceAreaId)?.pendingRequest) throw new DomainError("area_sales_pending");
  return requestApproval(actor, "AREA_SALES_CHANGE", { serviceAreaId, allowedSales: kinds }, `Sale paths for ${area.name}: ${kinds.length ? kinds.join(", ") : "ladder only"}`);
}

/**
 * The road to a hub and the rains in its area (Prompt I §2.1). Planning data for restocking only — it changes how
 * much stock a hub is told to hold, never what anyone is paid — so one admin records it, and every change is logged.
 * When trip pay is built from it (Prompt I §3), changes must move under the two-admin rule.
 */
export const HubRoadInput = z.object({
  distanceKm: z.number().int().min(0).max(2000).nullable(),
  road: z.enum(ROAD_TYPES).nullable(),
  slowInRains: z.boolean(),
});
export type HubRoadInputT = z.infer<typeof HubRoadInput>;

export async function updateHubRoad(actor: Actor, hubId: string, raw: HubRoadInputT): Promise<void> {
  authorize(actor, "admin.area.roads");
  const input = HubRoadInput.parse(raw);
  await withTx(async (tx) => {
    const hub = await tx.query.hubs.findFirst({ where: eq(s.hubs.id, hubId) });
    if (!hub) throw new DomainError("not_found");
    await tx.update(s.hubs).set(input).where(eq(s.hubs.id, hubId));
    await logAdminAction(tx, actor.userId, "hub.road.update", { type: "hub", id: hubId }, { before: { distanceKm: hub.distanceKm, road: hub.road, slowInRains: hub.slowInRains }, after: input });
  });
}

/** The months (1–12) the rains slow the roads in an area; any order, duplicates dropped. */
export async function updateAreaRains(actor: Actor, serviceAreaId: string, months: number[]): Promise<void> {
  authorize(actor, "admin.area.roads");
  const rainyMonths = [...new Set(z.array(z.number().int().min(1).max(12)).max(12).parse(months))].sort((a, b) => a - b);
  await withTx(async (tx) => {
    const area = await tx.query.serviceAreas.findFirst({ where: eq(s.serviceAreas.id, serviceAreaId) });
    if (!area) throw new DomainError("not_found");
    await tx.update(s.serviceAreas).set({ rainyMonths }).where(eq(s.serviceAreas.id, serviceAreaId));
    await logAdminAction(tx, actor.userId, "area.rains.update", { type: "service_area", id: serviceAreaId }, { before: area.rainyMonths, after: rainyMonths });
  });
}

// ---------- public meeting points (Prompt L §3) ----------

/**
 * Where a delivery partner hands over a shop order: named public places only — a market, a dispensary gate, a school
 * gate. Never coordinates or a home address (§3.9). A girl meets her delivery partner where other people are.
 */
export const MeetingPointInput = z.object({
  serviceAreaId: z.uuid(),
  name: z.string().trim().min(3).max(60),
});

export async function meetingPointsFor(db: DbOrTx, serviceAreaId?: string, includeInactive = false) {
  const rows = await db.query.meetingPoints.findMany({
    where: and(serviceAreaId ? eq(s.meetingPoints.serviceAreaId, serviceAreaId) : sql`true`, includeInactive ? sql`true` : eq(s.meetingPoints.active, true)),
    orderBy: [s.meetingPoints.serviceAreaId, s.meetingPoints.name],
  });
  return rows;
}

export async function addMeetingPoint(actor: Actor, raw: z.input<typeof MeetingPointInput>): Promise<{ meetingPointId: string }> {
  authorize(actor, "admin.area.places");
  const input = MeetingPointInput.parse(raw);
  return withTx(async (tx) => {
    const area = await tx.query.serviceAreas.findFirst({ where: eq(s.serviceAreas.id, input.serviceAreaId) });
    if (!area) throw new DomainError("not_found");
    const clash = await tx.query.meetingPoints.findFirst({ where: and(eq(s.meetingPoints.serviceAreaId, area.id), sql`lower(${s.meetingPoints.name}) = lower(${input.name})`) });
    if (clash) throw new DomainError("meeting_point_exists");
    const [row] = await tx.insert(s.meetingPoints).values(input).returning({ id: s.meetingPoints.id });
    await logAdminAction(tx, actor.userId, "area.place.add", { type: "service_area", id: area.id }, { name: input.name });
    return { meetingPointId: row!.id };
  });
}

/** Retire a place (or bring it back). Open requests to it stay valid; new requests cannot choose it. */
export async function setMeetingPointActive(actor: Actor, meetingPointId: string, active: boolean): Promise<void> {
  authorize(actor, "admin.area.places");
  await withTx(async (tx) => {
    const mp = await tx.query.meetingPoints.findFirst({ where: eq(s.meetingPoints.id, meetingPointId) });
    if (!mp) throw new DomainError("not_found");
    await tx.update(s.meetingPoints).set({ active }).where(eq(s.meetingPoints.id, meetingPointId));
    await logAdminAction(tx, actor.userId, "area.place.update", { type: "service_area", id: mp.serviceAreaId }, { name: mp.name, active });
  });
}
