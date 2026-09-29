/**
 * Supplier organisations (Prompt B §8, ADR-029): the company that
 * manufactures or sells the products. Reference data is admin-edited,
 * activation is dual-approved, every user of the organisation sees the same
 * organisation view, and money is shown only as the provider confirmed it.
 */
import { and, desc, eq, gte, inArray, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { now, nowMs } from "@/lib/clock";
import { getDb } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import { authorize, type Actor } from "@/lib/policy";
import { decryptString, encryptString } from "@/lib/crypto/envelope";
import { phoneBlindIndex } from "@/lib/crypto/blind-index";
import { maskPhone, TzPhoneSchema } from "@/lib/phone";
import { tzDay, tzMonthStart, tzWeekStart } from "@/lib/util/time";
import { isOpenPickup, qualitySignal, SUPPLIER_QUALITY_TYPES, sumConfirmedSince, waitingPastLeadTime, type QualitySignal } from "@/lib/domain/suppliers";
import { DomainError, logAdminAction, withTx } from "./core";
import { requestApproval } from "./approvals";

type Db = ReturnType<typeof getDb>;
type SupplierRow = typeof s.suppliers.$inferSelect;

const blank = (v: string | undefined | null) => (v && v.trim().length ? v.trim() : null);

export const SupplierInput = z
  .object({
    businessName: z.string().trim().min(2).max(120),
    serviceAreaId: z.string().uuid(),
    contactName: z.string().trim().max(80).optional(),
    contactPhone: z.string().trim().max(20).optional(),
    leadTimeDays: z.coerce.number().int().min(0).max(60).default(2),
    paymentTermsNote: z.string().trim().max(200).optional(),
    notes: z.string().trim().max(1000).optional(),
  })
  .strict();
export type SupplierInputT = z.input<typeof SupplierInput>;

async function contactColumns(input: z.infer<typeof SupplierInput>) {
  const phone = blank(input.contactPhone);
  const e164 = phone ? TzPhoneSchema.parse(phone) : null;
  return {
    businessName: input.businessName,
    serviceAreaId: input.serviceAreaId,
    contactName: blank(input.contactName),
    contactPhoneEnc: e164 ? await encryptString(e164) : null,
    contactPhoneIndex: e164 ? phoneBlindIndex(e164) : null,
    leadTimeDays: input.leadTimeDays,
    paymentTermsNote: blank(input.paymentTermsNote),
    notes: blank(input.notes),
  };
}

// ---------- admin: reference data ----------

/** New suppliers start inactive: activation is a dual approval (STAKEHOLDER_ACTIVATE). */
export async function createSupplier(actor: Actor, raw: SupplierInputT): Promise<{ supplierId: string }> {
  authorize(actor, "admin.supplier.manage");
  const input = SupplierInput.parse(raw);
  return withTx(async (tx) => {
    const area = await tx.query.serviceAreas.findFirst({ where: eq(s.serviceAreas.id, input.serviceAreaId) });
    if (!area) throw new DomainError("not_found");
    const [row] = await tx
      .insert(s.suppliers)
      .values({ ...(await contactColumns(input)), active: false })
      .returning({ id: s.suppliers.id });
    await logAdminAction(tx, actor.userId, "supplier.create", { type: "supplier", id: row!.id }, { businessName: input.businessName });
    return { supplierId: row!.id };
  });
}

export async function updateSupplier(actor: Actor, supplierId: string, raw: SupplierInputT): Promise<void> {
  authorize(actor, "admin.supplier.manage");
  const input = SupplierInput.parse(raw);
  await withTx(async (tx) => {
    const existing = await tx.query.suppliers.findFirst({ where: eq(s.suppliers.id, supplierId) });
    if (!existing) throw new DomainError("supplier_not_found");
    const { contactPhoneEnc, contactPhoneIndex, ...rest } = await contactColumns(input);
    // A blank phone keeps the current number (the form never echoes it back).
    const phone = blank(input.contactPhone) ? { contactPhoneEnc, contactPhoneIndex } : {};
    await tx
      .update(s.suppliers)
      .set({ ...rest, ...phone, updatedAt: now() })
      .where(eq(s.suppliers.id, supplierId));
    await logAdminAction(tx, actor.userId, "supplier.update", { type: "supplier", id: supplierId }, { fields: Object.keys(input) });
  });
}

/** Which products the supplier supplies; a pickup can only be assigned for an offered product. */
export async function setSupplierProduct(actor: Actor, supplierId: string, productId: string, offered: boolean, supplierSku?: string): Promise<void> {
  authorize(actor, "admin.supplier.manage");
  const sku = z.string().trim().max(40).optional().parse(supplierSku);
  await withTx(async (tx) => {
    const supplier = await tx.query.suppliers.findFirst({ where: eq(s.suppliers.id, supplierId) });
    const product = await tx.query.products.findFirst({ where: eq(s.products.id, productId) });
    if (!supplier || !product) throw new DomainError("not_found");
    await tx
      .insert(s.supplierProducts)
      .values({ supplierId, productId, supplierSku: blank(sku), active: offered })
      .onConflictDoUpdate({ target: [s.supplierProducts.supplierId, s.supplierProducts.productId], set: { supplierSku: blank(sku), active: offered } });
    await logAdminAction(tx, actor.userId, offered ? "supplier.product.offer" : "supplier.product.withdraw", { type: "supplier", id: supplierId }, { productId, supplierSku: blank(sku) });
  });
}

/** Activation and deactivation go through the dual approval; one open request per supplier at a time. */
export async function requestSupplierActivation(actor: Actor, supplierId: string, active: boolean): Promise<{ requestId: string }> {
  authorize(actor, "admin.supplier.manage");
  const supplier = await getDb().query.suppliers.findFirst({ where: eq(s.suppliers.id, supplierId) });
  if (!supplier) throw new DomainError("supplier_not_found");
  if (supplier.active === active) throw new DomainError("supplier_already_in_state");
  if ((await pendingActivationIds(getDb())).has(supplierId)) throw new DomainError("supplier_activation_pending");
  return requestApproval(actor, "STAKEHOLDER_ACTIVATE", { supplierId, active }, `${active ? "Activate" : "Deactivate"} supplier ${supplier.businessName}`);
}

async function pendingActivationIds(db: Db): Promise<Set<string>> {
  const rows = await db
    .select({ supplierId: sql<string>`${s.approvalRequests.payload}->>'supplierId'` })
    .from(s.approvalRequests)
    .where(and(eq(s.approvalRequests.type, "STAKEHOLDER_ACTIVATE"), eq(s.approvalRequests.status, "PENDING")));
  return new Set(rows.map((r) => r.supplierId).filter((x): x is string => !!x));
}

// ---------- admin: directory and detail ----------

export interface SupplierSummary {
  id: string;
  businessName: string;
  areaName: string;
  active: boolean;
  pendingActivation: boolean;
  leadTimeDays: number;
  products: string[];
  users: number;
  lastPickupAt: Date | null;
  openPickups: number;
  waitingPastLeadTime: number;
  quality: QualitySignal;
}

const QUALITY_WINDOW_MS = 30 * 86_400_000;

async function supplierBatchIds(db: Db, supplierId: string, since: Date): Promise<string[]> {
  const rows = await db.select({ id: s.batches.id }).from(s.batches).where(and(eq(s.batches.supplierId, supplierId), gte(s.batches.createdAt, since)));
  return rows.map((r) => r.id);
}

async function issueBatchIds(db: Db, batchIds: string[]): Promise<Set<string>> {
  if (!batchIds.length) return new Set();
  const rows = await db
    .select({ batchId: s.exceptions.batchId })
    .from(s.exceptions)
    .where(and(inArray(s.exceptions.type, [...SUPPLIER_QUALITY_TYPES]), inArray(s.exceptions.batchId, batchIds)));
  return new Set(rows.map((r) => r.batchId).filter((x): x is string => !!x));
}

async function summarise(db: Db, sup: SupplierRow, areaName: string, pending: boolean): Promise<SupplierSummary> {
  const products = await db
    .select({ name: s.products.name })
    .from(s.supplierProducts)
    .innerJoin(s.products, eq(s.products.id, s.supplierProducts.productId))
    .where(and(eq(s.supplierProducts.supplierId, sup.id), eq(s.supplierProducts.active, true)))
    .orderBy(s.products.name);
  const [users] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(s.users)
    .where(and(eq(s.users.supplierId, sup.id), ne(s.users.status, "REMOVED")));
  const pickups = await db
    .select({ state: s.orders.state, createdAt: s.orders.createdAt })
    .from(s.orders)
    .where(and(eq(s.orders.kind, "SUPPLIER_TO_RIDER"), eq(s.orders.supplierId, sup.id)))
    .orderBy(desc(s.orders.createdAt))
    .limit(500);
  const since = new Date(nowMs() - QUALITY_WINDOW_MS);
  const batchIds = await supplierBatchIds(db, sup.id, since);
  return {
    id: sup.id,
    businessName: sup.businessName,
    areaName,
    active: sup.active,
    pendingActivation: pending,
    leadTimeDays: sup.leadTimeDays,
    products: products.map((p) => p.name),
    users: Number(users?.n ?? 0),
    lastPickupAt: pickups[0]?.createdAt ?? null,
    openPickups: pickups.filter((p) => isOpenPickup(p.state)).length,
    waitingPastLeadTime: waitingPastLeadTime(pickups, sup.leadTimeDays, now()),
    quality: qualitySignal(batchIds, await issueBatchIds(db, batchIds)),
  };
}

export async function listSuppliers(actor: Actor): Promise<SupplierSummary[]> {
  authorize(actor, "admin.supplier.view");
  const db = getDb();
  const rows = await db.query.suppliers.findMany({ orderBy: [desc(s.suppliers.active), s.suppliers.businessName] });
  const areas = new Map((await db.query.serviceAreas.findMany()).map((a) => [a.id, a.name]));
  const pending = await pendingActivationIds(db);
  const out: SupplierSummary[] = [];
  for (const sup of rows) out.push(await summarise(db, sup, areas.get(sup.serviceAreaId ?? "") ?? "—", pending.has(sup.id)));
  return out;
}

export interface SupplierDetail {
  summary: SupplierSummary;
  supplier: Omit<SupplierRow, "contactPhoneEnc" | "contactPhoneIndex"> & { contactPhoneMasked: string | null };
  users: { id: string; displayName: string; status: string; phoneMasked: string }[];
  products: { productId: string; name: string; offered: boolean; supplierSku: string | null }[];
  priceLists: { id: string; version: number; status: string; effectiveFrom: string; areaName: string }[];
  pickups: { id: string; ref: string; state: string; quantity: number; productName: string; riderName: string; pickupDate: string | null; createdAt: Date }[];
  payments: { confirmedWeekTzs: number; confirmedMonthTzs: number; rows: { id: string; amountTzs: number; confirmedAt: Date; orderRef: string; providerTxRef: string; statementMatched: boolean }[] };
  quality: { ref: string; type: string; status: string; createdAt: Date; batchCode: string | null }[];
  history: { id: string; status: string; active: boolean; createdAt: Date; decidedAt: Date | null; requestedBy: string }[];
}

export async function supplierDetail(actor: Actor, supplierId: string): Promise<SupplierDetail | null> {
  authorize(actor, "admin.supplier.view");
  const db = getDb();
  const sup = await db.query.suppliers.findFirst({ where: eq(s.suppliers.id, supplierId) });
  if (!sup) return null;
  const area = sup.serviceAreaId ? await db.query.serviceAreas.findFirst({ where: eq(s.serviceAreas.id, sup.serviceAreaId) }) : null;
  const pending = await pendingActivationIds(db);
  const summary = await summarise(db, sup, area?.name ?? "—", pending.has(sup.id));

  const userRows = await db.query.users.findMany({ where: and(eq(s.users.supplierId, supplierId), ne(s.users.status, "REMOVED")), orderBy: s.users.displayName });
  const users = await Promise.all(userRows.map(async (u) => ({ id: u.id, displayName: u.displayName, status: u.status, phoneMasked: maskPhone(await decryptString(u.phoneEnc)) })));
  const userIds = userRows.map((u) => u.id);

  const offered = await db.query.supplierProducts.findMany({ where: eq(s.supplierProducts.supplierId, supplierId) });
  const products = (await db.query.products.findMany({ where: eq(s.products.active, true), orderBy: s.products.name })).map((p) => {
    const row = offered.find((o) => o.productId === p.id);
    return { productId: p.id, name: p.name, offered: !!row?.active, supplierSku: row?.supplierSku ?? null };
  });

  const areas = new Map((await db.query.serviceAreas.findMany()).map((a) => [a.id, a.name]));
  const priceLists = (await db.query.priceLists.findMany({ where: eq(s.priceLists.supplierId, supplierId), orderBy: desc(s.priceLists.version) })).map((p) => ({
    id: p.id,
    version: p.version,
    status: p.status,
    effectiveFrom: p.effectiveFrom,
    areaName: areas.get(p.serviceAreaId) ?? "—",
  }));

  const pickupRows = await db
    .select({ o: s.orders, productName: s.products.name, riderName: s.users.displayName })
    .from(s.orders)
    .innerJoin(s.products, eq(s.products.id, s.orders.productId))
    .leftJoin(s.users, eq(s.users.id, s.orders.buyerUserId))
    .where(and(eq(s.orders.kind, "SUPPLIER_TO_RIDER"), eq(s.orders.supplierId, supplierId)))
    .orderBy(desc(s.orders.createdAt))
    .limit(50);
  const pickups = pickupRows.map((r) => ({ id: r.o.id, ref: r.o.ref, state: r.o.state, quantity: r.o.quantity, productName: r.productName, riderName: r.riderName ?? "—", pickupDate: r.o.pickupDate, createdAt: r.o.createdAt }));

  const since90 = new Date(nowMs() - 90 * 86_400_000);
  const intentRows = userIds.length
    ? await db
        .select({ i: s.paymentIntents, orderRef: s.orders.ref })
        .from(s.paymentIntents)
        .innerJoin(s.orders, eq(s.orders.id, s.paymentIntents.orderId))
        .where(and(inArray(s.paymentIntents.payeeUserId, userIds), eq(s.paymentIntents.status, "PAYMENT_CONFIRMED"), gte(s.paymentIntents.confirmedAt, since90)))
        .orderBy(desc(s.paymentIntents.confirmedAt))
        .limit(200)
    : [];
  const txRefs = intentRows.map((r) => r.i.providerTxRef).filter((x): x is string => !!x);
  const matched = new Set(
    txRefs.length ? (await db.select({ ref: s.providerStatementRows.providerTxRef }).from(s.providerStatementRows).where(inArray(s.providerStatementRows.providerTxRef, txRefs))).map((r) => r.ref) : [],
  );
  const intents = intentRows.map((r) => r.i);
  const payments = {
    confirmedWeekTzs: sumConfirmedSince(intents, tzWeekStart()),
    confirmedMonthTzs: sumConfirmedSince(intents, tzMonthStart()),
    rows: intentRows.map((r) => ({ id: r.i.id, amountTzs: r.i.confirmedAmountTzs ?? 0, confirmedAt: r.i.confirmedAt!, orderRef: r.orderRef, providerTxRef: r.i.providerTxRef ?? "", statementMatched: !!r.i.providerTxRef && matched.has(r.i.providerTxRef) })),
  };

  const batchIds = await supplierBatchIds(db, supplierId, since90);
  const qualityRows = batchIds.length
    ? await db
        .select({ e: s.exceptions, batchCode: s.batches.code })
        .from(s.exceptions)
        .leftJoin(s.batches, eq(s.batches.id, s.exceptions.batchId))
        .where(and(inArray(s.exceptions.type, [...SUPPLIER_QUALITY_TYPES]), inArray(s.exceptions.batchId, batchIds)))
        .orderBy(desc(s.exceptions.createdAt))
        .limit(50)
    : [];
  const quality = qualityRows.map((r) => ({ ref: r.e.ref, type: r.e.type, status: r.e.status, createdAt: r.e.createdAt, batchCode: r.batchCode }));

  const historyRows = await db
    .select({ r: s.approvalRequests, requestedBy: s.users.displayName })
    .from(s.approvalRequests)
    .leftJoin(s.users, eq(s.users.id, s.approvalRequests.requestedBy))
    .where(and(eq(s.approvalRequests.type, "STAKEHOLDER_ACTIVATE"), sql`${s.approvalRequests.payload}->>'supplierId' = ${supplierId}`))
    .orderBy(desc(s.approvalRequests.createdAt))
    .limit(50);
  const history = historyRows.map((h) => ({ id: h.r.id, status: h.r.status, active: !!(h.r.payload as { active?: boolean }).active, createdAt: h.r.createdAt, decidedAt: h.r.decidedAt, requestedBy: h.requestedBy ?? "—" }));

  const { contactPhoneEnc, contactPhoneIndex: _idx, ...rest } = sup;
  return {
    summary,
    supplier: { ...rest, contactPhoneMasked: contactPhoneEnc ? maskPhone(await decryptString(contactPhoneEnc)) : null },
    users,
    products,
    priceLists,
    pickups,
    payments,
    quality,
    history,
  };
}

/** (supplier, product) pairs a pickup may be assigned for: active suppliers, offered and active products. */
export async function pickupPairs(actor: Actor): Promise<{ supplierId: string; supplierName: string; productId: string; productName: string }[]> {
  authorize(actor, "admin.dashboard");
  return getDb()
    .select({ supplierId: s.suppliers.id, supplierName: s.suppliers.businessName, productId: s.products.id, productName: s.products.name })
    .from(s.supplierProducts)
    .innerJoin(s.suppliers, eq(s.suppliers.id, s.supplierProducts.supplierId))
    .innerJoin(s.products, eq(s.products.id, s.supplierProducts.productId))
    .where(and(eq(s.supplierProducts.active, true), eq(s.suppliers.active, true), eq(s.products.active, true)))
    .orderBy(s.suppliers.businessName, s.products.name);
}

// ---------- supplier-side home (One Screen rule: display only) ----------

export interface SupplierHome {
  businessName: string;
  todayCount: number;
  pickups: { id: string; ref: string; state: string; quantity: number; productName: string; riderName: string; pickupDate: string | null }[];
  confirmedWeekTzs: number;
  confirmedMonthTzs: number;
  quality: { ref: string; type: string; status: string; createdAt: Date }[];
}

export async function supplierHome(actor: Actor): Promise<SupplierHome> {
  authorize(actor, "supplier.home.view");
  const db = getDb();
  const supplierId = actor.supplierId!;
  const sup = await db.query.suppliers.findFirst({ where: eq(s.suppliers.id, supplierId) });
  const weekStart = tzWeekStart();
  const rows = await db
    .select({ o: s.orders, productName: s.products.name, riderName: s.users.displayName })
    .from(s.orders)
    .innerJoin(s.products, eq(s.products.id, s.orders.productId))
    .leftJoin(s.users, eq(s.users.id, s.orders.buyerUserId))
    .where(and(eq(s.orders.kind, "SUPPLIER_TO_RIDER"), eq(s.orders.supplierId, supplierId), sql`(${s.orders.completedAt} is null or ${s.orders.completedAt} >= ${weekStart})`))
    .orderBy(desc(s.orders.createdAt))
    .limit(30);
  const today = tzDay();
  const userIds = (await db.query.users.findMany({ where: eq(s.users.supplierId, supplierId), columns: { id: true } })).map((u) => u.id);
  const intents = userIds.length
    ? await db.query.paymentIntents.findMany({ where: and(inArray(s.paymentIntents.payeeUserId, userIds), eq(s.paymentIntents.status, "PAYMENT_CONFIRMED"), gte(s.paymentIntents.confirmedAt, tzMonthStart())) })
    : [];
  const batchIds = await supplierBatchIds(db, supplierId, new Date(nowMs() - QUALITY_WINDOW_MS));
  const quality = batchIds.length
    ? await db.query.exceptions.findMany({ where: and(inArray(s.exceptions.type, [...SUPPLIER_QUALITY_TYPES]), inArray(s.exceptions.batchId, batchIds)), orderBy: desc(s.exceptions.createdAt), limit: 20 })
    : [];
  return {
    businessName: sup?.businessName ?? "",
    todayCount: rows.filter((r) => r.o.pickupDate === today).length,
    pickups: rows.map((r) => ({ id: r.o.id, ref: r.o.ref, state: r.o.state, quantity: r.o.quantity, productName: r.productName, riderName: r.riderName ?? "—", pickupDate: r.o.pickupDate })),
    confirmedWeekTzs: sumConfirmedSince(intents, weekStart),
    confirmedMonthTzs: sumConfirmedSince(intents, tzMonthStart()),
    quality: quality.map((e) => ({ ref: e.ref, type: e.type, status: e.status, createdAt: e.createdAt })),
  };
}
