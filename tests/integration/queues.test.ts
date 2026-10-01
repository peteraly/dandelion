/**
 * Prompt M §2 on a real database: the admin's to-do list counts each issue once, a problem closed by two admins
 * closes the payment it was about, reconciliation does not flag a payment that is already on the list, a delivery is
 * listed only when it is stuck, and a hub keeper is told when a held delivery can continue.
 */
import { eq, sql } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { getDb } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import { SEED } from "@/scripts/seed";
import { setClock } from "@/lib/clock-override";
import { simulate } from "@/lib/payments/simulator";
import { tzDay } from "@/lib/util/time";
import { priorities } from "@/lib/services/admin";
import { runDailyReconciliation } from "@/lib/services/reconciliation";
import { decideApproval } from "@/lib/services/approvals";
import { proposeResolution, reportProblem } from "@/lib/services/exceptions";
import { acceptPickup, adminCreatePickup, confirmBatchReady, confirmReceipt, confirmRelease, revealDeliveryCode, startInspection } from "@/lib/services/orders";
import { actors, ids, lastSms, latestOrderOfKind, order, rejectsWithPg, userByPhone } from "./helpers";

const CHECKS = { quantityOk: true, sealOk: true };
let pickupId: string;

describe("the to-do list counts each issue once and closes its loops", () => {
  beforeAll(async () => {
    const { supplier, hub, kit } = await ids();
    const rider = await userByPhone(SEED.riders[0]!.phone);
    pickupId = (await adminCreatePickup(await actors.adminA(), { supplierId: supplier.id, productId: kit.id, hubId: hub.id, riderId: rider.id, quantity: 10, pickupDate: tzDay() })).orderId;
    await confirmBatchReady(await actors.supplier(), pickupId, "SEAL-Q-1");
    await acceptPickup(await actors.rider(), pickupId);
  });

  afterEach(() => setClock(null));

  it("a payment to the wrong account is one item, not three; closing the problem closes the payment", async () => {
    const admin = await actors.adminA();
    const before = await priorities(admin);
    await simulate("wrong_payee", (await order(pickupId)).ref);
    const intent = (await getDb().query.paymentIntents.findFirst({ where: eq(s.paymentIntents.orderId, pickupId) }))!;
    expect(intent.status).toBe("PAYMENT_FAILED_OR_REVIEW");
    const ex = (await getDb().query.exceptions.findFirst({ where: eq(s.exceptions.paymentIntentId, intent.id) }))!;
    expect(ex.type).toBe("PAYEE_MISMATCH");

    await runDailyReconciliation();
    const after = await priorities(admin);
    expect(after.paymentsReview).toBe(before.paymentsReview + 1); // payments to check
    expect(after.openExceptions).toBe(before.openExceptions); // not again under problems
    expect(after.reconFlags).toBe(before.reconFlags); // not again under money that does not match

    // Waiting for the second admin: only under approvals.
    const { requestId } = await proposeResolution(admin, ex.id, "CLOSE", "The buyer paid the wrong number; refunded by the provider");
    const waiting = await priorities(admin);
    expect(waiting.paymentsReview).toBe(before.paymentsReview);
    expect(waiting.pendingApprovals).toBe(after.pendingApprovals + 1);

    await decideApproval(await actors.adminB(), requestId, "APPROVE", "Checked with the provider");
    const closed = (await getDb().query.paymentIntents.findFirst({ where: eq(s.paymentIntents.id, intent.id) }))!;
    expect(closed.status).toBe("PAYMENT_FAILED_OR_REVIEW"); // the record is kept
    expect(closed.reviewClosedAt).not.toBeNull(); // but it no longer asks for attention
    expect((await priorities(admin)).paymentsReview).toBe(before.paymentsReview);
    // A closed review cannot be reopened or re-closed by hand.
    await rejectsWithPg(getDb().execute(sql`update payment_intents set review_closed_at = now() where id = ${intent.id}`), /closes once/);
  });

  it("a delivery is listed only when stuck; a hub keeper is texted when a held delivery can continue", async () => {
    const admin = await actors.adminA();
    // The rider pays properly this time, and the stock goes on the road to the hub.
    await simulate("success", (await order(pickupId)).ref);
    await confirmRelease(await actors.supplier(), pickupId);
    await confirmReceipt(await actors.rider(), pickupId, CHECKS);
    const delivery = await latestOrderOfKind("RIDER_TO_HUB", pickupId);
    const base = (await priorities(admin)).deliveriesStuck;
    expect(delivery.state).toBe("EN_ROUTE");
    setClock(new Date(Date.now() + 4 * 86_400_000));
    expect((await priorities(admin)).deliveriesStuck).toBe(base + 1); // four days on the road
    setClock(null);

    await startInspection(await actors.hub(), delivery.id, await revealDeliveryCode(await actors.rider(), delivery.id));
    expect((await priorities(admin)).deliveriesStuck).toBe(base); // just arrived: not stuck
    const { exceptionRef } = await reportProblem(await actors.hub(), { type: "SEAL_BROKEN", orderId: delivery.id, note: "Seal torn on arrival" });
    const ex = (await getDb().query.exceptions.findFirst({ where: eq(s.exceptions.ref, exceptionRef) }))!;
    const { requestId } = await proposeResolution(admin, ex.id, "RESUME", "Count matches the batch; seal torn in the rain");
    await decideApproval(await actors.adminB(), requestId, "APPROVE", "Agreed");
    expect((await order(delivery.id)).state).toBe("INSPECTING");
    const notice = (await lastSms("NOTICE"))!.body;
    expect(notice).toContain(delivery.ref);
    setClock(new Date(Date.now() + 26 * 3_600_000));
    expect((await priorities(admin)).deliveriesStuck).toBe(base + 1); // nobody finished it in a day: now it is listed
  });
});
