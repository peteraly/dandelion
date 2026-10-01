/**
 * Provider reversals against real orders (found by the demo generator): a
 * reversed payment must reopen what it had paid for, and the customer's or
 * rider's next payment must attach normally afterwards.
 */
import { describe, expect, it } from "vitest";
import { getDb } from "@/lib/db/client";
import { acceptPickup, adminCreatePickup, confirmBatchReady, startHandover, startPlan } from "@/lib/services/orders";
import { enqueuePoll, latestIntent } from "@/lib/services/payments";
import { setProviderTxStatus, simulate } from "@/lib/payments/simulator";
import { runDueVerificationJobs } from "@/lib/payments/verification";
import { tzDay } from "@/lib/util/time";
import { SEED } from "@/scripts/seed";
import { actors, batch, customerFor, ids, intentsFor, order, securityEvents, userByPhone } from "./helpers";

async function reverse(orderId: string, providerTxRef: string): Promise<void> {
  await setProviderTxStatus(providerTxRef, "REVERSED");
  const intent = await latestIntent(getDb(), orderId);
  await enqueuePoll(getDb(), intent!);
  const outcomes = await runDueVerificationJobs();
  expect(outcomes).toContain("REVERSED");
}

describe("payment reversals", () => {
  it("a reversed final installment reopens a FULLY_PAID plan; the next payment completes it again", async () => {
    const { kit } = await ids();
    const champion = await actors.champion();
    const customer = await customerFor(SEED.champions[0]!.phone);
    const { orderId } = await startPlan(champion, customer.id, kit.id);
    const o = await order(orderId);
    await simulate("success", o.ref, { amountTzs: 6_400 });
    const last = await simulate("success", o.ref, { amountTzs: 5_000 });
    expect((await order(orderId)).state).toBe("FULLY_PAID");

    await reverse(orderId, last.providerTxRef);
    const reopened = await order(orderId);
    expect(reopened.state).toBe("PLAN_ACTIVE");
    const intents = await intentsFor(orderId);
    expect(intents.some((i) => i.status === "PAYMENT_FAILED_OR_REVIEW" && i.reviewReason === "PAYMENT_REVERSED")).toBe(true);
    expect(intents.some((i) => i.status === "PAYMENT_PENDING")).toBe(true); // a fresh intent for the 5,000 still owed
    expect((await securityEvents("PAYMENT_REVERSED")).length).toBeGreaterThanOrEqual(1);
    await expect(startHandover(champion, orderId)).rejects.toThrow(/full_payment_not_confirmed/);

    const again = await simulate("success", o.ref);
    expect(again.outcomes).toContain("CONFIRMED");
    expect((await order(orderId)).state).toBe("FULLY_PAID");
    const confirmed = (await intentsFor(orderId)).filter((i) => i.status === "PAYMENT_CONFIRMED").reduce((a, i) => a + (i.confirmedAmountTzs ?? 0), 0);
    expect(confirmed).toBe(SEED.prices.customer);
  });

  it("a reversed pickup payment returns the order to awaiting payment and the batch to reserved", async () => {
    const { supplier, hub, disposable } = await ids();
    const rider = await userByPhone(SEED.riders[1]!.phone);
    const { orderId } = await adminCreatePickup(await actors.adminA(), { supplierId: supplier.id, productId: disposable.id, hubId: hub.id, riderId: rider.id, quantity: 20, pickupDate: tzDay() });
    await confirmBatchReady(await actors.supplier(), orderId, "SEAL-REV-1", { packedWaterproof: true });
    await acceptPickup(await actors.rider2(), orderId);
    const o = await order(orderId);
    const paid = await simulate("success", o.ref);
    expect(paid.outcomes).toContain("CONFIRMED");
    expect((await order(orderId)).state).toBe("PAID");
    expect((await batch(o.batchId!)).custodyState).toBe("READY_FOR_PICKUP");

    await reverse(orderId, paid.providerTxRef);
    expect((await order(orderId)).state).toBe("AWAITING_PAYMENT");
    expect((await batch(o.batchId!)).custodyState).toBe("RESERVED_FOR_RIDER");

    const again = await simulate("success", o.ref);
    expect(again.outcomes).toContain("CONFIRMED");
    expect((await order(orderId)).state).toBe("PAID");
    expect((await batch(o.batchId!)).custodyState).toBe("READY_FOR_PICKUP");
  });
});
