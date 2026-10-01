/**
 * Prompt L §3 on a real database: anyone joins the shop with a phone and a code by SMS, asks for a pack at a public
 * meeting point, and a delivery partner in that area who holds the product accepts; the sale is then an ordinary plan
 * paid to Dandelion's collection account, handed over with the customer's code, and credited to the delivery partner
 * less the fee. Joining never reveals whether a number already has an account.
 */
import { and, eq, sql } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { getDb } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import { SEED } from "@/scripts/seed";
import { setClock } from "@/lib/clock-override";
import { phoneBlindIndex } from "@/lib/crypto/blind-index";
import { PolicyError } from "@/lib/policy";
import { simulate } from "@/lib/payments/simulator";
import { tzDay } from "@/lib/util/time";
import { loadCustomerSession, revokeCustomerSession } from "@/lib/auth/customer-session";
import { requestAreaSales, addMeetingPoint, setMeetingPointActive } from "@/lib/services/areas";
import { decideApproval } from "@/lib/services/approvals";
import { acceptPickup, adminCreatePickup, completeHandover, confirmBatchReady, confirmReceipt, confirmRelease, startHandover } from "@/lib/services/orders";
import { balanceFor } from "@/lib/services/wallets";
import { acceptCustomerRequest, cancelShopRequest, expireShopRequests, finishShopSignIn, joinShop, openRequestsFor, requestOrder, shopAreas, shopHome, startShopSignIn } from "@/lib/services/shop";
import { actors, ids, lastSms, order, rejectsWithPg, userByPhone } from "./helpers";

const OPTS = { deviceId: null, ip: "127.0.0.1", openDemo: false };
const EDUCATION_DISPOSABLE = { safeUse: true, disposal: true };
const PHONE = "+255700009801";

async function codeFor(phone: string): Promise<string | null> {
  const rows = await getDb().query.smsOutbox.findMany({ where: and(eq(s.smsOutbox.toIndex, phoneBlindIndex(phone)), eq(s.smsOutbox.purpose, "OTP")), orderBy: sql`created_at desc`, limit: 1 });
  return rows[0]?.body.match(/\b(\d{6})\b/)?.[1] ?? null;
}

async function signIn(challengeId: string, phone: string) {
  return finishShopSignIn(challengeId, (await codeFor(phone))!);
}

let placeId: string;
let customerId: string;
let requestId: string;
let orderId: string;

describe("shop: customers join, order to a meeting point, a delivery partner accepts", () => {
  beforeAll(async () => {
    const { area } = await ids();
    const { requestId: approval } = await requestAreaSales(await actors.adminA(), area.id, ["RIDER_TO_CUSTOMER"]);
    await decideApproval(await actors.adminB(), approval, "APPROVE", "Shop pilot in the test area");
    placeId = (await getDb().query.meetingPoints.findFirst({ where: eq(s.meetingPoints.name, "Market gate (TEST)") }))!.id;
  });

  afterEach(() => setClock(null));

  it("is open only where delivery partners may sell to customers, with named places and the area's prices", async () => {
    const [area] = await shopAreas();
    expect(area!.places.map((p) => p.name).sort()).toEqual(["Dispensary gate (TEST)", "Market gate (TEST)"]);
    expect(area!.products.map((p) => p.priceTzs).sort()).toEqual([4500, SEED.prices.customer].sort());
    // Only admins manage places; a place with the same name is refused; a retired place is not offered.
    await expect(addMeetingPoint(await actors.rider(), { serviceAreaId: area!.id, name: "Bus stop" })).rejects.toThrow(PolicyError);
    await expect(addMeetingPoint(await actors.adminA(), { serviceAreaId: area!.id, name: "market GATE (test)" })).rejects.toMatchObject({ code: "meeting_point_exists" });
    const { meetingPointId } = await addMeetingPoint(await actors.adminA(), { serviceAreaId: area!.id, name: "Bus stop (TEST)" });
    await setMeetingPointActive(await actors.adminB(), meetingPointId, false);
    expect((await shopAreas())[0]!.places.map((p) => p.name)).not.toContain("Bus stop (TEST)");
    await expect(joinShop({ displayName: "Neema", phone: "+255700009899", meetingPointId, consentMessages: true, consentReminders: false }, OPTS)).rejects.toMatchObject({ code: "meeting_point_unavailable" });
  });

  it("joins with a name, a phone, a place and consent; the code by SMS signs her in", async () => {
    await expect(joinShop({ displayName: "Neema", phone: PHONE, meetingPointId: placeId, consentMessages: false as true, consentReminders: false }, OPTS)).rejects.toThrow();
    const { challengeId } = await joinShop({ displayName: "Neema Test", phone: PHONE, meetingPointId: placeId, consentMessages: true, consentReminders: true }, OPTS);
    await expect(finishShopSignIn(challengeId, "000000")).rejects.toMatchObject({ code: "otp_invalid" });
    const r = await signIn(challengeId, PHONE);
    customerId = r.customerId;
    const c = (await getDb().query.customers.findFirst({ where: eq(s.customers.id, customerId) }))!;
    expect(c).toMatchObject({ championId: null, selfRegistered: true, displayName: "Neema Test", meetingPointId: placeId });
    expect(c.phoneVerifiedAt).not.toBeNull();
    const consents = await getDb().query.consentRecords.findMany({ where: eq(s.consentRecords.customerId, customerId) });
    expect(consents.map((x) => [x.kind, x.granted, x.recordedBy]).sort()).toEqual([
      ["REMINDERS", true, null],
      ["TRANSACTION_MESSAGES", true, null],
    ]);
    // The session works, and ends when she signs out.
    expect((await loadCustomerSession(r.token))?.id).toBe(customerId);
    await revokeCustomerSession(r.token);
    expect(await loadCustomerSession(r.token)).toBeNull();
    // A code works once.
    await expect(signIn(challengeId, PHONE)).rejects.toMatchObject({ code: "otp_invalid" });
  });

  it("never reveals whether a number has an account; joining again only signs her in", async () => {
    const before = await lastSms("OTP");
    const unknown = await startShopSignIn("+255700009877", OPTS);
    expect(unknown.challengeId).toMatch(/^[0-9a-f-]{36}$/);
    expect((await lastSms("OTP"))?.id).toBe(before?.id); // no SMS to a number without an account
    await expect(finishShopSignIn(unknown.challengeId, "123456")).rejects.toMatchObject({ code: "otp_invalid" });
    // Joining with her number again does not change her name; she is simply signed in.
    const again = await joinShop({ displayName: "Somebody Else", phone: PHONE, meetingPointId: placeId, consentMessages: true, consentReminders: false }, OPTS);
    expect((await signIn(again.challengeId, PHONE)).customerId).toBe(customerId);
    expect((await getDb().query.customers.findFirst({ where: eq(s.customers.id, customerId) }))!.displayName).toBe("Neema Test");
    // A staff member's phone is not a shop account: no code goes to it.
    const staff = await startShopSignIn(SEED.riders[0]!.phone, OPTS);
    await expect(finishShopSignIn(staff.challengeId, "123456")).rejects.toMatchObject({ code: "otp_invalid" });
    // The open demo stores only fictional numbers.
    await expect(startShopSignIn("+255712345678", { ...OPTS, openDemo: true })).rejects.toMatchObject({ code: "open_demo_fake_phone" });
  });

  it("asks for one pack at a time; a delivery partner without the product cannot accept", async () => {
    const { disposable } = await ids();
    ({ requestId } = await requestOrder({ id: customerId }, { productId: disposable.id, meetingPointId: placeId }));
    await expect(requestOrder({ id: customerId }, { productId: disposable.id, meetingPointId: placeId })).rejects.toMatchObject({ code: "shop_order_open" });
    const rider = await actors.rider();
    const waiting = await openRequestsFor(rider);
    expect(waiting).toHaveLength(1);
    expect(waiting[0]).toMatchObject({ customerName: "Neema", placeName: "Market gate (TEST)", inStock: false });
    await expect(acceptCustomerRequest(rider, requestId)).rejects.toMatchObject({ code: "request_no_stock" });
    await expect(openRequestsFor(await actors.champion())).rejects.toThrow(PolicyError);
    await expect(acceptCustomerRequest(await actors.supplier(), requestId)).rejects.toThrow(PolicyError);
  });

  it("the delivery partner who holds it accepts; it becomes his plan and she is told who, where and how to pay", async () => {
    const { supplier, disposable } = await ids();
    const rider = await actors.rider();
    const pickupId = (await adminCreatePickup(await actors.adminA(), { supplierId: supplier.id, productId: disposable.id, buyerUserId: rider.userId, quantity: 5, pickupDate: tzDay() })).orderId;
    await confirmBatchReady(await actors.supplier(), pickupId, "SEAL-SHOP-1");
    await acceptPickup(rider, pickupId);
    await simulate("success", (await order(pickupId)).ref);
    await confirmRelease(await actors.supplier(), pickupId);
    await confirmReceipt(rider, pickupId, { quantityOk: true, sealOk: true });
    expect((await openRequestsFor(rider))[0]!.inStock).toBe(true);

    ({ orderId } = await acceptCustomerRequest(rider, requestId));
    const o = await order(orderId);
    expect(o).toMatchObject({ kind: "RIDER_TO_CUSTOMER", sellerUserId: rider.userId, customerId, totalTzs: 4500, platformFeeTzs: 50, state: "PLAN_ACTIVE" });
    const accepted = (await lastSms("SHOP_REQUEST"))!.body;
    expect(accepted).toContain("Market gate (TEST)");
    expect(accepted).not.toMatch(/\b(pads?|pedi|kit|disposable|reusable)\b/i); // the SMS never names the product
    expect((await lastSms("CUSTOMER_PLAN"))!.body).toContain(o.paymentRef);
    // Taken once only.
    await expect(acceptCustomerRequest(await actors.rider2(), requestId)).rejects.toMatchObject({ code: "request_taken" });
    expect(await openRequestsFor(rider)).toHaveLength(0);
    // Her shop page shows who accepted and how to pay Dandelion's collection account.
    const home = await shopHome({ id: customerId, serviceAreaId: o.hubId ?? (await ids()).area.id, meetingPointId: placeId });
    expect(home.canOrder).toBe(false);
    expect(home.orders[0]).toMatchObject({ state: "ACCEPTED", sellerName: expect.any(String), order: { state: "PLAN_ACTIVE", remainingTzs: 4500, payee: "TILL-DANDELION-001" } });
  });

  it("she pays, he hands over with her code, and his balance is credited less Dandelion's fee", async () => {
    const rider = await actors.rider();
    const before = await balanceFor(getDb(), rider.userId);
    expect((await simulate("success", (await order(orderId)).ref)).outcomes).toContain("CONFIRMED");
    await startHandover(rider, orderId);
    const code = (await lastSms("HANDOVER_CODE"))!.body.match(/\b(\d{6})\b/)![1]!;
    await completeHandover(rider, orderId, code, EDUCATION_DISPOSABLE);
    expect((await order(orderId)).state).toBe("COMPLETED");
    const after = await balanceFor(getDb(), rider.userId);
    expect(after.availableTzs - before.availableTzs).toBe(4500 - 50);
    const home = await shopHome({ id: customerId, serviceAreaId: (await ids()).area.id, meetingPointId: placeId });
    expect(home.canOrder).toBe(true);
    expect(home.orders[0]!.order!.state).toBe("COMPLETED");
  });

  it("she can cancel a request nobody took; nobody else can; unanswered requests lapse after two days", async () => {
    const { disposable } = await ids();
    const first = await requestOrder({ id: customerId }, { productId: disposable.id, meetingPointId: placeId });
    const other = await joinShop({ displayName: "Asha", phone: "+255700009802", meetingPointId: placeId, consentMessages: true, consentReminders: false }, OPTS);
    const asha = (await signIn(other.challengeId, "+255700009802")).customerId;
    await expect(cancelShopRequest({ id: asha }, first.requestId)).rejects.toMatchObject({ code: "request_not_open" });
    await cancelShopRequest({ id: customerId }, first.requestId);
    await expect(cancelShopRequest({ id: customerId }, first.requestId)).rejects.toMatchObject({ code: "request_not_open" });

    const late = await requestOrder({ id: asha }, { productId: disposable.id, meetingPointId: placeId });
    setClock(new Date(Date.now() + 49 * 3_600_000));
    expect(await expireShopRequests()).toBe(1);
    await expect(acceptCustomerRequest(await actors.rider(), late.requestId)).rejects.toMatchObject({ code: "request_not_open" });
    const row = (await getDb().query.customerRequests.findFirst({ where: eq(s.customerRequests.id, late.requestId) }))!;
    expect(row.state).toBe("EXPIRED");
  });

  it("a delivery partner in another area cannot accept", async () => {
    const { disposable } = await ids();
    const r = await requestOrder({ id: customerId }, { productId: disposable.id, meetingPointId: placeId });
    const [elsewhere] = await getDb().insert(s.serviceAreas).values({ code: "TEST-AREA-2", name: "Other Village (TEST)", region: "Test Region" }).returning();
    const rider2 = await userByPhone(SEED.riders[1]!.phone);
    await getDb().update(s.users).set({ serviceAreaId: elsewhere!.id }).where(eq(s.users.id, rider2.id));
    await expect(acceptCustomerRequest(await actors.rider2(), r.requestId)).rejects.toMatchObject({ code: "request_other_area" });
    expect(await openRequestsFor(await actors.rider2())).toHaveLength(0);
    await cancelShopRequest({ id: customerId }, r.requestId);
  });

  it("the database refuses to rewrite or delete a request", async () => {
    const db = getDb();
    const done = (await db.query.customerRequests.findFirst({ where: eq(s.customerRequests.state, "ACCEPTED") }))!;
    await rejectsWithPg(db.execute(sql`update customer_requests set meeting_point_id = meeting_point_id, product_id = ${(await ids()).kit.id} where id = ${done.id}`), /immutable/);
    await rejectsWithPg(db.execute(sql`update customer_requests set state = 'CANCELLED' where id = ${done.id}`), /cannot change/);
    await rejectsWithPg(db.execute(sql`delete from customer_requests where id = ${done.id}`), /cannot be deleted/);
    await rejectsWithPg(db.execute(sql`insert into customer_requests (ref, customer_id, service_area_id, meeting_point_id, product_id, state) values ('RQ-X', ${done.customerId}, ${done.serviceAreaId}, ${done.meetingPointId}, ${done.productId}, 'ACCEPTED')`), /starts open|customer_request_accepted/);
  });
});
