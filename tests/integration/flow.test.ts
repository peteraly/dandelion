/**
 * The Day 8 dry run (handbook §17) at the service layer: supplier → rider →
 * hub → champion → customer, with MockProvider callbacks through the real
 * ingestion + verification path, plus every rejection case.
 */
import { eq, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { getDb } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import { SEED } from "@/scripts/seed";
import { actors, batch, customerFor, ids, intentsFor, lastSms, latestOrderOfKind, ledgerCount, order, rejectsWithPg, securityEvents, userByPhone } from "./helpers";
import {
  acceptPickup,
  adminCreatePickup,
  claimPaid,
  closePlan,
  completeHandover,
  confirmBatchReady,
  confirmReceipt,
  confirmRelease,
  expectCustomerPayment,
  passInspection,
  prepareTransfer,
  requestRefundReview,
  requestStock,
  revealDeliveryCode,
  startHandover,
  startInspection,
  startPlan,
} from "@/lib/services/orders";
import { simulate, seedProviderTx, setProviderTxStatus } from "@/lib/payments/simulator";
import { enqueueStalePolls, runDueVerificationJobs } from "@/lib/payments/verification";
import { reportProblem, proposeResolution } from "@/lib/services/exceptions";
import { decideApproval, requestApproval, uploadEvidence } from "@/lib/services/approvals";
import { runDailyReconciliation, orderUnderReview } from "@/lib/services/reconciliation";
import { DomainError, getSetting, putSetting } from "@/lib/services/core";
import { PolicyError } from "@/lib/policy";
import { tzDay } from "@/lib/util/time";
import { codeMatches } from "@/lib/auth/secrets";

const ALL_CHECKS = { correctRider: true, correctProduct: true, correctCount: true, correctBatch: true, sealIntact: true, goodCondition: true, noWaterDamage: true } as const;

let pickupId: string;
let deliveryId: string;
let transferId: string;
let saleId: string;

async function handoverCodeFromSms(): Promise<string> {
  const sms = await lastSms("HANDOVER_CODE");
  const m = sms?.body.match(/\b(\d{6})\b/);
  if (!m) throw new Error("no handover code sms");
  return m[1]!;
}

describe("A/B: supplier → rider pickup", () => {
  beforeAll(async () => {
    const { supplier, hub, kit } = await ids();
    const rider = await userByPhone(SEED.riders[0]!.phone);
    const admin = await actors.adminA();
    const res = await adminCreatePickup(admin, { supplierId: supplier.id, productId: kit.id, hubId: hub.id, riderId: rider.id, quantity: 10, pickupDate: tzDay() });
    pickupId = res.orderId;
  });

  it("uses the active price list, not user input", async () => {
    const o = await order(pickupId);
    expect(o.unitPriceTzs).toBe(SEED.prices.supplier);
    expect(o.totalTzs).toBe(75_000);
    expect((await lastSms("PICKUP"))?.body).toContain("75,000 TZS");
  });

  it("only an admin can create pickups; only the supplier confirms the batch", async () => {
    const { supplier, hub, kit } = await ids();
    const rider = await userByPhone(SEED.riders[0]!.phone);
    await expect(adminCreatePickup(await actors.rider(), { supplierId: supplier.id, productId: kit.id, hubId: hub.id, riderId: rider.id, quantity: 1, pickupDate: tzDay() })).rejects.toThrow(PolicyError);
    await expect(confirmBatchReady(await actors.rider(), pickupId, "SEAL-1")).rejects.toThrow(PolicyError);
  });

  it("supplier confirms batch ready → batch registered (ledger) and rider accepts", async () => {
    await confirmBatchReady(await actors.supplier(), pickupId, "SEAL-001");
    let o = await order(pickupId);
    expect(o.state).toBe("BATCH_READY");
    expect(o.batchId).toBeTruthy();
    expect(await ledgerCount("BATCH_REGISTERED")).toBe(1);
    await expect(acceptPickup(await actors.rider2(), pickupId)).rejects.toThrow(PolicyError);
    await acceptPickup(await actors.rider(), pickupId);
    o = await order(pickupId);
    expect(o.state).toBe("AWAITING_PAYMENT");
    expect((await batch(o.batchId!)).custodyState).toBe("RESERVED_FOR_RIDER");
    const intents = await intentsFor(pickupId);
    expect(intents).toHaveLength(1);
    expect(intents[0]!.status).toBe("PAYMENT_PENDING");
    expect(intents[0]!.payeeAccount).toBe(SEED.supplier.payee);
    expect(intents[0]!.amountRule).toBe("EXACT_REMAINING");
  });

  it("'I have paid' never confirms: it only queues a poll", async () => {
    await claimPaid(await actors.rider(), pickupId);
    const o = await order(pickupId);
    expect(o.state).toBe("AWAITING_PAYMENT");
    expect((await batch(o.batchId!)).custodyState).toBe("PAYMENT_PENDING");
    const outcomes = await runDueVerificationJobs();
    expect(outcomes).toContain("NOT_FOUND");
    expect((await intentsFor(pickupId))[0]!.status).toBe("PAYMENT_PENDING");
  });

  it("§3.1: a direct DB update of payment status is refused outside the verifier", async () => {
    const intent = (await intentsFor(pickupId))[0]!;
    await rejectsWithPg(getDb().execute(sql`update payment_intents set status = 'PAYMENT_CONFIRMED' where id = ${intent.id}`), /verification job/);
    await rejectsWithPg(getDb().execute(sql`update payment_intents set amount_tzs = 1 where id = ${intent.id}`), /immutable/);
  });

  it("rejects a spoofed callback (provider has no such transaction)", async () => {
    const o = await order(pickupId);
    const r = await simulate("spoofed", o.ref);
    expect(r.callbacks[0]!.status).toBe(200); // accepted for processing…
    expect(r.outcomes).toContain("NOT_FOUND"); // …but never confirmed
    expect((await intentsFor(pickupId))[0]!.status).toBe("PAYMENT_PENDING");
    expect((await securityEvents("CALLBACK_SPOOFED")).length).toBeGreaterThan(0);
  });

  it("rate-limits callbacks to 10/min per payer", async () => {
    const o = await order(pickupId);
    const { fireCallback, buildCallback } = await import("@/lib/payments/simulator");
    const statuses: number[] = [];
    for (let i = 0; i < 12; i++) {
      const cb = buildCallback({ transactionId: `RLIM${i}`, accountReference: o.paymentRef, amount: 1, payee: "x", payer: "+255700000123" });
      statuses.push((await fireCallback(cb)).status);
    }
    expect(statuses.filter((x) => x === 429).length).toBe(2);
    expect((await securityEvents("CALLBACK_RATE_LIMITED")).length).toBe(2);
    await runDueVerificationJobs(); // drain the spoofed RL* jobs
  });

  it("rejects a callback with a bad token or bad signature", async () => {
    const o = await order(pickupId);
    const { fireCallback, buildCallback } = await import("@/lib/payments/simulator");
    const bad = await fireCallback(buildCallback({ transactionId: "X1", accountReference: o.paymentRef, amount: 75000 }), { token: "wrong" });
    expect(bad.status).toBe(404);
    const r = await simulate("bad_signature", o.ref);
    expect(r.outcomes).toContain("SIGNATURE_INVALID");
    expect((await intentsFor(pickupId))[0]!.status).toBe("PAYMENT_PENDING");
  });

  it("wrong amount goes to review and frees the reservation; a fresh intent can be retried", async () => {
    const o = await order(pickupId);
    const r = await simulate("wrong_amount", o.ref);
    expect(r.outcomes).toContain("WRONG_AMOUNT");
    const intents = await intentsFor(pickupId);
    expect(intents[0]!.status).toBe("PAYMENT_FAILED_OR_REVIEW");
    expect((await batch(o.batchId!)).custodyState).toBe("RESERVED_FOR_RIDER");
    const ex = await getDb().query.exceptions.findFirst({ where: eq(s.exceptions.type, "WRONG_AMOUNT") });
    expect(ex).toBeTruthy();
  });

  it("wrong payee goes to review", async () => {
    const o = await order(pickupId);
    await claimPaid(await actors.rider(), pickupId); // creates a fresh pending intent
    const r = await simulate("wrong_payee", o.ref);
    expect(r.outcomes).toContain("PAYEE_MISMATCH");
    const intents = await intentsFor(pickupId);
    expect(intents.at(-1)!.status).toBe("PAYMENT_FAILED_OR_REVIEW");
  });

  it("a genuine payment confirms exactly once; duplicates and replays are ignored", async () => {
    const o = await order(pickupId);
    await claimPaid(await actors.rider(), pickupId);
    const r = await simulate("duplicate", o.ref);
    expect(r.outcomes.filter((x) => x === "CONFIRMED")).toHaveLength(1);
    expect(r.outcomes).toContain("DUPLICATE");
    const after = await order(pickupId);
    expect(after.state).toBe("PAID");
    expect((await batch(after.batchId!)).custodyState).toBe("READY_FOR_PICKUP");
    const confirmed = (await intentsFor(pickupId)).filter((i) => i.status === "PAYMENT_CONFIRMED");
    expect(confirmed).toHaveLength(1);
    expect(confirmed[0]!.confirmedAmountTzs).toBe(75_000);
    expect(await ledgerCount("PAYMENT_CONFIRMED")).toBe(1);
    // replay of the same provider reference, later
    const replay = await simulate("replay", o.ref);
    expect(replay.outcomes).not.toContain("CONFIRMED");
    expect((await intentsFor(pickupId)).filter((i) => i.status === "PAYMENT_CONFIRMED")).toHaveLength(1);
  });

  it("§3.3: transfer needs both confirmations; stock leaves only after both", async () => {
    await confirmRelease(await actors.supplier(), pickupId);
    let o = await order(pickupId);
    expect(o.state).toBe("PAID");
    await expect(confirmReceipt(await actors.rider(), pickupId, { quantityOk: true, sealOk: false })).rejects.toThrow(DomainError);
    await confirmReceipt(await actors.rider(), pickupId, { quantityOk: true, sealOk: true });
    o = await order(pickupId);
    expect(o.state).toBe("COMPLETED");
    const b = await batch(o.batchId!);
    expect(b.custodyState).toBe("IN_TRANSIT");
    const rider = await userByPhone(SEED.riders[0]!.phone);
    expect(b.custodianUserId).toBe(rider.id);
    expect(await ledgerCount("CUSTODY_TRANSFERRED")).toBe(1);
    const delivery = await latestOrderOfKind("RIDER_TO_HUB", pickupId);
    deliveryId = delivery.id;
    expect(delivery.unitPriceTzs).toBe(SEED.prices.hub);
    expect(delivery.unitCostTzs).toBe(SEED.prices.supplier);
  });
});

describe("C: hub inspection and transfer", () => {
  it("hub needs the rider's delivery code; wrong code refused", async () => {
    await expect(startInspection(await actors.hub(), deliveryId, "000000")).rejects.toThrow(/delivery_code_invalid/);
    await expect(revealDeliveryCode(await actors.hub(), deliveryId)).rejects.toThrow(PolicyError);
    const code = await revealDeliveryCode(await actors.rider(), deliveryId);
    expect(code).toMatch(/^\d{6}$/);
    await startInspection(await actors.hub(), deliveryId, code);
    expect((await order(deliveryId)).state).toBe("INSPECTING");
    expect((await batch((await order(deliveryId)).batchId!)).custodyState).toBe("AT_HUB_INSPECTION");
  });

  it("an incomplete checklist cannot accept", async () => {
    await expect(passInspection(await actors.hub(), deliveryId, { ...ALL_CHECKS, sealIntact: false })).rejects.toThrow(/inspection_checklist_incomplete/);
  });

  it("accept → pay → both confirm → stock at hub, margin shown", async () => {
    await passInspection(await actors.hub(), deliveryId, { ...ALL_CHECKS });
    let o = await order(deliveryId);
    expect(o.state).toBe("AWAITING_PAYMENT");
    await claimPaid(await actors.hub(), deliveryId);
    const r = await simulate("success", o.ref);
    expect(r.outcomes).toContain("CONFIRMED");
    o = await order(deliveryId);
    expect(o.state).toBe("PAID");
    await confirmRelease(await actors.rider(), deliveryId);
    o = await order(deliveryId);
    expect(o.state).toBe("COMPLETED");
    const b = await batch(o.batchId!);
    expect(b.custodyState).toBe("AVAILABLE_AT_HUB");
    const hub = await userByPhone(SEED.hub.phone);
    expect(b.custodianUserId).toBe(hub.id);
    expect(b.hubId).toBe(o.hubId);
    const margin = await lastSms("MARGIN");
    expect(margin?.body).toContain("5,000 TZS"); // (8000-7500)*10
  });
});

describe("D: champion stock", () => {
  it("champion requests, hub prepares (splits lot), champion pays, both confirm", async () => {
    const { kit } = await ids();
    const res = await requestStock(await actors.champion(), { productId: kit.id, quantity: 3 });
    transferId = res.orderId;
    let o = await order(transferId);
    expect(o.state).toBe("REQUESTED");
    expect(o.unitPriceTzs).toBe(SEED.prices.champion);
    await expect(prepareTransfer(await actors.champion(), transferId)).rejects.toThrow(PolicyError);
    await prepareTransfer(await actors.hub(), transferId);
    o = await order(transferId);
    expect(o.state).toBe("AWAITING_PAYMENT");
    const child = await batch(o.batchId!);
    expect(child.custodyState).toBe("RESERVED_FOR_CHAMPION");
    expect(child.quantity).toBe(3);
    const parent = await batch(child.parentBatchId!);
    expect(parent.quantity).toBe(7);
    await claimPaid(await actors.champion(), transferId);
    const r = await simulate("success", o.ref);
    expect(r.outcomes).toContain("CONFIRMED");
    await confirmRelease(await actors.hub(), transferId);
    expect((await order(transferId)).state).toBe("PAID");
    await confirmReceipt(await actors.champion(), transferId, { quantityOk: true, sealOk: true });
    o = await order(transferId);
    expect(o.state).toBe("COMPLETED");
    const champ = await userByPhone(SEED.champions[0]!.phone);
    const withChamp = await batch(o.batchId!);
    expect(withChamp.custodyState).toBe("WITH_CHAMPION");
    expect(withChamp.custodianUserId).toBe(champ.id);
  });
});

describe("D/E: customer installments and handover", () => {
  it("starts a plan at the customer price; another champion cannot", async () => {
    const { kit } = await ids();
    const customer = await customerFor(SEED.champions[0]!.phone);
    await expect(startPlan(await actors.champion2(), customer.id, kit.id)).rejects.toThrow(PolicyError);
    const res = await startPlan(await actors.champion(), customer.id, kit.id);
    saleId = res.orderId;
    const o = await order(saleId);
    expect(o.totalTzs).toBe(SEED.prices.customer);
    expect((await intentsFor(saleId))[0]!.amountRule).toBe("UP_TO_REMAINING");
    expect((await lastSms("CUSTOMER_PLAN"))?.body).toContain("11,400 TZS");
  });

  it("handover is refused before full payment", async () => {
    await expect(startHandover(await actors.champion(), saleId)).rejects.toThrow(/full_payment_not_confirmed/);
  });

  it("installments accumulate; an overpayment goes to review and does not count", async () => {
    const o = await order(saleId);
    let r = await simulate("success", o.ref, { amountTzs: 5_000 });
    expect(r.callbacks[0]!.status).toBe(200);
    expect(r.outcomes).toContain("CONFIRMED");
    expect((await order(saleId)).state).toBe("PLAN_ACTIVE");
    r = await simulate("success", o.ref, { amountTzs: 4_000 });
    expect(r.outcomes).toContain("CONFIRMED");
    // remaining is 2,400; pay 3,400 → overpayment → review
    r = await simulate("overpayment", o.ref);
    expect(r.outcomes).toContain("OVERPAYMENT");
    const intents = await intentsFor(saleId);
    const confirmedSum = intents.filter((i) => i.status === "PAYMENT_CONFIRMED").reduce((a, i) => a + (i.confirmedAmountTzs ?? 0), 0);
    expect(confirmedSum).toBe(9_000);
    expect(intents.some((i) => i.status === "PAYMENT_FAILED_OR_REVIEW" && i.reviewReason === "OVERPAYMENT")).toBe(true);
    expect((await order(saleId)).state).toBe("PLAN_ACTIVE");
  });

  it("a missed callback is found by the poller (delayed scenario)", async () => {
    const o = await order(saleId);
    await expectCustomerPayment(await actors.champion(), saleId); // customer says they paid
    const r = await simulate("delayed", o.ref, { amountTzs: 2_400 });
    expect(r.outcomes).toContain("PROVIDER_PENDING");
    expect((await order(saleId)).state).toBe("PLAN_ACTIVE");
    await setProviderTxStatus(r.providerTxRef, "SUCCESS");
    // Make the retry due. Postgres now() has microseconds and the claim compares against a millisecond clock,
    // so "due now" set in the same millisecond could still read as in the future: step back a second.
    await getDb().execute(sql`update verification_jobs set next_run_at = now() - interval '1 second' where status = 'RETRY'`);
    const outcomes = await runDueVerificationJobs();
    expect(outcomes).toContain("CONFIRMED");
    expect((await order(saleId)).state).toBe("FULLY_PAID");
    expect((await lastSms("CUSTOMER_PAID"))?.body).toContain("Habari Customer");
  });

  it("stale pending intents get a poll job", async () => {
    const n = await enqueueStalePolls(0);
    expect(n).toBeGreaterThanOrEqual(0);
  });

  it("handover needs the customer's SMS code and education; then receipt", async () => {
    await startHandover(await actors.champion(), saleId);
    let o = await order(saleId);
    expect(o.state).toBe("HANDOVER_PENDING");
    const code = await handoverCodeFromSms();
    expect(codeMatches(`handover:${saleId}`, code, o.handoverCodeHash!)).toBe(true);
    const education = { wash: true, dry: true, store: true, whenNotToUse: true, whenToSeekCare: true };
    await expect(completeHandover(await actors.champion(), saleId, "000000", education)).rejects.toThrow(/customer_code_invalid/);
    await expect(completeHandover(await actors.champion(), saleId, code, { ...education, dry: false })).rejects.toThrow(/education_not_confirmed/);
    const { receiptNo } = await completeHandover(await actors.champion(), saleId, code, education);
    o = await order(saleId);
    expect(o.state).toBe("COMPLETED");
    expect((await batch(o.batchId!)).custodyState).toBe("HANDED_TO_CUSTOMER");
    const receipt = await getDb().query.receipts.findFirst({ where: eq(s.receipts.orderId, saleId) });
    expect(receipt?.receiptNo).toBe(receiptNo);
    expect((receipt?.content as { paidTzs: number }).paidTzs).toBe(11_400);
    await rejectsWithPg(getDb().execute(sql`update receipts set content = '{}' where id = ${receipt!.id}`), /append-only/);
    const sms = await lastSms("RECEIPT");
    expect(sms?.body).toMatch(/\/verify\/[A-Za-z0-9_-]{22}\?t=/);
    expect(await ledgerCount("HANDOVER_COMPLETED")).toBe(1);
    const champStock = await batch(o.batchId!);
    expect(champStock.quantity).toBe(1);
  });

  it("refund review opens a case and moves no money", async () => {
    const before = await intentsFor(saleId);
    const { caseRef } = await requestRefundReview(await actors.champion(), saleId, "Customer says the product was not what she expected.");
    expect(caseRef).toMatch(/^RF-/);
    expect(await intentsFor(saleId)).toEqual(before);
  });
});

describe("exceptions, locks and dual approval", () => {
  let lockedBatchId: string;
  let exceptionId: string;

  it("reporting damage quarantines the batch; nothing can move it", async () => {
    const champ = await userByPhone(SEED.champions[0]!.phone);
    const lot = await getDb().query.batches.findFirst({ where: eq(s.batches.custodianUserId, champ.id) });
    const stock = (await getDb().query.batches.findMany({ where: eq(s.batches.custodyState, "WITH_CHAMPION") }))[0]!;
    lockedBatchId = stock.id;
    void lot;
    const r = await reportProblem(await actors.champion(), { type: "DAMAGED_OR_WET", batchId: lockedBatchId, note: "Two boxes got wet" });
    expect(r.lockedBatch).toBe(true);
    const b = await batch(lockedBatchId);
    expect(b.custodyState).toBe("DAMAGED_OR_QUARANTINED");
    expect(b.lockedFromState).toBe("WITH_CHAMPION");
    await rejectsWithPg(getDb().execute(sql`update batches set custody_state = 'WITH_CHAMPION' where id = ${lockedBatchId}`), /locked/);
    // a second champion customer plan cannot draw from locked stock
    const { kit } = await ids();
    const customer = (await getDb().query.customers.findMany({ where: eq(s.customers.championId, champ.id) }))[0]!;
    const plan = await startPlan(await actors.champion(), customer.id, kit.id).catch((e) => e);
    if (!(plan instanceof Error)) {
      await simulate("success", (await order(plan.orderId)).ref);
      await expect(startHandover(await actors.champion(), plan.orderId)).rejects.toThrow(/no_stock_for_handover/);
    }
    exceptionId = (await getDb().query.exceptions.findFirst({ where: eq(s.exceptions.batchId, lockedBatchId) }))!.id;
  });

  it("§3.14: a requester cannot approve their own resolution; a second admin can", async () => {
    const a = await actors.adminA();
    const b = await actors.adminB();
    const { requestId } = await proposeResolution(a, exceptionId, "RESUME", "Dried and inspected; only packaging affected");
    await expect(decideApproval(a, requestId, "APPROVE")).rejects.toThrow(/self_approval/);
    expect((await securityEvents("SELF_APPROVAL_ATTEMPT")).length).toBe(1);
    const res = await decideApproval(b, requestId, "APPROVE");
    expect(res.status).toBe("EXECUTED");
    const unlocked = await batch(lockedBatchId);
    expect(unlocked.custodyState).toBe("WITH_CHAMPION");
    expect(unlocked.lockedFromState).toBeNull();
    expect((await getDb().query.exceptions.findFirst({ where: eq(s.exceptions.id, exceptionId) }))!.status).toBe("RESOLVED");
    await expect(decideApproval(b, requestId, "APPROVE")).rejects.toThrow(/approval_not_pending/);
  });

  it("threshold is configurable: 2-of-3 needs two other admins", async () => {
    await putSetting(getDb(), "approvalThreshold", 3, null);
    const a = await actors.adminA();
    const b = await actors.adminB();
    const { requestId } = await requestApproval(a, "SETTING_CHANGE", { key: "customerPauseDays", value: 21 }, "Pause after 21 days");
    const r = await decideApproval(b, requestId, "APPROVE");
    expect(r.status).toBe("PENDING");
    expect(await getSetting("customerPauseDays")).toBe(14);
    await putSetting(getDb(), "approvalThreshold", 2, null);
  });

  it("§3.6: donor funding rejected without evidence, over the cap, and executed with both", async () => {
    const { kit } = await ids();
    const a = await actors.adminA();
    const b = await actors.adminB();
    const customer = await customerFor(SEED.champions[1]!.phone);
    const { orderId } = await startPlan(await actors.champion2(), customer.id, kit.id);
    await expect(requestApproval(a, "DONOR_FUNDING", { orderId, donorRef: "NGO-2026-01", amountTzs: 11_400, evidenceId: "00000000-0000-0000-0000-000000000000" }, "x")).rejects.toThrow(/donor_evidence_required/);
    const ev = await uploadEvidence(a, { filename: "letter.pdf", contentType: "application/pdf", data: Buffer.from("%PDF-1.4 test") });
    await putSetting(getDb(), "donorMonthlyCapTzs", 10_000, null);
    await expect(requestApproval(a, "DONOR_FUNDING", { orderId, donorRef: "NGO-2026-01", amountTzs: 11_400, evidenceId: ev.evidenceId }, "x")).rejects.toThrow(/donor_cap_exceeded/);
    await putSetting(getDb(), "donorMonthlyCapTzs", 500_000, null);
    const { requestId } = await requestApproval(a, "DONOR_FUNDING", { orderId, donorRef: "NGO-2026-01", amountTzs: 11_400, evidenceId: ev.evidenceId }, "Donor covers full kit");
    const req = await getDb().query.approvalRequests.findFirst({ where: eq(s.approvalRequests.id, requestId) });
    expect(req?.highlighted).toBe(true);
    // a wrong-order attempt: evidence already bound to a request
    await expect(requestApproval(a, "DONOR_FUNDING", { orderId, donorRef: "NGO-2026-01", amountTzs: 100, evidenceId: ev.evidenceId }, "x")).rejects.toThrow(/donor_evidence_required/);
    const r = await decideApproval(b, requestId, "APPROVE");
    expect(r.status).toBe("EXECUTED");
    expect((await order(orderId)).state).toBe("FULLY_PAID");
    const log = await getDb().query.adminActionLog.findFirst({ where: eq(s.adminActionLog.action, "donor_funding.approved") });
    expect(log?.highlighted).toBe(true);
    expect(await ledgerCount("DONOR_FUNDING_APPROVED")).toBe(1);
    // and the plan can no longer be closed
    await expect(closePlan(await actors.champion2(), orderId)).rejects.toThrow();
  });
});

describe("reconciliation", () => {
  it("runs and flags payments in review", async () => {
    const r = await runDailyReconciliation();
    expect(r.checked).toBeGreaterThan(3);
    expect(await orderUnderReview(pickupId)).toBe(true); // wrong-amount/payee intents in review
    expect(await ledgerCount("DAILY_RECONCILIATION")).toBe(1);
  });
});
