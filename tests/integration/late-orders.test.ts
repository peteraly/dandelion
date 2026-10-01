/**
 * Prompt M §3.1 on a real database (founders, 2026-10-01: "the goal is for the customer to receive the products ASAP"):
 * a shop order paid in full must be handed over within `shopHandoverHours`. Half-way the seller is reminded; at the
 * deadline the order passes by itself to the next seller with stock — never back to the late one — and her payment
 * follows it inside Dandelion's account, recorded once and for ever. Nobody does anything by hand. If no seller can
 * take it, or she cancels, her money goes back (a refund only admins can send).
 */
import { and, eq, sql } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { getDb } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import { setClock } from "@/lib/clock-override";
import { phoneBlindIndex } from "@/lib/crypto/blind-index";
import { simulate } from "@/lib/payments/simulator";
import { tzDay } from "@/lib/util/time";
import { requestAreaSales } from "@/lib/services/areas";
import { decideApproval } from "@/lib/services/approvals";
import { acceptPickup, adminCreatePickup, completeHandover, confirmBatchReady, confirmReceipt, confirmRelease, startHandover } from "@/lib/services/orders";
import { paidTotals } from "@/lib/services/payments";
import { balanceFor } from "@/lib/services/wallets";
import { runDailyReconciliation } from "@/lib/services/reconciliation";
import { acceptCustomerRequest, cancelShopRequest, expireShopRequests, finishShopSignIn, joinShop, openRequestsFor, passOnLateShopOrders, requestOrder, shopHome, shopRequestForOrder } from "@/lib/services/shop";
import type { Actor } from "@/lib/policy";
import { actors, ids, lastSms, order, rejectsWithPg } from "./helpers";

const HOUR = 3_600_000;
const PHONE = "+255700009811";
const EDUCATION = { safeUse: true, disposal: true };
const PRODUCT_WORDS = /\b(pads?|pedi|kit|disposable|reusable)\b/i;

let placeId: string;
let customerId: string;
let areaId: string;

async function stockOf(actor: Actor): Promise<number> {
  const r = await getDb().execute<{ n: string }>(sql`select coalesce(sum(quantity), 0)::text as n from batches where custodian_user_id = ${actor.userId} and custody_state = 'WITH_CHAMPION'`);
  return Number(r.rows[0]!.n);
}

/** A local seller collects her own stock at the factory gate. */
async function stockUp(seller: Actor, seal: string): Promise<void> {
  const { supplier, disposable } = await ids();
  const pickupId = (await adminCreatePickup(await actors.adminA(), { supplierId: supplier.id, productId: disposable.id, buyerUserId: seller.userId, quantity: 4, pickupDate: tzDay() })).orderId;
  await confirmBatchReady(await actors.supplier(), pickupId, seal, { packedWaterproof: true });
  await acceptPickup(seller, pickupId);
  await simulate("success", (await order(pickupId)).ref);
  await confirmRelease(await actors.supplier(), pickupId);
  await confirmReceipt(seller, pickupId, { quantityOk: true, sealOk: true });
}

/** She asks, `seller` accepts, she pays in full: a paid order waiting for its hand-over. */
async function paidOrder(seller: Actor): Promise<{ requestId: string; orderId: string }> {
  const { disposable } = await ids();
  const { requestId } = await requestOrder({ id: customerId }, { productId: disposable.id, meetingPointId: placeId });
  const { orderId } = await acceptCustomerRequest(seller, requestId);
  await simulate("success", (await order(orderId)).ref);
  expect((await order(orderId)).state).toBe("FULLY_PAID");
  return { requestId, orderId };
}

async function reopened(fromOrderId: string) {
  return (await getDb().query.customerRequests.findFirst({ where: eq(s.customerRequests.carriedFromOrderId, fromOrderId) }))!;
}

/** Every SMS to her of one kind (the test moves the clock back and forth, so "latest" is not reliable). */
async function allSmsTo(phone: string, purpose: string): Promise<string[]> {
  const rows = await getDb().query.smsOutbox.findMany({ where: and(eq(s.smsOutbox.toIndex, phoneBlindIndex(phone)), eq(s.smsOutbox.purpose, purpose)) });
  return rows.map((r) => r.body);
}

async function smsTo(phone: string, purpose: string) {
  return getDb().query.smsOutbox.findFirst({ where: and(eq(s.smsOutbox.toIndex, phoneBlindIndex(phone)), eq(s.smsOutbox.purpose, purpose)), orderBy: sql`created_at desc` });
}

describe("a late shop order passes to the next seller, her payment with it", () => {
  beforeAll(async () => {
    const { area } = await ids();
    areaId = area.id;
    const { requestId: approval } = await requestAreaSales(await actors.adminA(), area.id, ["SUPPLIER_TO_CHAMPION"]);
    await decideApproval(await actors.adminB(), approval, "APPROVE", "Local sellers collect at the factory gate");
    placeId = (await getDb().query.meetingPoints.findFirst({ where: eq(s.meetingPoints.name, "Market gate (TEST)") }))!.id;
    await stockUp(await actors.champion(), "SEAL-LATE-1");
    await stockUp(await actors.champion2(), "SEAL-LATE-2");
    const { challengeId } = await joinShop({ displayName: "Rehema Test", phone: PHONE, meetingPointId: placeId, consentMessages: true, consentReminders: false }, { deviceId: null, ip: "127.0.0.1", openDemo: false });
    const sms = (await smsTo(PHONE, "OTP"))!;
    customerId = (await finishShopSignIn(challengeId, sms.body.match(/\b(\d{6})\b/)![1]!)).customerId;
  });

  afterEach(() => setClock(null));

  it("reminds the seller half-way, passes on at the deadline, and the next seller hands over with nothing more to pay", async () => {
    const late = await actors.champion();
    const next = await actors.champion2();
    const lateBefore = await balanceFor(getDb(), late.userId);
    const nextBefore = await balanceFor(getDb(), next.userId);
    const lateStock = await stockOf(late);
    const { orderId: first } = await paidOrder(late);
    const a = await order(first);
    expect(a.fullyPaidAt).not.toBeNull();
    // The seller's order page says by when.
    const due = (await shopRequestForOrder(getDb(), first))!.dueAt!;
    expect(due.getTime()).toBe(a.fullyPaidAt!.getTime() + 24 * HOUR);
    expect(await passOnLateShopOrders()).toEqual({ reminded: 0, passed: 0 });

    // Half-way: one reminder, never two.
    const t0 = a.fullyPaidAt!.getTime();
    setClock(new Date(t0 + 13 * HOUR));
    expect(await passOnLateShopOrders()).toEqual({ reminded: 1, passed: 0 });
    expect((await lastSms("NOTICE"))!.body).toContain(a.ref);
    expect(await passOnLateShopOrders()).toEqual({ reminded: 0, passed: 0 });
    // He sets a pack aside but never comes.
    await startHandover(late, first);
    expect(await stockOf(late)).toBe(lateStock - 1);

    // The deadline: it passes on by itself.
    setClock(new Date(t0 + 25 * HOUR));
    expect((await passOnLateShopOrders()).passed).toBe(1);
    expect((await order(first)).state).toBe("CANCELLED");
    expect(await stockOf(late)).toBe(lateStock); // the pack he set aside is back in his stock
    const r = await reopened(first);
    expect(r).toMatchObject({ state: "OPEN", carriedTzs: a.totalTzs, excludedSellerId: late.userId, customerId });
    // Both are told; neither SMS names the product.
    expect((await lastSms("NOTICE"))!.body).toContain(a.ref);
    const toHer = (await smsTo(PHONE, "SHOP_REQUEST"))!.body;
    expect(toHer).toContain(a.ref);
    expect(toHer).not.toMatch(PRODUCT_WORDS);
    // Recorded once, for anyone to check.
    const ledger = await getDb().query.ledgerEvents.findFirst({ where: and(eq(s.ledgerEvents.type, "ORDER_REASSIGNED"), eq(s.ledgerEvents.orderId, first)) });
    expect(JSON.parse(ledger!.canonical)).toMatchObject({ type: "ORDER_REASSIGNED", ref: a.ref, amountTzs: a.totalTzs });
    // Running again changes nothing.
    expect((await passOnLateShopOrders()).passed).toBe(0);

    // The late seller does not see it and cannot take it back.
    expect((await openRequestsFor(late)).map((x) => x.id)).not.toContain(r.id);
    await expect(acceptCustomerRequest(late, r.id)).rejects.toMatchObject({ code: "request_passed_on" });
    // The next seller sees it already paid, and takes it: the plan is paid in full at once, with nothing to pay.
    expect((await openRequestsFor(next)).find((x) => x.id === r.id)).toMatchObject({ carriedTzs: a.totalTzs, inStock: true });
    const { orderId: second } = await acceptCustomerRequest(next, r.id);
    const b = await order(second);
    expect(b).toMatchObject({ state: "FULLY_PAID", sellerUserId: next.userId });
    expect(await getDb().query.paymentIntents.findFirst({ where: and(eq(s.paymentIntents.orderId, second), eq(s.paymentIntents.status, "PAYMENT_PENDING")) })).toBeUndefined();
    const plan = (await smsTo(PHONE, "CUSTOMER_PLAN"))!.body;
    expect(plan).toContain(r.ref);
    expect(plan).not.toContain("TILL-");
    expect(plan).not.toMatch(PRODUCT_WORDS);
    expect(await paidTotals(getDb(), b)).toMatchObject({ confirmedTzs: b.totalTzs, remainingTzs: 0, fullyPaid: true });
    expect((await paidTotals(getDb(), await order(first))).confirmedTzs).toBe(0);
    const [transfer] = await getDb().select().from(s.orderTransfers).where(eq(s.orderTransfers.toOrderId, second));
    expect(transfer).toMatchObject({ fromOrderId: first, customerId, amountTzs: a.totalTzs });
    // Her clock starts again with the new seller.
    expect((await shopRequestForOrder(getDb(), second))!.dueAt).not.toBeNull();

    await startHandover(next, second);
    await completeHandover(next, second, (await smsTo(PHONE, "HANDOVER_CODE"))!.body.match(/\b(\d{6})\b/)![1]!, EDUCATION);
    expect((await order(second)).state).toBe("COMPLETED");
    // The seller who delivered is credited; the late seller earns nothing from it.
    expect((await balanceFor(getDb(), next.userId)).availableTzs - nextBefore.availableTzs).toBe(b.totalTzs - b.platformFeeTzs);
    expect((await balanceFor(getDb(), late.userId)).availableTzs).toBe(lateBefore.availableTzs);
    expect((await balanceFor(getDb(), late.userId)).onHoldTzs).toBe(lateBefore.onHoldTzs);
    // Nothing for an admin: the night's reconciliation finds nothing wrong with either order.
    await runDailyReconciliation();
    const flags = await getDb().execute<{ n: string }>(sql`select count(*)::text as n from reconciliation_flags where order_id in (${first}, ${second}) and resolved_at is null`);
    expect(flags.rows[0]!.n).toBe("0");
    // Her shop page: the late order says it passed on; the new one is handed over.
    const home = await shopHome({ id: customerId, serviceAreaId: areaId, meetingPointId: placeId });
    expect(home.orders[0]).toMatchObject({ id: r.id, carriedTzs: a.totalTzs, order: { state: "COMPLETED" } });
    expect(home.orders[1]).toMatchObject({ passedOn: true });
    expect(home.canOrder).toBe(true);

    // The record of her payment moving is permanent; what a reopened order carries cannot be changed.
    await rejectsWithPg(getDb().execute(sql`update order_transfers set amount_tzs = 1 where to_order_id = ${second}`), /cannot be changed/);
    await rejectsWithPg(getDb().execute(sql`delete from order_transfers where to_order_id = ${second}`), /cannot be changed/);
    await rejectsWithPg(getDb().execute(sql`update customer_requests set carried_tzs = 0 where id = ${r.id}`), /immutable|cannot change/);
  });

  it("a reopened order nobody takes lapses, and her money goes back by itself — opened for the admins and told to her", async () => {
    const late = await actors.champion2();
    const { orderId } = await paidOrder(late);
    const o = await order(orderId);
    setClock(new Date(o.fullyPaidAt!.getTime() + 25 * HOUR));
    expect((await passOnLateShopOrders()).passed).toBe(1);
    const r = await reopened(orderId);
    expect(r.excludedSellerId).toBe(late.userId);
    // Nobody takes it in two days.
    setClock(new Date(o.fullyPaidAt!.getTime() + (25 + 49) * HOUR));
    expect(await expireShopRequests()).toBeGreaterThanOrEqual(1);
    expect((await getDb().query.customerRequests.findFirst({ where: eq(s.customerRequests.id, r.id) }))!.state).toBe("EXPIRED");
    const refund = (await getDb().query.exceptions.findFirst({ where: and(eq(s.exceptions.orderId, orderId), eq(s.exceptions.type, "REFUND_REQUEST")) }))!;
    expect(refund).toMatchObject({ status: "OPEN", reportedBySystem: true });
    expect(refund.note).toContain(String(o.totalTzs));
    const toHer = (await allSmsTo(PHONE, "SHOP_REQUEST")).find((b) => b.includes(r.ref))!;
    expect(toHer).toContain("yatarudishwa");
    expect(toHer).not.toMatch(PRODUCT_WORDS);
    const home = await shopHome({ id: customerId, serviceAreaId: areaId, meetingPointId: placeId });
    expect(home.orders[0]).toMatchObject({ id: r.id, state: "EXPIRED", carriedTzs: o.totalTzs });
  });

  it("she may cancel a reopened order instead of waiting; her money goes back", async () => {
    const late = await actors.champion();
    const { orderId } = await paidOrder(late);
    const o = await order(orderId);
    setClock(new Date(o.fullyPaidAt!.getTime() + 25 * HOUR));
    expect((await passOnLateShopOrders()).passed).toBe(1);
    const r = await reopened(orderId);
    await cancelShopRequest({ id: customerId }, r.id);
    const refund = (await getDb().query.exceptions.findFirst({ where: and(eq(s.exceptions.orderId, orderId), eq(s.exceptions.type, "REFUND_REQUEST")) }))!;
    expect(refund.note).toContain("she cancelled");
    expect((await allSmsTo(PHONE, "SHOP_REQUEST")).some((b) => b.includes(r.ref) && b.includes("cancelled"))).toBe(false); // sent in Swahili
    expect((await allSmsTo(PHONE, "SHOP_REQUEST")).some((b) => b.includes(r.ref) && b.includes("imeghairiwa"))).toBe(true);
    expect((await openRequestsFor(late)).map((x) => x.id)).not.toContain(r.id);
  });

  it("switched off (0 hours), nothing passes on", async () => {
    const { putSetting } = await import("@/lib/services/core");
    await putSetting(getDb(), "shopHandoverHours", 0, null);
    const { orderId } = await paidOrder(await actors.champion2());
    setClock(new Date((await order(orderId)).fullyPaidAt!.getTime() + 100 * HOUR));
    expect(await passOnLateShopOrders()).toEqual({ reminded: 0, passed: 0 });
    expect((await order(orderId)).state).toBe("FULLY_PAID");
    expect((await shopRequestForOrder(getDb(), orderId))!.dueAt).toBeNull(); // no deadline shown
    await putSetting(getDb(), "shopHandoverHours", 24, null);
  });
});
