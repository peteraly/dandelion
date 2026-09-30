/**
 * Supply-chain scenarios (Prompt B §2.3): every step is a real service call by
 * the actor who would perform it in the field, with simulated minutes between
 * steps. Payments go through the mock provider exactly as the UI's simulator
 * does. Nothing here writes a state directly.
 */
import { and, eq } from "drizzle-orm";
import * as s from "@/lib/db/schema";
import { tzDay } from "@/lib/util/time";
import {
  acceptPickup,
  adminCreatePickup,
  claimPaid,
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
import { createCustomer, verifyCustomerPhone } from "@/lib/services/customers";
import { reportProblem } from "@/lib/services/exceptions";
import { latestIntent, enqueuePoll, paidTotals } from "@/lib/services/payments";
import { simulate, seedProviderTx, setProviderTxStatus, type Scenario } from "@/lib/payments/simulator";
import { runDueVerificationJobs } from "@/lib/payments/verification";
import { closePlan, declineStockRequest } from "@/lib/services/orders";
import type { Customer, DeferredPickup, Hub, Person, Product, SupplierOrg, World } from "./world";

const CHECKS = { quantityOk: true, sealOk: true };
const INSPECTION_OK = { correctRider: true, correctProduct: true, correctCount: true, correctBatch: true, sealIntact: true, goodCondition: true, noWaterDamage: true };
const EDUCATION = {
  REUSABLE: { wash: true, dry: true, store: true, whenNotToUse: true, whenToSeekCare: true },
  DISPOSABLE: { safeUse: true, disposal: true },
};

export type PickupOutcome = "complete" | "in_transit" | "awaiting_rider_payment" | "inspection_issue" | "damaged";

/**
 * Supplier → rider → hub. Returns the delivery order id when the chain reached
 * the hub, so callers can continue a chain that was left mid-way.
 */
/**
 * Supplier → rider → hub. Without `org` the supplier is picked and the quality
 * story applies (the occasional supplier's batches carry most inspection
 * issues, and it is sometimes late); with `org` the chain is deliberate — the
 * outcome asked for is the outcome produced.
 */
export async function pickupChain(w: World, hub: Hub, rider: Person, product: Product, quantity: number, outcome: PickupOutcome, day = 0, org?: SupplierOrg): Promise<{ pickupId: string; deliveryId: string | null }> {
  const area = w.areas.find((a) => a.id === hub.areaId)!;
  const story = !org;
  const chosen = org ?? w.pickSupplier(area);
  const supplierUser = w.rng.pick(chosen.users);
  let effective: PickupOutcome = outcome;
  if (story && effective === "complete" && chosen.quality === "poor" && w.rng.chance(0.12)) effective = w.rng.chance(0.5) ? "inspection_issue" : "damaged";
  if (story && (effective === "inspection_issue" || effective === "damaged") && chosen.quality === "good" && w.rng.chance(0.7)) effective = "complete";
  const { orderId: pickupId } = await adminCreatePickup(w.adminA, { supplierId: chosen.id, productId: product.id, hubId: hub.id, riderId: rider.actor.userId, quantity, pickupDate: tzDay() });
  w.manifest.count("orders.SUPPLIER_TO_RIDER");
  w.manifest.count(`suppliers.${chosen.quality}.pickups`);
  if (story && effective !== "awaiting_rider_payment" && w.allowLateBatches && chosen.quality === "poor" && w.rng.chance(0.25)) {
    // Confirmed ready two days late: the chain resumes on that day (resumeLatePickups).
    w.deferred.push({ pickupId, org: chosen, supplierUser, hub, rider, product, outcome: effective, dueDay: day + 2 });
    w.manifest.anomaly("BATCH_READY_LATE", `${chosen.name} confirmed the batch ready two days after the pickup was assigned (lead time ${chosen.leadTimeDays} days)`, { orderRef: await w.orderRef(pickupId) });
    return { pickupId, deliveryId: null };
  }
  w.tick(45, 120);
  return continueChain(w, { pickupId, org: chosen, supplierUser, hub, rider, product, outcome: effective, dueDay: day }, quantity);
}

/** Pickups whose supplier was late: confirm and run the rest of the chain on the due day. */
export async function resumeLatePickups(w: World, day: number): Promise<void> {
  const due = w.deferred.filter((d) => d.dueDay <= day);
  for (const d of due) {
    w.deferred.splice(w.deferred.indexOf(d), 1);
    try {
      const o = await w.order(d.pickupId);
      await continueChain(w, d, o.quantity);
      w.manifest.count("suppliers.late_batches_completed");
    } catch (e) {
      w.manifest.skip("resumeLatePickups", e);
    }
    w.tick(10, 40);
  }
}

async function continueChain(w: World, d: DeferredPickup, quantity: number): Promise<{ pickupId: string; deliveryId: string | null }> {
  const { pickupId, supplierUser, hub, rider, outcome } = d;
  void quantity;
  await confirmBatchReady(supplierUser.actor, pickupId, `SEAL-${w.rng.int(10000, 99999)}`);
  w.tick(20, 60);
  await acceptPickup(rider.actor, pickupId);
  w.tick(5, 30);
  if (outcome === "awaiting_rider_payment") {
    // The rider says "I have paid" but the provider never confirms anything.
    await claimPaid(rider.actor, pickupId);
    w.manifest.anomaly("PAYMENT_PENDING_TOO_LONG", "rider claimed payment but the provider never confirmed it", { orderRef: await w.orderRef(pickupId) });
    return { pickupId, deliveryId: null };
  }
  // In the field the money arrives first (callback → verifier → PAID); the "I have paid" button is for when it does not.
  await pay(w, pickupId, "success");
  w.tick(5, 25);
  await confirmRelease(supplierUser.actor, pickupId);
  w.tick(3, 15);
  await confirmReceipt(rider.actor, pickupId, CHECKS);
  const delivery = await w.deliveryOrderFor(pickupId);
  w.manifest.count("orders.RIDER_TO_HUB");
  if (outcome === "in_transit") return { pickupId, deliveryId: delivery.id };

  w.tick(90, 240);
  const code = await revealDeliveryCode(rider.actor, delivery.id);
  w.tick(5, 15);
  await startInspection(hub.manager.actor, delivery.id, code);
  w.tick(15, 40);
  if (outcome === "inspection_issue" || outcome === "damaged") {
    const type = outcome === "damaged" ? "DAMAGED_OR_WET" : w.rng.pick(["SEAL_BROKEN", "STOCK_SHORT"] as const);
    const note = w.manifest.swahili(type === "DAMAGED_OR_WET" ? "Maboksi mawili yamelowa" : type === "SEAL_BROKEN" ? "Muhuri umevunjika" : "Vipande vinapungua");
    const { exceptionRef } = await reportProblem(hub.manager.actor, { type, orderId: delivery.id, note });
    w.manifest.anomaly(type, `hub reported ${type} at inspection of a batch from ${d.org.name}; batch locked`, { orderRef: delivery.ref, ids: { exceptionRef } });
    w.manifest.count(`exceptions.${type}`);
    w.manifest.count(`suppliers.${d.org.quality}.quality_issues`);
    return { pickupId, deliveryId: delivery.id };
  }
  // The checklist is the hub's receipt confirmation; once paid, the rider's release completes the transfer.
  await passInspection(hub.manager.actor, delivery.id, INSPECTION_OK);
  w.tick(10, 30);
  await pay(w, delivery.id, "success");
  w.tick(5, 20);
  await confirmRelease(rider.actor, delivery.id);
  w.manifest.count("chains.completed");
  return { pickupId, deliveryId: delivery.id };
}

/** Hub → champion. */
export async function restock(w: World, hub: Hub, champion: Person, product: Product, quantity: number, payment: Scenario = "success"): Promise<string | null> {
  const { orderId } = await requestStock(champion.actor, { productId: product.id, quantity });
  w.manifest.count("orders.HUB_TO_CHAMPION");
  w.tick(30, 150);
  await prepareTransfer(hub.manager.actor, orderId);
  const o = await w.order(orderId);
  if (o.state !== "AWAITING_PAYMENT") {
    w.manifest.anomaly("STOCK_SHORT_AT_HUB", "hub could not prepare the transfer (no lot large enough)", { orderRef: o.ref });
    return null;
  }
  w.tick(10, 60);
  await pay(w, orderId, payment);
  if (payment !== "success") return orderId;
  w.tick(5, 30);
  await confirmRelease(hub.manager.actor, orderId);
  w.tick(2, 10);
  await confirmReceipt(champion.actor, orderId, CHECKS);
  return orderId;
}

/** Champion enrols a customer with the real OTP flow. */
export async function enrolCustomer(w: World, champion: Person): Promise<Customer> {
  const name = w.names.person();
  const phone = w.names.customerPhone();
  const device = `demo-device-${champion.actor.userId.slice(0, 8)}`;
  const { customerId, challengeId } = await createCustomer(champion.actor, { displayName: name, phone, consentMessages: true, consentReminders: w.rng.chance(0.8) }, device, "127.0.0.1");
  w.tick(1, 4);
  const code = await w.lastSmsCode(phone, "OTP");
  await verifyCustomerPhone(champion.actor, customerId, challengeId, code);
  const c: Customer = { id: customerId, name, phone, champion };
  w.customers.push(c);
  w.manifest.count("people.CUSTOMER");
  return c;
}

export interface Plan {
  orderId: string;
  ref: string;
  customer: Customer;
  product: Product;
  totalTzs: number;
  paidTzs: number;
  /** Simulated day index on which the next installment is due; null when complete. */
  nextPaymentDay: number | null;
  installments: number[];
  stalled: boolean;
  handedOver: boolean;
}

/** Start a plan and decide its installment schedule up front (paid on later days). */
export async function startCustomerPlan(w: World, c: Customer, product: Product, today: number): Promise<Plan> {
  const { orderId } = await startPlan(c.champion.actor, c.id, product.id);
  const o = await w.order(orderId);
  w.manifest.count(`orders.${o.kind}`);
  const total = o.totalTzs;
  const n = w.rng.weighted([
    [1, 3],
    [2, 3],
    [3, 2],
    [4, 1],
    [5, 1],
  ] as const);
  const installments: number[] = [];
  let left = total;
  for (let i = 0; i < n; i++) {
    if (i === n - 1) installments.push(left);
    else {
      const part = Math.min(left - 500 * (n - 1 - i), w.rng.roundTo(total / n, 500));
      installments.push(part);
      left -= part;
    }
  }
  return { orderId, ref: o.ref, customer: c, product, totalTzs: total, paidTzs: 0, nextPaymentDay: today + (n === 1 ? 0 : w.rng.int(0, 3)), installments, stalled: false, handedOver: false };
}

/** The customer says she is paying now but nothing arrives: the intent stays pending and is flagged after the threshold. */
export async function claimWithoutPaying(w: World, p: Plan): Promise<void> {
  await expectCustomerPayment(p.customer.champion.actor, p.orderId);
  w.manifest.anomaly("PAYMENT_PENDING_TOO_LONG", "customer claimed payment; provider never confirmed", { orderRef: p.ref });
}

/** Pay the next installment; when the plan is fully paid, hand the product over (needs champion stock). */
export async function payInstallment(w: World, p: Plan, today: number, holdHandover = false): Promise<void> {
  const amount = p.installments.shift();
  if (amount === undefined) return;
  await pay(w, p.orderId, "success", amount);
  p.paidTzs += amount;
  w.manifest.count("payments.customer_installments");
  if (p.installments.length === 0) {
    // The database decides whether the plan is paid up: a reversal or a payment left in review can leave more owed than the plan tracked.
    const owed = await resyncPlan(w, p);
    if (owed > 0) {
      p.nextPaymentDay = today + w.rng.int(1, 3);
      return;
    }
    p.nextPaymentDay = null;
    // The seed's last day holds handovers so some plans stay FULLY_PAID (Prompt B §2.3).
    if (!holdHandover) await handover(w, p);
  } else {
    const gap = w.rng.chance(w.params.stallRate) ? w.rng.int(10, 16) : w.rng.int(2, 9);
    if (gap >= 10) p.stalled = true;
    p.nextPaymentDay = today + gap;
  }
}

/** Re-read what the order still owes and rebuild the plan's installments from it. Returns the remaining amount. */
export async function resyncPlan(w: World, p: Plan): Promise<number> {
  const t = await paidTotals(w.db, await w.order(p.orderId));
  p.paidTzs = p.totalTzs - t.remainingTzs;
  p.installments = t.remainingTzs > 0 ? [t.remainingTzs] : [];
  return t.remainingTzs;
}

export async function handover(w: World, p: Plan): Promise<void> {
  const stock = await w.sellerStock(p.customer.champion, p.product.id);
  if (stock < 1) {
    // Realistic: the champion must restock first. Leave the order FULLY_PAID; the orchestrator restocks and retries.
    return;
  }
  w.tick(20, 180);
  await startHandover(p.customer.champion.actor, p.orderId);
  w.tick(2, 25);
  const code = await w.lastSmsCode(p.customer.phone, "HANDOVER_CODE");
  await completeHandover(p.customer.champion.actor, p.orderId, code, EDUCATION[p.product.category]);
  p.handedOver = true;
  w.manifest.count("handovers");
}

// ---------- payments and their deliberate deviations ----------

/** Pay an order through the mock provider with a given scenario; runs the verifier like the callback path would. */
export async function pay(w: World, orderId: string, scenario: Scenario, amountTzs?: number): Promise<string> {
  const ref = await w.orderRef(orderId);
  const r = await simulate(scenario, ref, amountTzs === undefined ? {} : { amountTzs });
  w.manifest.count(`payments.${scenario}`);
  // These scenarios leave an intent in review, which reconciliation flags until an admin resolves it.
  if (scenario === "overpayment" || scenario === "wrong_payee" || scenario === "wrong_amount" || scenario === "failure") {
    w.manifest.anomaly("PAYMENT_IN_REVIEW", `intent left in review by the "${scenario}" scenario`, { orderRef: ref });
  }
  return r.providerTxRef;
}

/** A payment that needs review, recorded in the manifest with the exception the verifier opens. */
export async function reviewPayment(w: World, orderId: string, scenario: "overpayment" | "wrong_payee" | "wrong_amount" | "spoofed" | "bad_signature" | "duplicate" | "replay" | "failure", amountTzs?: number): Promise<void> {
  const ref = await w.orderRef(orderId);
  await pay(w, orderId, scenario, amountTzs);
  const kind = scenario === "overpayment" ? "OVERPAYMENT" : scenario === "wrong_payee" ? "PAYEE_MISMATCH" : scenario === "wrong_amount" ? "WRONG_AMOUNT" : scenario === "spoofed" ? "UNMATCHED_PAYMENT" : scenario.toUpperCase();
  w.manifest.anomaly(kind, `mock provider scenario "${scenario}" against this order`, { orderRef: ref });
}

/** Provider has the money but the callback never comes; only the poller finds it later. */
export async function delayedPayment(w: World, orderId: string): Promise<void> {
  const ref = await w.orderRef(orderId);
  const providerTxRef = await pay(w, orderId, "delayed");
  w.tick(40, 90);
  await setProviderTxStatus(providerTxRef, "SUCCESS");
  // What the poller cron does for this order: enqueue a poll for the still-pending intent and run it.
  const intent = await latestIntent(w.db, orderId);
  if (intent) await enqueuePoll(w.db, intent);
  await runDueVerificationJobs();
  w.manifest.count("payments.confirmed_by_poller");
  w.manifest.anomaly("CALLBACK_LOST", "callback never arrived; the poller confirmed the payment", { orderRef: ref });
}

/** A confirmed payment the provider later reverses. */
export async function reversedPayment(w: World, orderId: string): Promise<void> {
  const ref = await w.orderRef(orderId);
  const providerTxRef = await pay(w, orderId, "success");
  w.tick(120, 600);
  await setProviderTxStatus(providerTxRef, "REVERSED");
  const intent = await latestIntent(w.db, orderId);
  if (intent) {
    await enqueuePoll(w.db, intent);
    await runDueVerificationJobs();
  }
  w.manifest.anomaly("PAYMENT_REVERSED", "provider reversed a confirmed transaction", { orderRef: ref, ids: { providerTxRef } });
  w.manifest.anomaly("PAYMENT_IN_REVIEW", "reversal put the intent in review", { orderRef: ref });
}

/** A spoofed callback whose verification job dies after its retries. */
export async function deadJob(w: World, orderId: string): Promise<void> {
  const ref = await w.orderRef(orderId);
  await pay(w, orderId, "spoofed");
  for (let i = 0; i < 10; i++) {
    w.tick(45, 90);
    await runDueVerificationJobs();
  }
  const dead = await w.db.query.verificationJobs.findFirst({ where: and(eq(s.verificationJobs.status, "DEAD")) });
  w.manifest.anomaly("UNMATCHED_PAYMENT", dead ? "spoofed callback; verification job ended DEAD after retries" : "spoofed callback; job still retrying", { orderRef: ref });
}

/** Customer paid too much: review + refund case opened by the champion. */
export async function overpaymentWithRefund(w: World, p: Plan): Promise<void> {
  await reviewPayment(w, p.orderId, "overpayment", p.totalTzs - p.paidTzs + 1000);
  w.tick(30, 240);
  const { caseRef } = await requestRefundReview(p.customer.champion.actor, p.orderId, w.manifest.swahili("Mteja alilipa zaidi ya bei; anaomba marejesho"));
  w.manifest.anomaly("REFUND_REQUEST", "refund case opened after an overpayment", { orderRef: p.ref, ids: { caseRef } });
  w.manifest.count("exceptions.REFUND_REQUEST");
}

/**
 * The last simulated day leaves one order in every in-flight state, so the
 * ecosystem view has edges to draw and the coverage test can see each state.
 * Each step is independent; a refusal is recorded, never papered over.
 */
export async function leaveInFlight(w: World, plans: Plan[]): Promise<void> {
  const hub = w.hubs[0]!;
  const hub2 = w.hubs[1] ?? hub;
  const area = w.areas.find((a) => a.id === hub.areaId)!;
  const rider = w.riders[0]!;
  const product = w.product("DISPOSABLE");
  const attempt = async (name: string, fn: () => Promise<void>) => {
    try {
      await fn();
      w.manifest.count(`inflight.${name}`);
    } catch (e) {
      w.manifest.skip(`leaveInFlight/${name}`, e);
    }
    w.tick(5, 25);
  };
  const newPickup = async () => (await adminCreatePickup(w.adminA, { supplierId: area.supplierId, productId: product.id, hubId: hub.id, riderId: rider.actor.userId, quantity: w.rng.int(30, 60), pickupDate: tzDay() })).orderId;

  await attempt("PICKUP_ASSIGNED", async () => void (await newPickup()));
  await attempt("BATCH_READY", async () => {
    const id = await newPickup();
    await confirmBatchReady(area.supplier.actor, id, `SEAL-${w.rng.int(10000, 99999)}`);
  });
  await attempt("AWAITING_PAYMENT.rider_accepted", async () => {
    const id = await newPickup();
    await confirmBatchReady(area.supplier.actor, id, `SEAL-${w.rng.int(10000, 99999)}`);
    w.tick(10, 30);
    await acceptPickup(rider.actor, id); // custody RESERVED_FOR_RIDER until the money moves
  });
  await attempt("AWAITING_PAYMENT.rider_claimed", async () => {
    const id = await newPickup();
    await confirmBatchReady(area.supplier.actor, id, `SEAL-${w.rng.int(10000, 99999)}`);
    w.tick(10, 30);
    await acceptPickup(rider.actor, id);
    w.tick(5, 20);
    await claimPaid(rider.actor, id); // custody PAYMENT_PENDING
    w.manifest.anomaly("PAYMENT_PENDING_TOO_LONG", "rider claimed payment on the last day; nothing confirmed yet", { orderRef: await w.orderRef(id) });
  });
  await attempt("PAID.awaiting_confirmations", async () => {
    const id = await newPickup();
    await confirmBatchReady(area.supplier.actor, id, `SEAL-${w.rng.int(10000, 99999)}`);
    w.tick(10, 30);
    await acceptPickup(rider.actor, id);
    await pay(w, id, "success");
  });
  const primary = area.suppliers[0]!;
  await attempt("EN_ROUTE", async () => void (await pickupChain(w, hub2, rider, product, w.rng.int(30, 60), "in_transit", 0, primary)));
  await attempt("INSPECTING", async () => {
    const r = await pickupChain(w, hub, rider, product, w.rng.int(30, 60), "in_transit", 0, primary);
    w.tick(60, 120);
    const code = await revealDeliveryCode(rider.actor, r.deliveryId!);
    await startInspection(hub.manager.actor, r.deliveryId!, code);
  });
  await attempt("ON_HOLD.inspection_issue", async () => void (await pickupChain(w, hub2, rider, product, w.rng.int(30, 60), "inspection_issue", 0, primary)));
  const champion = hub.champions[0]!;
  await attempt("REQUESTED", async () => void (await requestStock(champion.actor, { productId: product.id, quantity: 5 })));
  await attempt("CANCELLED.declined_request", async () => {
    const { orderId } = await requestStock(hub.champions[1]?.actor ?? champion.actor, { productId: product.id, quantity: 400 });
    w.tick(20, 60);
    await declineStockRequest(hub.manager.actor, orderId);
  });
  await attempt("RESERVED_FOR_CHAMPION.awaiting_payment", async () => {
    const { orderId } = await requestStock(champion.actor, { productId: product.id, quantity: 4 });
    w.tick(20, 60);
    await prepareTransfer(hub.manager.actor, orderId);
  });
  await attempt("FULLY_PAID.awaiting_handover", async () => {
    // Paid in full this afternoon; the champion meets her tomorrow — nothing reserved yet.
    const target = plans.find((p) => !p.handedOver && p.installments.length > 0 && p.customer.champion.actor.role === "FIELD_CHAMPION");
    if (!target) throw new Error("no open champion plan");
    target.installments = [];
    await pay(w, target.orderId, "success");
    target.paidTzs = target.totalTzs;
    target.nextPaymentDay = null;
    target.handedOver = true; // frozen for the rest of the run
    w.manifest.anomaly("HANDOVER_PENDING", "fully paid on the last day; handover not started yet", { orderRef: target.ref });
  });
  await attempt("HANDOVER_PENDING", async () => {
    // A customer settles her remaining balance in one go; the champion sends the code but they only meet tomorrow.
    let target: Plan | undefined;
    for (const p of plans) {
      if (p.handedOver || p.installments.length === 0) continue;
      if ((await w.championStock(p.customer.champion, p.product.id)) >= 1) {
        target = p;
        break;
      }
    }
    if (!target) throw new Error("no open plan whose champion holds stock");
    // Pay exactly what the provider-facing balance says is left (the simulator's default), not our bookkeeping.
    target.installments = [];
    await pay(w, target.orderId, "success");
    target.paidTzs = target.totalTzs;
    target.nextPaymentDay = null;
    w.tick(20, 60);
    try {
      await startHandover(target.customer.champion.actor, target.orderId);
    } catch (e) {
      const o = await w.order(target.orderId);
      const intents = await w.db.select({ status: s.paymentIntents.status, amount: s.paymentIntents.amountTzs, confirmed: s.paymentIntents.confirmedAmountTzs, reason: s.paymentIntents.reviewReason }).from(s.paymentIntents).where(eq(s.paymentIntents.orderId, target.orderId));
      throw new Error(`${e instanceof Error ? e.message : e} — ${o.ref} state=${o.state} total=${o.totalTzs} intents=${JSON.stringify(intents)}`);
    }
    target.handedOver = true; // do not touch it again
    w.manifest.anomaly("HANDOVER_PENDING", "handover code sent on the last day; customer not yet met", { orderRef: target.ref });
  });
  await attempt("DAMAGED_OR_QUARANTINED.champion_lot", async () => {
    const lots = await w.db.query.batches.findMany({ where: eq(s.batches.custodyState, "WITH_CHAMPION") });
    const lot = lots.find((b) => w.champions.some((c) => c.actor.userId === b.custodianUserId));
    if (!lot) throw new Error("no champion lot to quarantine");
    const owner = w.champions.find((c) => c.actor.userId === lot.custodianUserId)!;
    const { exceptionRef } = await reportProblem(owner.actor, { type: "DAMAGED_OR_WET", batchId: lot.id, note: w.manifest.swahili("Mfuko umelowa; nasubiri uamuzi") });
    w.manifest.anomaly("DAMAGED_OR_WET", "champion's lot quarantined on the last day; awaiting resolution", { ids: { exceptionRef, batchCode: lot.code } });
  });
  await attempt("CLOSED.plan_without_payment", async () => {
    // A new customer starts a plan and changes her mind the same afternoon; nothing was paid, so the plan is simply closed.
    const c = await enrolCustomer(w, champion);
    w.tick(5, 20);
    const { orderId } = await startPlan(champion.actor, c.id, product.id);
    w.manifest.count("orders.CHAMPION_TO_CUSTOMER");
    w.tick(60, 180);
    await closePlan(champion.actor, orderId);
  });
}

/** Put a real-looking transaction into the provider ledger with no order behind it (statement diff fodder). */
export async function strayProviderTransaction(w: World, payee: string, amountTzs: number): Promise<string> {
  return seedProviderTx({ accountReference: `NOREF${w.rng.int(1000, 9999)}`, payeeAccount: payee, amountTzs, status: "SUCCESS" });
}
