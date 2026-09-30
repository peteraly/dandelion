/**
 * Per-area sale-path switches (prompt §8.8.2). The handbook ladder is always
 * allowed; every other path is off until two admins turn it on for an area,
 * because it decides who earns. The demo profile turns everything on.
 */
import { and, eq, sql } from "drizzle-orm";
import type { DbOrTx } from "@/lib/db/client";
import { getDb } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import { authorize, type Actor } from "@/lib/policy";
import { DIRECT_KINDS, LADDER_KINDS, saleAllowed, saleFor } from "@/lib/domain/sales";
import type { OrderKind } from "@/lib/domain/types";
import { DomainError } from "./core";
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
