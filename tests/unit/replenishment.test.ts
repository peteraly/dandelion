/**
 * Prompt H §2: restocking follows what a hub actually sold. A pickup is
 * suggested only when stock on hand plus stock on the way is at or below the
 * reorder point, sized to cover the lead time, a safety margin and two weeks.
 */
import { describe, expect, it } from "vitest";
import { COVER_DAYS, SAFETY_DAYS, replenishment } from "@/lib/domain/replenishment";

const base = { onHand: 100, onTheWay: 0, soldInWindow: 70, windowDays: 14, leadTimeDays: 3, minStock: 20 };

describe("replenishment", () => {
  it("measures demand per day and how many days the stock lasts", () => {
    const r = replenishment(base);
    expect(r.dailyDemand).toBe(5);
    expect(r.daysOfCover).toBe(20);
    expect(r.reorderPoint).toBe(5 * (3 + SAFETY_DAYS));
    expect(r.orderUpTo).toBe(5 * (3 + SAFETY_DAYS + COVER_DAYS));
    expect(r.suggested).toBe(0);
    expect(r.reason).toBe("ok");
  });

  it("suggests a pickup at the reorder point, in packs of ten, up to the order-up-to level", () => {
    const r = replenishment({ ...base, onHand: 28 });
    expect(r.reason).toBe("below_reorder_point");
    expect(r.suggested % 10).toBe(0);
    expect(r.suggested).toBeGreaterThanOrEqual(r.orderUpTo - 28);
    expect(r.suggested - (r.orderUpTo - 28)).toBeLessThan(10);
  });

  it("counts stock already on the way, so the same gap is never ordered twice", () => {
    expect(replenishment({ ...base, onHand: 20, onTheWay: 100 }).suggested).toBe(0);
    const partly = replenishment({ ...base, onHand: 10, onTheWay: 10 });
    expect(partly.suggested).toBeGreaterThan(0);
    expect(partly.suggested).toBeLessThan(replenishment({ ...base, onHand: 10 }).suggested);
  });

  it("keeps the hub's own minimum when nothing sells, and flags stock below it first", () => {
    const quiet = replenishment({ ...base, soldInWindow: 0, onHand: 25 });
    expect(quiet.daysOfCover).toBeNull();
    expect(quiet.reorderPoint).toBe(20);
    expect(quiet.suggested).toBe(0);
    const low = replenishment({ ...base, soldInWindow: 0, onHand: 5 });
    expect(low.reason).toBe("below_minimum");
    expect(low.suggested).toBeGreaterThanOrEqual(10);
  });

  it("never suggests a negative or fractional pickup, whatever the inputs", () => {
    for (const onHand of [-5, 0, 3, 17, 40])
      for (const sold of [0, 1, 13, 500]) {
        const r = replenishment({ ...base, onHand, soldInWindow: sold });
        expect(r.suggested).toBeGreaterThanOrEqual(0);
        expect(Number.isInteger(r.suggested)).toBe(true);
      }
  });
});
