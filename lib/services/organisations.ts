/**
 * Buyer organisations (prompt §8.8.4): NGOs, non-profits, schools, community
 * groups that buy in bulk. A record, not a login — they pay by mobile money
 * and get the same SMS receipt and verify link a customer gets. Activation is
 * the STAKEHOLDER_ACTIVATE dual approval. Nothing about the people they
 * serve is stored.
 */
import { and, desc, eq, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { now } from "@/lib/clock";
import { getDb, type DbOrTx } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import { authorize, type Actor } from "@/lib/policy";
import { decryptString, encryptString } from "@/lib/crypto/envelope";
import { phoneBlindIndex } from "@/lib/crypto/blind-index";
import { maskPhone, TzPhoneSchema } from "@/lib/phone";
import { ORGANISATION_KINDS } from "@/lib/domain/types";
import { ORG_KINDS } from "@/lib/domain/sales";
import { DomainError, logAdminAction, withTx } from "./core";
import { requestApproval } from "./approvals";

type Row = typeof s.organisations.$inferSelect;
const blank = (v: string | undefined | null) => (v && v.trim().length ? v.trim() : null);

export const OrganisationInput = z
  .object({
    name: z.string().trim().min(2).max(120),
    kind: z.enum(ORGANISATION_KINDS),
    serviceAreaId: z.string().uuid(),
    contactName: z.string().trim().max(80).optional(),
    /** The phone the receipt and verify link go to. Required: an organisation without it cannot be sold to. */
    contactPhone: z.string().trim().max(20),
    notes: z.string().trim().max(1000).optional(),
  })
  .strict();
export type OrganisationInputT = z.input<typeof OrganisationInput>;

async function columns(input: z.infer<typeof OrganisationInput>) {
  const e164 = TzPhoneSchema.parse(input.contactPhone);
  return { name: input.name, kind: input.kind, serviceAreaId: input.serviceAreaId, contactName: blank(input.contactName), contactPhoneEnc: await encryptString(e164), contactPhoneIndex: phoneBlindIndex(e164), notes: blank(input.notes) };
}

export async function createOrganisation(actor: Actor, raw: OrganisationInputT): Promise<{ organisationId: string }> {
  authorize(actor, "admin.organisation.manage");
  const input = OrganisationInput.parse(raw);
  return withTx(async (tx) => {
    const area = await tx.query.serviceAreas.findFirst({ where: eq(s.serviceAreas.id, input.serviceAreaId) });
    if (!area) throw new DomainError("not_found");
    const [row] = await tx
      .insert(s.organisations)
      .values({ ...(await columns(input)), active: false })
      .returning({ id: s.organisations.id });
    await logAdminAction(tx, actor.userId, "organisation.create", { type: "organisation", id: row!.id }, { kind: input.kind });
    return { organisationId: row!.id };
  });
}

export async function updateOrganisation(actor: Actor, organisationId: string, raw: OrganisationInputT): Promise<void> {
  authorize(actor, "admin.organisation.manage");
  const input = OrganisationInput.parse(raw);
  await withTx(async (tx) => {
    const existing = await tx.query.organisations.findFirst({ where: eq(s.organisations.id, organisationId) });
    if (!existing) throw new DomainError("organisation_not_found");
    await tx
      .update(s.organisations)
      .set({ ...(await columns(input)), updatedAt: now() })
      .where(eq(s.organisations.id, organisationId));
    await logAdminAction(tx, actor.userId, "organisation.update", { type: "organisation", id: organisationId });
  });
}

async function pendingActivationIds(db: DbOrTx): Promise<Set<string>> {
  const rows = await db
    .select({ id: sql<string>`${s.approvalRequests.payload}->>'organisationId'` })
    .from(s.approvalRequests)
    .where(and(eq(s.approvalRequests.type, "STAKEHOLDER_ACTIVATE"), eq(s.approvalRequests.status, "PENDING")));
  return new Set(rows.map((r) => r.id).filter((x): x is string => !!x));
}

export async function requestOrganisationActivation(actor: Actor, organisationId: string, active: boolean): Promise<{ requestId: string }> {
  authorize(actor, "admin.organisation.manage");
  const org = await getDb().query.organisations.findFirst({ where: eq(s.organisations.id, organisationId) });
  if (!org) throw new DomainError("organisation_not_found");
  if (org.active === active) throw new DomainError("organisation_already_in_state");
  if ((await pendingActivationIds(getDb())).has(organisationId)) throw new DomainError("organisation_activation_pending");
  return requestApproval(actor, "STAKEHOLDER_ACTIVATE", { organisationId, active }, `${active ? "Activate" : "Deactivate"} organisation ${org.name}`);
}

export interface OrganisationSummary {
  id: string;
  name: string;
  kind: Row["kind"];
  areaId: string | null;
  areaName: string;
  active: boolean;
  pendingActivation: boolean;
  contactName: string | null;
  contactPhoneMasked: string;
  orders: number;
  openOrders: number;
  confirmedTzs: number;
  lastOrderAt: Date | null;
}

async function summarise(db: DbOrTx, o: Row, areaName: string, pending: boolean): Promise<OrganisationSummary> {
  const [agg] = await db
    .select({
      n: sql<number>`count(*)::int`,
      open: sql<number>`count(*) filter (where ${s.orders.state} not in ('COMPLETED','CANCELLED','CLOSED'))::int`,
      last: sql<Date | null>`max(${s.orders.createdAt})`,
    })
    .from(s.orders)
    .where(eq(s.orders.organisationId, o.id));
  const [money] = await db
    .select({ tzs: sql<number>`coalesce(sum(${s.paymentIntents.confirmedAmountTzs}), 0)::int` })
    .from(s.paymentIntents)
    .innerJoin(s.orders, eq(s.orders.id, s.paymentIntents.orderId))
    .where(and(eq(s.orders.organisationId, o.id), eq(s.paymentIntents.status, "PAYMENT_CONFIRMED")));
  return {
    id: o.id,
    name: o.name,
    kind: o.kind,
    areaId: o.serviceAreaId,
    areaName,
    active: o.active,
    pendingActivation: pending,
    contactName: o.contactName,
    contactPhoneMasked: o.contactPhoneEnc ? maskPhone(await decryptString(o.contactPhoneEnc)) : "—",
    orders: Number(agg?.n ?? 0),
    openOrders: Number(agg?.open ?? 0),
    confirmedTzs: Number(money?.tzs ?? 0),
    lastOrderAt: agg?.last ? new Date(agg.last) : null,
  };
}

export async function listOrganisations(actor: Actor): Promise<OrganisationSummary[]> {
  authorize(actor, "admin.organisation.view");
  const db = getDb();
  const rows = await db.query.organisations.findMany({ orderBy: [desc(s.organisations.active), s.organisations.name] });
  const areas = new Map((await db.query.serviceAreas.findMany()).map((a) => [a.id, a.name]));
  const pending = await pendingActivationIds(db);
  const out: OrganisationSummary[] = [];
  for (const o of rows) out.push(await summarise(db, o, areas.get(o.serviceAreaId ?? "") ?? "—", pending.has(o.id)));
  return out;
}

export interface OrganisationDetail {
  summary: OrganisationSummary;
  notes: string | null;
  orders: { id: string; ref: string; kind: string; state: string; sellerName: string; productName: string; quantity: number; totalTzs: number; confirmedTzs: number; createdAt: Date }[];
  history: { id: string; status: string; active: boolean; createdAt: Date; requestedBy: string }[];
}

export async function organisationDetail(actor: Actor, organisationId: string): Promise<OrganisationDetail | null> {
  authorize(actor, "admin.organisation.view");
  const db = getDb();
  const o = await db.query.organisations.findFirst({ where: eq(s.organisations.id, organisationId) });
  if (!o) return null;
  const area = o.serviceAreaId ? await db.query.serviceAreas.findFirst({ where: eq(s.serviceAreas.id, o.serviceAreaId) }) : null;
  const pending = await pendingActivationIds(db);
  const summary = await summarise(db, o, area?.name ?? "—", pending.has(o.id));
  const rows = await db
    .select({
      o: s.orders,
      sellerName: s.users.displayName,
      productName: s.products.name,
      confirmed: sql<number>`coalesce((select sum(pi.confirmed_amount_tzs) from payment_intents pi where pi.order_id = ${s.orders.id} and pi.status = 'PAYMENT_CONFIRMED'), 0)::int`,
    })
    .from(s.orders)
    .innerJoin(s.users, eq(s.users.id, s.orders.sellerUserId))
    .innerJoin(s.products, eq(s.products.id, s.orders.productId))
    .where(eq(s.orders.organisationId, organisationId))
    .orderBy(desc(s.orders.createdAt))
    .limit(100);
  const historyRows = await db
    .select({ r: s.approvalRequests, requestedBy: s.users.displayName })
    .from(s.approvalRequests)
    .leftJoin(s.users, eq(s.users.id, s.approvalRequests.requestedBy))
    .where(and(eq(s.approvalRequests.type, "STAKEHOLDER_ACTIVATE"), sql`${s.approvalRequests.payload}->>'organisationId' = ${organisationId}`))
    .orderBy(desc(s.approvalRequests.createdAt))
    .limit(50);
  return {
    summary,
    notes: o.notes,
    orders: rows.map((r) => ({ id: r.o.id, ref: r.o.ref, kind: r.o.kind, state: r.o.state, sellerName: r.sellerName, productName: r.productName, quantity: r.o.quantity, totalTzs: r.o.totalTzs, confirmedTzs: Number(r.confirmed), createdAt: r.o.createdAt })),
    history: historyRows.map((h) => ({ id: h.r.id, status: h.r.status, active: !!(h.r.payload as { active?: boolean }).active, createdAt: h.r.createdAt, requestedBy: h.requestedBy ?? "—" })),
  };
}

/** Active organisations a seller in this area may sell to (the field app's form). */
export async function organisationsForSale(db: DbOrTx, serviceAreaId: string): Promise<{ id: string; name: string; kind: Row["kind"] }[]> {
  const rows = await db.query.organisations.findMany({ where: and(eq(s.organisations.serviceAreaId, serviceAreaId), eq(s.organisations.active, true), ne(s.organisations.contactPhoneEnc, "")), orderBy: s.organisations.name });
  return rows.map((r) => ({ id: r.id, name: r.name, kind: r.kind }));
}

export { ORG_KINDS };
