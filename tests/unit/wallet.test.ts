/**
 * Prompt L §2: a member's balance when Dandelion collects the money. Credits become available only when the order
 * is finished; the fee fixed on the order comes off; withdrawals waiting or sent come off what is available.
 */
import { describe, expect, it } from "vitest";
import { FEE_KINDS, balance, platformFeeFor, withdrawalRefusal } from "@/lib/domain/wallet";

describe("platformFeeFor", () => {
  it("applies only to supplier → delivery partner and delivery partner → customer, only when the platform collects", () => {
    expect(FEE_KINDS).toEqual(["SUPPLIER_TO_RIDER", "RIDER_TO_CUSTOMER"]);
    expect(platformFeeFor("SUPPLIER_TO_RIDER", 75_000, 50, "PLATFORM")).toBe(50);
    expect(platformFeeFor("RIDER_TO_CUSTOMER", 4_500, 50, "PLATFORM")).toBe(50);
    expect(platformFeeFor("CHAMPION_TO_CUSTOMER", 4_500, 50, "PLATFORM")).toBe(0);
    expect(platformFeeFor("HUB_TO_CHAMPION", 40_000, 50, "PLATFORM")).toBe(0);
    expect(platformFeeFor("RIDER_TO_CUSTOMER", 4_500, 50, "DIRECT")).toBe(0);
  });
  it("is charged per pack (founders, 2026-10-01), or once per order when two admins choose that", () => {
    expect(platformFeeFor("SUPPLIER_TO_RIDER", 150_000, 50, "PLATFORM", 50)).toBe(2_500);
    expect(platformFeeFor("SUPPLIER_TO_RIDER", 150_000, 50, "PLATFORM", 50, "ORDER")).toBe(50);
    expect(platformFeeFor("RIDER_TO_CUSTOMER", 4_500, 50, "PLATFORM", 1)).toBe(50);
    expect(platformFeeFor("SUPPLIER_TO_RIDER", 100, 50, "PLATFORM", 10)).toBe(100); // never more than the order
    expect(platformFeeFor("SUPPLIER_TO_RIDER", 150_000, 50, "DIRECT", 50)).toBe(0);
  });
  it("is never negative, fractional or more than the order", () => {
    expect(platformFeeFor("RIDER_TO_CUSTOMER", 30, 50, "PLATFORM")).toBe(30);
    expect(platformFeeFor("RIDER_TO_CUSTOMER", 4_500, -5, "PLATFORM")).toBe(0);
    expect(platformFeeFor("RIDER_TO_CUSTOMER", 4_500, 49.9, "PLATFORM")).toBe(49);
    expect(platformFeeFor("RIDER_TO_CUSTOMER", 4_500, 0, "PLATFORM")).toBe(0);
  });
});

describe("balance", () => {
  const done = (confirmedTzs: number, platformFeeTzs = 50) => ({ orderState: "COMPLETED" as const, confirmedTzs, platformFeeTzs });
  const open = (confirmedTzs: number, platformFeeTzs = 50) => ({ orderState: "PLAN_ACTIVE" as const, confirmedTzs, platformFeeTzs });

  it("makes money available only once the goods are handed over, after the fee", () => {
    const b = balance([done(4_500), open(2_000)], []);
    expect(b).toMatchObject({ availableTzs: 4_450, onHoldTzs: 1_950, earnedTzs: 4_450, feesTzs: 50, withdrawnTzs: 0, pendingWithdrawalTzs: 0, overdrawn: false });
  });

  it("never counts a cancelled order's money: it goes back to the buyer or followed her order to the next seller", () => {
    expect(balance([done(4_500), { orderState: "CANCELLED", confirmedTzs: 4_500, platformFeeTzs: 50 }], [])).toMatchObject({ availableTzs: 4_450, onHoldTzs: 0 });
  });

  it("takes withdrawals waiting and sent off what is available; a turned-down one gives it back", () => {
    const credits = [done(10_000, 0), done(5_000, 0)];
    expect(balance(credits, [{ amountTzs: 6_000, state: "REQUESTED" }]).availableTzs).toBe(9_000);
    expect(balance(credits, [{ amountTzs: 6_000, state: "APPROVED" }]).availableTzs).toBe(9_000);
    expect(balance(credits, [{ amountTzs: 6_000, state: "SENT" }])).toMatchObject({ availableTzs: 9_000, withdrawnTzs: 6_000, pendingWithdrawalTzs: 0 });
    expect(balance(credits, [{ amountTzs: 6_000, state: "REJECTED" }]).availableTzs).toBe(15_000);
  });

  it("flags an overdrawn member (a reversal after a payout) and never shows a negative balance", () => {
    const b = balance([done(1_000, 0)], [{ amountTzs: 3_000, state: "SENT" }]);
    expect(b.availableTzs).toBe(0);
    expect(b.overdrawn).toBe(true);
  });

  it("never takes a fee larger than what was paid", () => {
    expect(balance([done(30, 50)], [])).toMatchObject({ availableTzs: 0, feesTzs: 30 });
  });
});

describe("withdrawalRefusal", () => {
  const b = balance([{ orderState: "COMPLETED", confirmedTzs: 20_000, platformFeeTzs: 0 }], []);
  it("refuses too little, more than available, fractions, and a second request while one is open", () => {
    expect(withdrawalRefusal(500, b, 1_000)).toBe("withdrawal_too_small");
    expect(withdrawalRefusal(1_000.5, b, 1_000)).toBe("withdrawal_too_small");
    expect(withdrawalRefusal(25_000, b, 1_000)).toBe("withdrawal_exceeds_available");
    expect(withdrawalRefusal(20_000, b, 1_000)).toBeNull();
    const pending = balance([{ orderState: "COMPLETED", confirmedTzs: 20_000, platformFeeTzs: 0 }], [{ amountTzs: 2_000, state: "REQUESTED" }]);
    expect(withdrawalRefusal(1_000, pending, 1_000)).toBe("withdrawal_pending");
  });
});
