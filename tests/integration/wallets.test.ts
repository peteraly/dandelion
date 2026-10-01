/**
 * Prompt L §2 on a real database: buyers pay Dandelion's collection account; each confirmed payment is credited to
 * the seller it was for, on hold until the goods are handed over and available after, minus Dandelion's fee on the
 * fee kinds. Members choose when to withdraw; one admin approves and a different admin sends. The database refuses
 * to rewrite a fee, a collection flag, or a withdrawal's terms.
 */
import { eq, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { getDb } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import { SEED } from "@/scripts/seed";
import { tzDay } from "@/lib/util/time";
import { PolicyError } from "@/lib/policy";
import { simulate } from "@/lib/payments/simulator";
import { acceptPickup, adminCreatePickup, confirmBatchReady, confirmReceipt, confirmRelease, passInspection, revealDeliveryCode, startInspection } from "@/lib/services/orders";
import { approveWithdrawal, balanceFor, moneyOverview, myWallet, payoutsWaiting, rejectWithdrawal, requestWithdrawal, sendWithdrawal } from "@/lib/services/wallets";
import { actors, ids, lastSms, latestOrderOfKind, ledgerCount, order, rejectsWithPg, userByPhone } from "./helpers";

const CHECKS = { quantityOk: true, sealOk: true };
const INSPECTION_OK = { correctRider: true, correctProduct: true, correctCount: true, correctBatch: true, sealIntact: true, goodCondition: true, noWaterDamage: true };

let pickupId: string;
let deliveryId: string;

describe("wallets: Dandelion collects, members withdraw, two admins send", () => {
  beforeAll(async () => {
    const { supplier, hub, kit } = await ids();
    const rider = await userByPhone(SEED.riders[0]!.phone);
    pickupId = (await adminCreatePickup(await actors.adminA(), { supplierId: supplier.id, productId: kit.id, hubId: hub.id, riderId: rider.id, quantity: 10, pickupDate: tzDay() })).orderId;
    await confirmBatchReady(await actors.supplier(), pickupId, "SEAL-WAL-1", { packedWaterproof: true });
    await acceptPickup(await actors.rider(), pickupId);
  });

  it("holds the supplier's money while the pickup is open and releases it, less the fee per pack, at hand-over", async () => {
    const supplierId = (await userByPhone(SEED.supplier.phone)).id;
    const o = await order(pickupId);
    expect(o.platformFeeTzs).toBe(50 * 10); // 50 TZS per pack, 10 packs (founders, 2026-10-01)
    expect((await simulate("success", o.ref)).outcomes).toContain("CONFIRMED");
    expect(await balanceFor(getDb(), supplierId)).toMatchObject({ availableTzs: 0, onHoldTzs: o.totalTzs - 500 });
    await confirmRelease(await actors.supplier(), pickupId);
    await confirmReceipt(await actors.rider(), pickupId, CHECKS);
    expect(await balanceFor(getDb(), supplierId)).toMatchObject({ availableTzs: o.totalTzs - 500, onHoldTzs: 0, feesTzs: 500 });
  });

  it("a delivery to a hub carries no fee; the rider's money is on hold until the hub's payment and the hand-over complete", async () => {
    const delivery = await latestOrderOfKind("RIDER_TO_HUB", pickupId);
    deliveryId = delivery.id;
    expect(delivery.platformFeeTzs).toBe(0);
    await startInspection(await actors.hub(), deliveryId, await revealDeliveryCode(await actors.rider(), deliveryId));
    await passInspection(await actors.hub(), deliveryId, INSPECTION_OK);
    expect((await simulate("success", (await order(deliveryId)).ref)).outcomes).toContain("CONFIRMED");
    const riderId = (await userByPhone(SEED.riders[0]!.phone)).id;
    expect((await balanceFor(getDb(), riderId)).onHoldTzs).toBe(delivery.totalTzs);
    await confirmRelease(await actors.rider(), deliveryId);
    expect(await balanceFor(getDb(), riderId)).toMatchObject({ availableTzs: delivery.totalTzs, onHoldTzs: 0 });
  });

  it("a member asks; one admin approves; the same admin cannot send; a second admin sends and the member is told", async () => {
    const supplier = await actors.supplier();
    const before = await myWallet(supplier);
    expect(before.payoutTo).toBe(SEED.supplier.payee);
    await expect(requestWithdrawal(supplier, { amountTzs: 500 })).rejects.toMatchObject({ code: "withdrawal_too_small" });
    await expect(requestWithdrawal(supplier, { amountTzs: before.availableTzs + 1 })).rejects.toMatchObject({ code: "withdrawal_exceeds_available" });
    const { withdrawalId, ref } = await requestWithdrawal(supplier, { amountTzs: 10_000 });
    expect(ref).toMatch(/^WD-/);
    await expect(requestWithdrawal(supplier, { amountTzs: 1_000 })).rejects.toMatchObject({ code: "withdrawal_pending" });
    expect((await myWallet(supplier)).availableTzs).toBe(before.availableTzs - 10_000);
    expect(await payoutsWaiting()).toEqual({ toApprove: 1, toSend: 0 });

    // Nobody but an admin moves money.
    await expect(approveWithdrawal(supplier, withdrawalId)).rejects.toThrow(PolicyError);
    await expect(approveWithdrawal(await actors.hub(), withdrawalId)).rejects.toThrow(PolicyError);
    const adminA = await actors.adminA();
    const adminB = await actors.adminB();
    await expect(sendWithdrawal(adminA, withdrawalId, { providerRef: "MP-TEST-0001" })).rejects.toMatchObject({ code: "withdrawal_not_approved" });
    await approveWithdrawal(adminA, withdrawalId);
    expect(await payoutsWaiting()).toEqual({ toApprove: 0, toSend: 1 });
    await expect(sendWithdrawal(adminA, withdrawalId, { providerRef: "MP-TEST-0001" })).rejects.toMatchObject({ code: "payout_needs_second_admin" });
    await expect(sendWithdrawal(adminB, withdrawalId, { providerRef: "not a ref!" })).rejects.toThrow();
    const ledgerBefore = await ledgerCount("PAYOUT_SENT");
    await sendWithdrawal(adminB, withdrawalId, { providerRef: "MP-TEST-0001" });
    expect(await ledgerCount("PAYOUT_SENT")).toBe(ledgerBefore + 1);
    expect((await lastSms("PAYOUT_SENT"))?.body).toContain(ref);
    const after = await myWallet(supplier);
    expect(after).toMatchObject({ withdrawnTzs: 10_000, pendingWithdrawalTzs: 0, availableTzs: before.availableTzs - 10_000 });
    expect(after.withdrawals[0]).toMatchObject({ state: "SENT", providerRef: "MP-TEST-0001" });
  });

  it("a turned-down request gives the money back and the member is told why", async () => {
    const supplier = await actors.supplier();
    const before = (await myWallet(supplier)).availableTzs;
    const { withdrawalId, ref } = await requestWithdrawal(supplier, { amountTzs: 2_000 });
    await expect(rejectWithdrawal(await actors.adminA(), withdrawalId, { reason: "" })).rejects.toThrow();
    await rejectWithdrawal(await actors.adminA(), withdrawalId, { reason: "Payout number to be confirmed by phone" });
    expect((await myWallet(supplier)).availableTzs).toBe(before);
    expect((await lastSms("PAYOUT_REJECTED"))?.body).toContain(ref);
    await expect(approveWithdrawal(await actors.adminB(), withdrawalId)).rejects.toMatchObject({ code: "withdrawal_not_requested" });
  });

  it("the admins see the collection account: collected, paid out, expected in the account, fees, owed", async () => {
    const m = await moneyOverview(await actors.adminA());
    expect(m.paidOutTzs).toBe(10_000);
    expect(m.expectedInAccountTzs).toBe(m.collectedTzs - m.paidOutTzs);
    expect(m.feesTzs).toBe(500);
    expect(m.owedTzs).toBe(m.expectedInAccountTzs - m.feesTzs);
    expect(m.recent.map((w) => w.state).sort()).toEqual(["REJECTED", "SENT"]);
    await expect(moneyOverview(await actors.supplier())).rejects.toThrow(PolicyError);
  });

  it("the database refuses to rewrite a fee, a collection flag or a withdrawal", async () => {
    const db = getDb();
    await rejectsWithPg(db.execute(sql`update orders set platform_fee_tzs = 0 where id = ${pickupId}`), /immutable/);
    await rejectsWithPg(db.execute(sql`update payment_intents set collected_by_platform = false where order_id = ${pickupId}`), /immutable/);
    const sent = (await db.query.withdrawals.findFirst({ where: eq(s.withdrawals.state, "SENT") }))!;
    await rejectsWithPg(db.execute(sql`update withdrawals set amount_tzs = 1 where id = ${sent.id}`), /immutable/);
    await rejectsWithPg(db.execute(sql`update withdrawals set state = 'REQUESTED' where id = ${sent.id}`), /cannot move|cannot change/);
    await rejectsWithPg(db.execute(sql`delete from withdrawals where id = ${sent.id}`), /cannot be deleted/);
    await rejectsWithPg(db.execute(sql`update withdrawals set sent_by = approved_by where id = ${sent.id}`), /withdrawal_two_admins|finished|check constraint/);
  });
});
