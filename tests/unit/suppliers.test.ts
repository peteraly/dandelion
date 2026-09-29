/** Prompt B §8.6: supplier metrics are arithmetic on rows the services hand in. */
import { describe, expect, it } from "vitest";
import { isOpenPickup, qualitySignal, sumConfirmedSince, waitingPastLeadTime } from "@/lib/domain/suppliers";

describe("supplier metrics", () => {
  it("quality signal is the share of distinct batches with at least one quality exception", () => {
    expect(qualitySignal([], new Set())).toEqual({ batches: 0, withIssue: 0, share: 0 });
    expect(qualitySignal(["a", "b", "c", "d"], new Set(["b"]))).toEqual({ batches: 4, withIssue: 1, share: 0.25 });
    // Duplicate batch ids and issues on unknown batches do not inflate anything.
    expect(qualitySignal(["a", "a", "b"], new Set(["a", "zzz"]))).toEqual({ batches: 2, withIssue: 1, share: 0.5 });
  });

  it("sums only provider-confirmed amounts inside the window", () => {
    const t0 = new Date("2026-09-21T00:00:00Z");
    const intents = [
      { confirmedAmountTzs: 7500, confirmedAt: new Date("2026-09-22T10:00:00Z") },
      { confirmedAmountTzs: 3000, confirmedAt: new Date("2026-09-20T23:59:59Z") }, // before the window
      { confirmedAmountTzs: null, confirmedAt: new Date("2026-09-23T10:00:00Z") }, // never confirmed
      { confirmedAmountTzs: 8000, confirmedAt: null },
      { confirmedAmountTzs: 500, confirmedAt: t0 }, // boundary counts
    ];
    expect(sumConfirmedSince(intents, t0)).toBe(8000);
  });

  it("counts pickups still assigned for longer than the lead time", () => {
    const at = new Date("2026-09-29T12:00:00Z");
    const day = 86_400_000;
    const pickups = [
      { state: "PICKUP_ASSIGNED" as const, createdAt: new Date(at.getTime() - 5 * day) },
      { state: "PICKUP_ASSIGNED" as const, createdAt: new Date(at.getTime() - 1 * day) },
      { state: "BATCH_READY" as const, createdAt: new Date(at.getTime() - 9 * day) }, // no longer waiting on the supplier
      { state: "COMPLETED" as const, createdAt: new Date(at.getTime() - 30 * day) },
    ];
    expect(waitingPastLeadTime(pickups, 2, at)).toBe(1);
    expect(waitingPastLeadTime(pickups, 0, at)).toBe(2);
    expect(waitingPastLeadTime(pickups, 10, at)).toBe(0);
  });

  it("knows which pickup states are open", () => {
    for (const st of ["PICKUP_ASSIGNED", "BATCH_READY", "AWAITING_PAYMENT", "PAID"] as const) expect(isOpenPickup(st)).toBe(true);
    for (const st of ["COMPLETED", "CANCELLED", "EN_ROUTE", "PLAN_ACTIVE"] as const) expect(isOpenPickup(st)).toBe(false);
  });
});
