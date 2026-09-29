/**
 * Orders along the chain: supplier→rider (pickup), rider→hub (delivery),
 * hub→champion (transfer), champion→customer (sale with installments).
 *
 * Every action: policy check → state machine → DB writes (+ LedgerEvent) in
 * one transaction. Prices always come from the active dual-approved price
 * list (§3.5); no amount is ever taken from user input.
 */
import { now, nowMs } from "@/lib/clock";
import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import type { Tx } from "@/lib/db/client";
import { getDb } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import { ORDER_MACHINES, INITIAL_ORDER_STATE, type OrderCtx, type OrderEvent } from "@/lib/domain/orders";
import type { DualApprovalProof } from "@/lib/domain/approval";
import { isLocked } from "@/lib/domain/custody";
import type { OrderKind } from "@/lib/domain/types";
import { authorize, type Actor, type OrderResource } from "@/lib/policy";
import { humanCode, numericCode, randomRef128, randomToken, sha256Hex } from "@/lib/crypto/random";
import { encryptString, decryptString } from "@/lib/crypto/envelope";
import { codeMatches, hashCode } from "@/lib/auth/secrets";
import { getSmsProvider } from "@/lib/sms";
import { tr, type Locale } from "@/lib/i18n/server-translator";
import { appOrigin } from "@/lib/env";
import { formatTzs } from "@/lib/money";
import { tzDay } from "@/lib/util/time";
import { DomainError, logAdminAction, recordLedgerEvent, withTx, type ServiceActor } from "./core";
import { applyCustody, lockBatch, registerBatch, returnToParent, splitBatch } from "./custody";
import { ensureOpenIntent, enqueuePoll, openIntent, paidTotals, type Order } from "./payments";
import { activePriceItem } from "./pricing";
import { createReceipt } from "./receipts";

export const asService = (a: Actor): ServiceActor => ({ kind: a.role, userId: a.userId });

async function uniqueRef(tx: Tx, prefix: string, len: number, col: "ref" | "paymentRef"): Promise<string> {
  for (let i = 0; i < 6; i++) {
    const v = prefix + humanCode(len);
    const hit = await tx.query.orders.findFirst({ where: eq(col === "ref" ? s.orders.ref : s.orders.paymentRef, v), columns: { id: true } });
    if (!hit) return v;
  }
  throw new Error("could not allocate order reference");
}

export async function lockOrder(tx: Tx, orderId: string): Promise<Order> {
  const rows = await tx.select().from(s.orders).where(eq(s.orders.id, orderId)).for("update");
  if (!rows[0]) throw new DomainError("not_found");
  return rows[0];
}

export async function orderResource(db: Tx | ReturnType<typeof getDb>, o: Order): Promise<OrderResource> {
  let customerChampionId: string | null = null;
  if (o.customerId) {
    const c = await db.query.customers.findFirst({ where: eq(s.customers.id, o.customerId), columns: { championId: true } });
    customerChampionId = c?.championId ?? null;
  }
  return { kind: o.kind, sellerUserId: o.sellerUserId, buyerUserId: o.buyerUserId, supplierId: o.supplierId, hubId: o.hubId, customerChampionId };
}

export async function applyOrder(tx: Tx, order: Order, event: OrderEvent, actor: ServiceActor, ctx: OrderCtx, patch: Partial<typeof s.orders.$inferInsert> = {}): Promise<Order> {
  const res = ORDER_MACHINES[order.kind].transition(order.state, event, actor.kind, ctx);
  if (!res.ok) throw new DomainError("transition_refused", res.reason);
  const [o] = await tx
    .update(s.orders)
    .set({ ...patch, state: res.to, updatedAt: now(), completedAt: res.to === "COMPLETED" ? now() : undefined })
    .where(eq(s.orders.id, order.id))
    .returning();
  return o!;
}

async function actOn(actor: Actor, orderId: string, action: Parameters<typeof authorize>[1], fn: (tx: Tx, order: Order) => Promise<void>): Promise<void> {
  await withTx(async (tx) => {
    const order = await lockOrder(tx, orderId);
    authorize(actor, action, { type: "order", order: await orderResource(tx, order) });
    await fn(tx, order);
  });
}

async function userLocale(tx: Tx, userId: string): Promise<{ locale: Locale; name: string; phone: string }> {
  const u = await tx.query.users.findFirst({ where: eq(s.users.id, userId) });
  if (!u) throw new DomainError("not_found");
  return { locale: u.preferredLocale, name: u.displayName, phone: await decryptString(u.phoneEnc) };
}

async function customerContact(tx: Tx, customerId: string): Promise<{ locale: Locale; name: string; phone: string }> {
  const c = await tx.query.customers.findFirst({ where: eq(s.customers.id, customerId) });
  if (!c) throw new DomainError("not_found");
  return { locale: "sw", name: c.displayName, phone: await decryptString(c.phoneEnc) };
}

async function firstActiveUser(tx: Tx, where: ReturnType<typeof and>): Promise<typeof s.users.$inferSelect> {
  const u = await tx.query.users.findFirst({ where: and(where, eq(s.users.status, "ACTIVE")) });
  if (!u) throw new DomainError("counterparty_unavailable");
  return u;
}

// ================= A/B. Supplier → rider (pickup) =================

export const CreatePickupSchema = z
  .object({
    supplierId: z.string().uuid(),
    productId: z.string().uuid(),
    hubId: z.string().uuid(),
    riderId: z.string().uuid(),
    quantity: z.coerce.number().int().min(1).max(10_000),
    pickupDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  })
  .strict();

export async function adminCreatePickup(actor: Actor, raw: z.input<typeof CreatePickupSchema>): Promise<{ orderId: string }> {
  authorize(actor, "admin.pickup.create");
  const input = CreatePickupSchema.parse(raw);
  return withTx(async (tx) => {
    const supplier = await tx.query.suppliers.findFirst({ where: eq(s.suppliers.id, input.supplierId) });
    const hub = await tx.query.hubs.findFirst({ where: eq(s.hubs.id, input.hubId) });
    if (!supplier?.active || !supplier.serviceAreaId) throw new DomainError("supplier_not_active");
    if (!hub?.active) throw new DomainError("hub_not_active");
    const supplierUser = await firstActiveUser(tx, and(eq(s.users.role, "SUPPLIER"), eq(s.users.supplierId, supplier.id)));
    const rider = await tx.query.users.findFirst({ where: eq(s.users.id, input.riderId) });
    if (!rider || rider.role !== "BOSS_RIDER" || rider.status !== "ACTIVE") throw new DomainError("rider_not_active");
    const item = await activePriceItem(tx, { serviceAreaId: hub.serviceAreaId, productId: input.productId, supplierId: supplier.id });
    const [order] = await tx
      .insert(s.orders)
      .values({
        ref: await uniqueRef(tx, "OR-", 6, "ref"),
        verifyRef: randomRef128(),
        paymentRef: await uniqueRef(tx, "", 8, "paymentRef"),
        kind: "SUPPLIER_TO_RIDER",
        state: INITIAL_ORDER_STATE.SUPPLIER_TO_RIDER,
        sellerUserId: supplierUser.id,
        buyerUserId: rider.id,
        supplierId: supplier.id,
        hubId: hub.id,
        productId: input.productId,
        priceListItemId: item.id,
        quantity: input.quantity,
        unitPriceTzs: item.supplierPriceTzs,
        totalTzs: item.supplierPriceTzs * input.quantity,
        unitCostTzs: 0,
        pickupDate: input.pickupDate,
        createdBy: actor.userId,
      })
      .returning();
    const product = await tx.query.products.findFirst({ where: eq(s.products.id, input.productId) });
    const r = await userLocale(tx, rider.id);
    await getSmsProvider().send(
      r.phone,
      tr(r.locale, "sms.pickup", {
        name: r.name,
        product: product?.name ?? "",
        quantity: input.quantity,
        supplier: supplier.businessName,
        amount: formatTzs(order!.totalTzs, r.locale),
      }),
      "PICKUP",
      tx,
    );
    await logAdminAction(tx, actor.userId, "pickup.create", { type: "order", id: order!.id }, { quantity: input.quantity });
    return { orderId: order!.id };
  });
}

export async function confirmBatchReady(actor: Actor, orderId: string, sealIdRaw: string): Promise<void> {
  const sealId = z.string().trim().min(1).max(40).regex(/^[A-Za-z0-9-]+$/).safeParse(sealIdRaw);
  if (!sealId.success) throw new DomainError("seal_id_invalid");
  await actOn(actor, orderId, "order.confirm_batch_ready", async (tx, order) => {
    const hub = await tx.query.hubs.findFirst({ where: eq(s.hubs.id, order.hubId!) });
    const batch = await registerBatch(tx, asService(actor), {
      supplierId: order.supplierId!,
      productId: order.productId,
      serviceAreaId: hub!.serviceAreaId,
      quantity: order.quantity,
      sealId: sealId.data,
      custodianUserId: order.sellerUserId,
      orderId: order.id,
    });
    await applyOrder(tx, order, "CONFIRM_BATCH_READY", asService(actor), {}, { batchId: batch.id });
  });
}

export async function acceptPickup(actor: Actor, orderId: string): Promise<void> {
  await actOn(actor, orderId, "order.accept_pickup", async (tx, order) => {
    const batch = await lockBatch(tx, order.batchId!);
    await applyCustody(tx, batch, "RESERVE_FOR_RIDER", asService(actor), {}, { orderId: order.id });
    const updated = await applyOrder(tx, order, "ACCEPT_PICKUP", asService(actor), {});
    await ensureOpenIntent(tx, updated);
  });
}

/**
 * "I have paid". This NEVER confirms anything: it records the claim and asks
 * the verifier to query the provider. Returns the verification job id.
 */
export async function claimPaid(actor: Actor, orderId: string): Promise<{ jobId: string }> {
  let jobId = "";
  await actOn(actor, orderId, "order.claim_paid", async (tx, order) => {
    if (order.state !== "AWAITING_PAYMENT") throw new DomainError("not_awaiting_payment");
    const intent = await ensureOpenIntent(tx, order);
    if (!intent.payerClaimedAt) {
      await tx.update(s.paymentIntents).set({ payerClaimedAt: now(), updatedAt: now() }).where(eq(s.paymentIntents.id, intent.id));
    }
    if (order.kind === "SUPPLIER_TO_RIDER" && order.batchId) {
      const batch = await lockBatch(tx, order.batchId);
      if (batch.custodyState === "RESERVED_FOR_RIDER") await applyCustody(tx, batch, "PAYMENT_CLAIMED", asService(actor), {}, { orderId: order.id });
    }
    jobId = await enqueuePoll(tx, intent);
  });
  return { jobId };
}

// ================= confirmations & custody transfer =================

async function transferCtx(tx: Tx, order: Order) {
  const t = await paidTotals(tx, order);
  return {
    totals: t,
    custody: {
      orderFullyPaid: t.fullyPaid,
      orderHasConfirmedPayment: t.hasConfirmed,
      senderConfirmed: order.senderConfirmedAt !== null,
      receiverConfirmed: order.receiverConfirmedAt !== null,
      inspectionPassed: order.inspectionPassedAt !== null,
    },
    order: {
      fullyPaid: t.fullyPaid,
      hasConfirmedPayment: t.hasConfirmed,
      senderConfirmed: order.senderConfirmedAt !== null,
      receiverConfirmed: order.receiverConfirmedAt !== null,
    } satisfies OrderCtx,
  };
}

/**
 * Complete a B2B transfer once — and only once — the order is fully paid
 * AND both sides confirmed. Called after every confirmation and payment.
 */
export async function tryCompleteTransfer(tx: Tx, orderIn: Order, actor: ServiceActor): Promise<boolean> {
  const order = await lockOrder(tx, orderIn.id);
  if (order.state !== "PAID" || order.kind === "CHAMPION_TO_CUSTOMER") return false;
  const c = await transferCtx(tx, order);
  if (!c.custody.orderFullyPaid || !c.custody.senderConfirmed || !c.custody.receiverConfirmed) return false;
  const batch = await lockBatch(tx, order.batchId!);
  if (isLocked(batch.custodyState)) return false; // locked batches stay put (§3.4)
  const product = await tx.query.products.findFirst({ where: eq(s.products.id, order.productId) });

  if (order.kind === "SUPPLIER_TO_RIDER") {
    const picked = await applyCustody(tx, batch, "PICKUP", actor, c.custody, { orderId: order.id, custodianUserId: order.buyerUserId, role: "BOSS_RIDER" });
    await applyCustody(tx, picked, "START_TRANSIT", { kind: "SYSTEM", userId: null }, {}, { orderId: order.id });
    await applyOrder(tx, order, "COMPLETE", actor, c.order);
    await createDeliveryOrder(tx, order, picked.id);
  } else if (order.kind === "RIDER_TO_HUB") {
    const accepted = await applyCustody(tx, batch, "HUB_ACCEPT", actor, c.custody, {
      orderId: order.id,
      custodianUserId: order.buyerUserId,
      hubId: order.hubId,
      role: "HUB_MANAGER",
    });
    await applyCustody(tx, accepted, "MAKE_AVAILABLE", actor, {}, { orderId: order.id });
    await applyOrder(tx, order, "COMPLETE", actor, c.order);
    await notifyMargin(tx, order, product?.name ?? "");
  } else if (order.kind === "HUB_TO_CHAMPION") {
    await applyCustody(tx, batch, "CHAMPION_HANDOVER", actor, c.custody, { orderId: order.id, custodianUserId: order.buyerUserId, hubId: null, role: "FIELD_CHAMPION" });
    await applyOrder(tx, order, "COMPLETE", actor, c.order);
    await notifyMargin(tx, order, product?.name ?? "");
  }
  return true;
}

/** Margin = sale price − purchase price. Displayed, never disbursed (§4.2). */
async function notifyMargin(tx: Tx, order: Order, _product: string): Promise<void> {
  const seller = await userLocale(tx, order.sellerUserId);
  const margin = (order.unitPriceTzs - order.unitCostTzs) * order.quantity;
  await getSmsProvider().send(
    seller.phone,
    tr(seller.locale, "sms.margin", { name: seller.name, amount: formatTzs(margin, seller.locale), ref: order.ref }),
    "MARGIN",
    tx,
  );
}

async function createDeliveryOrder(tx: Tx, pickup: Order, batchId: string): Promise<void> {
  const hubManager = await firstActiveUser(tx, and(eq(s.users.role, "HUB_MANAGER"), eq(s.users.hubId, pickup.hubId!)));
  const hub = await tx.query.hubs.findFirst({ where: eq(s.hubs.id, pickup.hubId!) });
  const item = await activePriceItem(tx, { serviceAreaId: hub!.serviceAreaId, productId: pickup.productId, supplierId: pickup.supplierId! });
  const code = numericCode(6);
  await tx.insert(s.orders).values({
    ref: await uniqueRef(tx, "OR-", 6, "ref"),
    verifyRef: randomRef128(),
    paymentRef: await uniqueRef(tx, "", 8, "paymentRef"),
    kind: "RIDER_TO_HUB",
    state: INITIAL_ORDER_STATE.RIDER_TO_HUB,
    batchId,
    parentOrderId: pickup.id,
    sellerUserId: pickup.buyerUserId!,
    buyerUserId: hubManager.id,
    supplierId: pickup.supplierId,
    hubId: pickup.hubId,
    productId: pickup.productId,
    priceListItemId: item.id,
    quantity: pickup.quantity,
    unitPriceTzs: item.hubPriceTzs,
    totalTzs: item.hubPriceTzs * pickup.quantity,
    unitCostTzs: pickup.unitPriceTzs,
    deliveryCodeHash: hashCode("delivery", code),
    deliveryCodeEnc: await encryptString(code),
    createdBy: pickup.buyerUserId!,
  });
}

export async function confirmRelease(actor: Actor, orderId: string): Promise<void> {
  await actOn(actor, orderId, "order.confirm_release", async (tx, order) => {
    const allowed = order.kind === "RIDER_TO_HUB" ? ["AWAITING_PAYMENT", "PAID"] : ["PAID"];
    if (!allowed.includes(order.state)) throw new DomainError("payment_not_confirmed");
    if (!order.senderConfirmedAt) {
      await tx.update(s.orders).set({ senderConfirmedAt: now(), updatedAt: now() }).where(eq(s.orders.id, order.id));
    }
    await tryCompleteTransfer(tx, order, asService(actor));
  });
}

export async function confirmReceipt(actor: Actor, orderId: string, checks: { quantityOk: boolean; sealOk: boolean }): Promise<void> {
  if (!checks.quantityOk || !checks.sealOk) throw new DomainError("checks_required");
  await actOn(actor, orderId, "order.confirm_receipt", async (tx, order) => {
    if (order.state !== "PAID") throw new DomainError("payment_not_confirmed");
    if (!order.receiverConfirmedAt) {
      await tx.update(s.orders).set({ receiverConfirmedAt: now(), updatedAt: now() }).where(eq(s.orders.id, order.id));
    }
    await tryCompleteTransfer(tx, order, asService(actor));
  });
}

export async function revealDeliveryCode(actor: Actor, orderId: string): Promise<string> {
  const db = getDb();
  const order = await db.query.orders.findFirst({ where: eq(s.orders.id, orderId) });
  if (!order) throw new DomainError("not_found");
  authorize(actor, "order.view_delivery_code", { type: "order", order: await orderResource(db, order) });
  if (!order.deliveryCodeEnc || order.state !== "EN_ROUTE") throw new DomainError("no_delivery_code");
  return decryptString(order.deliveryCodeEnc);
}

// ================= C. Hub inspection =================

export async function startInspection(actor: Actor, orderId: string, code: string): Promise<void> {
  await actOn(actor, orderId, "order.start_inspection", async (tx, order) => {
    const valid = !!order.deliveryCodeHash && /^\d{6}$/.test(code) && codeMatches("delivery", code, order.deliveryCodeHash);
    if (!valid) throw new DomainError("delivery_code_invalid");
    const batch = await lockBatch(tx, order.batchId!);
    await applyCustody(tx, batch, "START_INSPECTION", asService(actor), { deliveryCodeValid: true }, { orderId: order.id });
    await applyOrder(tx, order, "START_INSPECTION", asService(actor), { deliveryCodeValid: true });
  });
}

export const InspectionSchema = z
  .object({
    correctRider: z.literal(true),
    correctProduct: z.literal(true),
    correctCount: z.literal(true),
    correctBatch: z.literal(true),
    sealIntact: z.literal(true),
    goodCondition: z.literal(true),
    noWaterDamage: z.literal(true),
  })
  .strict();

/** Hub accepts after the full handbook §8C checklist. This is the receiver's confirmation. */
export async function passInspection(actor: Actor, orderId: string, checklist: Record<string, boolean>): Promise<void> {
  const parsed = InspectionSchema.safeParse(checklist);
  if (!parsed.success) throw new DomainError("inspection_checklist_incomplete");
  await actOn(actor, orderId, "order.inspect", async (tx, order) => {
    const updated = await applyOrder(tx, order, "INSPECTION_PASSED", asService(actor), {}, {
      inspectionPassedAt: now(),
      receiverConfirmedAt: now(),
    });
    await ensureOpenIntent(tx, updated);
  });
}

// ================= D. Champion stock =================

export async function requestStock(actor: Actor, raw: { productId: string; quantity: number }): Promise<{ orderId: string }> {
  authorize(actor, "order.request_stock");
  const input = z.object({ productId: z.string().uuid(), quantity: z.coerce.number().int().min(1).max(500) }).strict().parse(raw);
  return withTx(async (tx) => {
    const champion = await tx.query.users.findFirst({ where: eq(s.users.id, actor.userId) });
    if (!champion?.hubId) throw new DomainError("champion_has_no_hub");
    const hub = await tx.query.hubs.findFirst({ where: eq(s.hubs.id, champion.hubId) });
    if (!hub?.active) throw new DomainError("hub_not_active");
    const hubManager = await firstActiveUser(tx, and(eq(s.users.role, "HUB_MANAGER"), eq(s.users.hubId, hub.id)));
    const item = await activePriceItem(tx, { serviceAreaId: hub.serviceAreaId, productId: input.productId });
    const [order] = await tx
      .insert(s.orders)
      .values({
        ref: await uniqueRef(tx, "OR-", 6, "ref"),
        verifyRef: randomRef128(),
        paymentRef: await uniqueRef(tx, "", 8, "paymentRef"),
        kind: "HUB_TO_CHAMPION",
        state: INITIAL_ORDER_STATE.HUB_TO_CHAMPION,
        sellerUserId: hubManager.id,
        buyerUserId: champion.id,
        supplierId: item.supplierId,
        hubId: hub.id,
        productId: input.productId,
        priceListItemId: item.id,
        quantity: input.quantity,
        unitPriceTzs: item.championPriceTzs,
        totalTzs: item.championPriceTzs * input.quantity,
        unitCostTzs: item.hubPriceTzs,
        createdBy: champion.id,
      })
      .returning();
    return { orderId: order!.id };
  });
}

export async function prepareTransfer(actor: Actor, orderId: string): Promise<void> {
  await actOn(actor, orderId, "order.prepare_transfer", async (tx, order) => {
    const lots = await tx
      .select()
      .from(s.batches)
      .where(and(eq(s.batches.hubId, order.hubId!), eq(s.batches.productId, order.productId), eq(s.batches.custodyState, "AVAILABLE_AT_HUB"), gte(s.batches.quantity, order.quantity)))
      .orderBy(s.batches.createdAt)
      .limit(1)
      .for("update");
    const parent = lots[0];
    if (!parent) {
      await applyOrder(tx, order, "PREPARE_TRANSFER", asService(actor), { stockAvailable: false });
      return;
    }
    const child = await splitBatch(tx, asService(actor), parent, "SPLIT_FOR_CHAMPION", order.quantity, order.id);
    const updated = await applyOrder(tx, order, "PREPARE_TRANSFER", asService(actor), { stockAvailable: true }, { batchId: child.id });
    await ensureOpenIntent(tx, updated);
  });
}

export async function declineStockRequest(actor: Actor, orderId: string): Promise<void> {
  await actOn(actor, orderId, "order.decline_request", async (tx, order) => {
    if (order.state === "REQUESTED") {
      await applyOrder(tx, order, "DECLINE", asService(actor), {});
      return;
    }
    const t = await paidTotals(tx, order);
    if (order.batchId) {
      const child = await lockBatch(tx, order.batchId);
      await returnToParent(tx, asService(actor), child, "CANCEL_CHAMPION_RESERVATION", { orderHasConfirmedPayment: t.hasConfirmed }, order.id);
    }
    await applyOrder(tx, order, "CANCEL", asService(actor), { hasConfirmedPayment: t.hasConfirmed });
  });
}

// ================= D/E. Champion → customer =================

export async function startPlan(actor: Actor, customerId: string, productId: string): Promise<{ orderId: string }> {
  return withTx(async (tx) => {
    const customer = await tx.query.customers.findFirst({ where: eq(s.customers.id, customerId) });
    if (!customer || customer.status !== "ACTIVE") throw new DomainError("not_found");
    authorize(actor, "order.start_plan", { type: "customer", customer: { championId: customer.championId } });
    if (!customer.phoneVerifiedAt) throw new DomainError("customer_phone_not_verified");
    const open = await tx.query.orders.findFirst({
      where: and(eq(s.orders.customerId, customer.id), inArray(s.orders.state, ["PLAN_ACTIVE", "FULLY_PAID", "HANDOVER_PENDING"])),
    });
    if (open) throw new DomainError("plan_already_active");
    const champion = await tx.query.users.findFirst({ where: eq(s.users.id, actor.userId) });
    const hub = champion?.hubId ? await tx.query.hubs.findFirst({ where: eq(s.hubs.id, champion.hubId) }) : undefined;
    if (!hub) throw new DomainError("champion_has_no_hub");
    await assertProductAvailable(tx, productId, hub.serviceAreaId);
    const item = await activePriceItem(tx, { serviceAreaId: hub.serviceAreaId, productId });
    const [order] = await tx
      .insert(s.orders)
      .values({
        ref: await uniqueRef(tx, "OR-", 6, "ref"),
        verifyRef: randomRef128(),
        paymentRef: await uniqueRef(tx, "", 8, "paymentRef"),
        kind: "CHAMPION_TO_CUSTOMER",
        state: INITIAL_ORDER_STATE.CHAMPION_TO_CUSTOMER,
        sellerUserId: actor.userId,
        customerId: customer.id,
        supplierId: item.supplierId,
        hubId: hub.id,
        productId,
        priceListItemId: item.id,
        quantity: 1,
        unitPriceTzs: item.customerPriceTzs,
        totalTzs: item.customerPriceTzs,
        unitCostTzs: item.championPriceTzs,
        createdBy: actor.userId,
      })
      .returning();
    const intent = await ensureOpenIntent(tx, order!);
    const c = await customerContact(tx, customer.id);
    await getSmsProvider().send(
      c.phone,
      tr(c.locale, "sms.customerPlan", {
        name: c.name,
        price: formatTzs(order!.totalTzs, c.locale),
        paid: formatTzs(0, c.locale),
        remaining: formatTzs(order!.totalTzs, c.locale),
        payee: intent.payeeAccount,
        reference: order!.paymentRef,
      }),
      "CUSTOMER_PLAN",
      tx,
    );
    return { orderId: order!.id };
  });
}

export async function assertProductAvailable(tx: Tx, productId: string, serviceAreaId: string): Promise<void> {
  const p = await tx.query.products.findFirst({ where: eq(s.products.id, productId) });
  if (!p?.active) throw new DomainError("product_unavailable");
  const avail = await tx.query.productAreaAvailability.findFirst({
    where: and(eq(s.productAreaAvailability.productId, productId), eq(s.productAreaAvailability.serviceAreaId, serviceAreaId)),
  });
  // WASH rule (§11): reusables only where safe washing/drying conditions are confirmed.
  if (!avail?.available) throw new DomainError("product_unavailable");
  if (p.category === "REUSABLE" && !avail.washConditionsConfirmed) throw new DomainError("product_unavailable_wash");
}

/** Customer says they are paying / have paid: record the claim and poll the provider. */
export async function expectCustomerPayment(actor: Actor, orderId: string): Promise<{ jobId: string }> {
  let jobId = "";
  await actOn(actor, orderId, "order.expect_payment", async (tx, order) => {
    if (order.state !== "PLAN_ACTIVE") throw new DomainError("not_awaiting_payment");
    const intent = await ensureOpenIntent(tx, order);
    if (!intent.payerClaimedAt) {
      await tx.update(s.paymentIntents).set({ payerClaimedAt: now(), updatedAt: now() }).where(eq(s.paymentIntents.id, intent.id));
    }
    jobId = await enqueuePoll(tx, intent);
  });
  return { jobId };
}

export const HANDOVER_CODE_TTL_MS = 30 * 60_000;

export async function startHandover(actor: Actor, orderId: string): Promise<void> {
  await actOn(actor, orderId, "order.start_handover", async (tx, order) => {
    const t = await paidTotals(tx, order);
    // Refuse early (and without side effects) unless fully paid.
    if (!t.fullyPaid) throw new DomainError("full_payment_not_confirmed");
    const lots = await tx
      .select()
      .from(s.batches)
      .where(and(eq(s.batches.custodianUserId, actor.userId), eq(s.batches.productId, order.productId), eq(s.batches.custodyState, "WITH_CHAMPION"), gte(s.batches.quantity, 1)))
      .orderBy(s.batches.createdAt)
      .limit(1)
      .for("update");
    if (!lots[0]) throw new DomainError("no_stock_for_handover");
    const child = await splitBatch(tx, asService(actor), lots[0], "SPLIT_FOR_CUSTOMER", 1, order.id);
    const code = numericCode(6);
    await applyOrder(tx, order, "START_HANDOVER", asService(actor), { fullyPaid: t.fullyPaid, stockReserved: true }, {
      batchId: child.id,
      handoverCodeHash: hashCode(`handover:${order.id}`, code),
      handoverCodeExpiresAt: new Date(nowMs() + HANDOVER_CODE_TTL_MS),
    });
    const c = await customerContact(tx, order.customerId!);
    await getSmsProvider().send(c.phone, tr(c.locale, "sms.handoverCode", { name: c.name, code }), "HANDOVER_CODE", tx);
  });
}

export async function resendHandoverCode(actor: Actor, orderId: string): Promise<void> {
  await actOn(actor, orderId, "order.start_handover", async (tx, order) => {
    if (order.state !== "HANDOVER_PENDING") throw new DomainError("transition_refused");
    const code = numericCode(6);
    await tx
      .update(s.orders)
      .set({ handoverCodeHash: hashCode(`handover:${order.id}`, code), handoverCodeExpiresAt: new Date(nowMs() + HANDOVER_CODE_TTL_MS), updatedAt: now() })
      .where(eq(s.orders.id, order.id));
    const c = await customerContact(tx, order.customerId!);
    await getSmsProvider().send(c.phone, tr(c.locale, "sms.handoverCode", { name: c.name, code }), "HANDOVER_CODE", tx);
  });
}

export const EducationSchema = {
  REUSABLE: z.object({ wash: z.literal(true), dry: z.literal(true), store: z.literal(true), whenNotToUse: z.literal(true), whenToSeekCare: z.literal(true) }).strict(),
  DISPOSABLE: z.object({ safeUse: z.literal(true), disposal: z.literal(true) }).strict(),
};

/** Customer handover (§8E). Returns the receipt token (sent to the customer by SMS). */
export async function completeHandover(actor: Actor, orderId: string, code: string, education: Record<string, boolean>): Promise<{ receiptNo: string }> {
  let receiptNo = "";
  await actOn(actor, orderId, "order.complete_handover", async (tx, order) => {
    const product = await tx.query.products.findFirst({ where: eq(s.products.id, order.productId) });
    const educationOk = EducationSchema[product!.category].safeParse(education).success;
    const codeOk =
      !!order.handoverCodeHash &&
      !!order.handoverCodeExpiresAt &&
      order.handoverCodeExpiresAt > now() &&
      /^\d{6}$/.test(code) &&
      codeMatches(`handover:${order.id}`, code, order.handoverCodeHash);
    if (!codeOk) throw new DomainError("customer_code_invalid");
    if (!educationOk) throw new DomainError("education_not_confirmed");
    const t = await paidTotals(tx, order);
    const batch = await lockBatch(tx, order.batchId!);
    await applyCustody(
      tx,
      batch,
      "CUSTOMER_HANDOVER",
      asService(actor),
      { orderFullyPaid: t.fullyPaid, senderConfirmed: true, customerCodeValid: true, educationConfirmed: true },
      { orderId: order.id, custodianUserId: null },
    );
    const receiptToken = randomToken();
    await applyOrder(tx, order, "COMPLETE", asService(actor), { fullyPaid: t.fullyPaid, customerCodeValid: true, educationConfirmed: true }, {
      educationConfirmedAt: now(),
      senderConfirmedAt: now(),
      receiverConfirmedAt: now(),
      receiptTokenHash: sha256Hex(receiptToken),
      handoverCodeHash: null,
    });
    const receipt = await createReceipt(tx, order, product!.name, t);
    receiptNo = receipt.receiptNo;
    const c = await customerContact(tx, order.customerId!);
    const link = `${appOrigin()}/verify/${order.verifyRef}?t=${receiptToken}`;
    await getSmsProvider().send(c.phone, tr(c.locale, "sms.receipt", { name: c.name, product: product!.name, receiptNo, link }), "RECEIPT", tx);
    await notifyMargin(tx, order, product!.name);
  });
  return { receiptNo };
}

export async function closePlan(actor: Actor, orderId: string): Promise<void> {
  await actOn(actor, orderId, "order.close_plan", async (tx, order) => {
    const t = await paidTotals(tx, order);
    await applyOrder(tx, order, "CLOSE_PLAN", asService(actor), { hasConfirmedPayment: t.hasConfirmed, hasDonorFunding: t.donorTzs > 0 });
  });
}

/** "Request refund review" opens a case. It moves no money (§4.3). */
export async function requestRefundReview(actor: Actor, orderId: string, reason: string): Promise<{ caseRef: string }> {
  const r = z.string().trim().min(3).max(500).safeParse(reason);
  if (!r.success) throw new DomainError("reason_required");
  let caseRef = "";
  await actOn(actor, orderId, "refund.request", async (tx, order) => {
    caseRef = `RF-${humanCode(6)}`;
    await tx.insert(s.refundCases).values({ ref: caseRef, orderId: order.id, openedBy: actor.userId, reason: r.data });
    await tx.insert(s.exceptions).values({ ref: `EX-${humanCode(6)}`, type: "REFUND_REQUEST", orderId: order.id, reportedBy: actor.userId, note: r.data });
    await recordLedgerEvent(tx, { type: "EXCEPTION_RAISED", subjectRef: order.ref, orderId: order.id, role: "FIELD_CHAMPION" });
  });
  return { caseRef };
}

// ================= payment-driven progression (verifier only) =================

/**
 * Called by the verification job inside its transaction after a payment is
 * confirmed. Moves the order (and batch) forward; never the other way round.
 */
export async function onPaymentConfirmed(tx: Tx, orderIn: Order, amountTzs: number): Promise<void> {
  const verifier: ServiceActor = { kind: "SYSTEM_VERIFIER", userId: null };
  const order = await lockOrder(tx, orderIn.id);
  const t = await paidTotals(tx, order);
  if (order.kind === "CHAMPION_TO_CUSTOMER") {
    const c = await customerContact(tx, order.customerId!);
    if (t.fullyPaid) {
      await applyOrder(tx, order, "PAYMENT_CONFIRMED", verifier, { fullyPaid: true });
      await getSmsProvider().send(c.phone, tr(c.locale, "sms.customerPaid", { name: c.name }), "CUSTOMER_PAID", tx);
    } else {
      await applyOrder(tx, order, "INSTALLMENT_CONFIRMED", verifier, { fullyPaid: false });
      const intent = await ensureOpenIntent(tx, { ...order });
      await getSmsProvider().send(
        c.phone,
        tr(c.locale, "sms.customerPlan", {
          name: c.name,
          price: formatTzs(t.totalTzs, c.locale),
          paid: formatTzs(t.confirmedTzs + t.donorTzs, c.locale),
          remaining: formatTzs(t.remainingTzs, c.locale),
          payee: intent.payeeAccount,
          reference: order.paymentRef,
        }),
        "CUSTOMER_PLAN",
        tx,
      );
    }
    void amountTzs;
    return;
  }
  if (!t.fullyPaid) return; // B2B is exact; partial cannot happen, but never advance on partial.
  const paid = await applyOrder(tx, order, "PAYMENT_CONFIRMED", verifier, { fullyPaid: true });
  if (order.kind === "SUPPLIER_TO_RIDER" && order.batchId) {
    const batch = await lockBatch(tx, order.batchId);
    if (batch.custodyState === "RESERVED_FOR_RIDER" || batch.custodyState === "PAYMENT_PENDING") {
      await applyCustody(tx, batch, "PAYMENT_CONFIRMED", verifier, { orderFullyPaid: true }, { orderId: order.id });
    }
  }
  await tryCompleteTransfer(tx, paid, verifier);
}

/** Verifier: a B2B payment went to review; free the pickup reservation for a retry. */
export async function onPaymentReview(tx: Tx, order: Order): Promise<void> {
  if (order.kind === "SUPPLIER_TO_RIDER" && order.batchId) {
    const batch = await lockBatch(tx, order.batchId);
    if (batch.custodyState === "PAYMENT_PENDING") {
      await applyCustody(tx, batch, "PAYMENT_FAILED", { kind: "SYSTEM_VERIFIER", userId: null }, {}, { orderId: order.id });
    }
  }
}

/**
 * Verifier: the provider reversed a payment it had confirmed. Undo only what
 * the money had unlocked — never a custody transfer that already happened:
 * - a customer plan that was FULLY_PAID (or waiting for the handover code)
 *   reopens with the remaining balance and a fresh intent; a reserved unit
 *   goes back to the champion's lot;
 * - a B2B order that was PAID but not yet completed returns to AWAITING_PAYMENT
 *   (and a batch READY_FOR_PICKUP back to RESERVED_FOR_RIDER);
 * - a COMPLETED order stays completed: the exception and the reconciliation
 *   flag it raises are the refund case (§4.3), nothing moves backwards.
 */
export async function onPaymentReversed(tx: Tx, orderIn: Order): Promise<void> {
  const verifier: ServiceActor = { kind: "SYSTEM_VERIFIER", userId: null };
  const order = await lockOrder(tx, orderIn.id);
  const t = await paidTotals(tx, order);
  if (t.fullyPaid) return; // other confirmed payments still cover the order
  if (order.kind === "CHAMPION_TO_CUSTOMER") {
    if (order.state !== "FULLY_PAID" && order.state !== "HANDOVER_PENDING") return;
    if (order.state === "HANDOVER_PENDING" && order.batchId) {
      const child = await lockBatch(tx, order.batchId);
      if (child.custodyState === "RESERVED_FOR_CUSTOMER") {
        await returnToParent(tx, verifier, child, "CANCEL_CUSTOMER_RESERVATION", { orderHasConfirmedPayment: t.hasConfirmed }, order.id);
      }
    }
    const reopened = await applyOrder(tx, order, "PAYMENT_REVERSED", verifier, { fullyPaid: false }, { batchId: null, handoverCodeHash: null, handoverCodeExpiresAt: null });
    const intent = await ensureOpenIntent(tx, reopened);
    const c = await customerContact(tx, order.customerId!);
    await getSmsProvider().send(
      c.phone,
      tr(c.locale, "sms.customerPlan", {
        name: c.name,
        price: formatTzs(t.totalTzs, c.locale),
        paid: formatTzs(t.confirmedTzs + t.donorTzs, c.locale),
        remaining: formatTzs(t.remainingTzs, c.locale),
        payee: intent.payeeAccount,
        reference: order.paymentRef,
      }),
      "CUSTOMER_PLAN",
      tx,
    );
    return;
  }
  if (order.state !== "PAID") return;
  const back = await applyOrder(tx, order, "PAYMENT_REVERSED", verifier, { fullyPaid: false });
  if (order.kind === "SUPPLIER_TO_RIDER" && order.batchId) {
    const batch = await lockBatch(tx, order.batchId);
    if (batch.custodyState === "READY_FOR_PICKUP") await applyCustody(tx, batch, "PAYMENT_REVERSED", verifier, {}, { orderId: order.id });
  }
  await ensureOpenIntent(tx, back);
}

// ================= donor funding (approvals executor only) =================

export async function applyDonorFunding(tx: Tx, orderId: string, proof: DualApprovalProof): Promise<void> {
  const order = await lockOrder(tx, orderId);
  const t = await paidTotals(tx, order);
  await applyOrder(tx, order, "DONOR_FUNDED", { kind: "SYSTEM_APPROVALS", userId: null }, { fullyPaid: t.fullyPaid, approval: proof });
}

// ================= reads =================

export async function recentOrdersFor(userId: string, days = 7) {
  const since = new Date(nowMs() - days * 86_400_000);
  const db = getDb();
  return db.query.orders.findMany({
    where: and(sql`(${s.orders.sellerUserId} = ${userId} or ${s.orders.buyerUserId} = ${userId})`, sql`(${s.orders.completedAt} is null or ${s.orders.completedAt} > ${since})`),
    orderBy: desc(s.orders.updatedAt),
    limit: 200,
  });
}

export function kindLabelKey(kind: OrderKind): string {
  return `orderKinds.${kind}`;
}

export { tzDay, openIntent };
