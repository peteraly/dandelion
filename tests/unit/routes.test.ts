/**
 * Prompt I §2.2: how long a restock takes to reach a hub — planned from the
 * road and the rains, learned from real trips, and never shortened by a fast
 * record below a careful plan.
 */
import { describe, expect, it } from "vitest";
import { FAR_KM, MIN_TRIPS, leadTime, percentile, plannedRoadDays } from "@/lib/domain/routes";

const dry = { road: null, distanceKm: null, slowInRains: false, rainyNow: false } as const;

describe("plannedRoadDays", () => {
  it("is a day on an unknown or good road, two on dirt, a day more when far", () => {
    expect(plannedRoadDays(dry)).toBe(1);
    expect(plannedRoadDays({ ...dry, road: "PAVED", distanceKm: 4 })).toBe(1);
    expect(plannedRoadDays({ ...dry, road: "GRAVEL", distanceKm: FAR_KM })).toBe(1);
    expect(plannedRoadDays({ ...dry, road: "GRAVEL", distanceKm: FAR_KM + 1 })).toBe(2);
    expect(plannedRoadDays({ ...dry, road: "DIRT", distanceKm: 95 })).toBe(3);
  });

  it("doubles only on a road the rains slow, and only in a rainy month", () => {
    const dirt = { ...dry, road: "DIRT" as const, distanceKm: 95 };
    expect(plannedRoadDays({ ...dirt, rainyNow: true })).toBe(3);
    expect(plannedRoadDays({ ...dirt, slowInRains: true })).toBe(3);
    expect(plannedRoadDays({ ...dirt, slowInRains: true, rainyNow: true })).toBe(6);
  });
});

describe("percentile", () => {
  it("takes the nearest rank and ignores nonsense", () => {
    expect(percentile([], 0.8)).toBeNull();
    expect(percentile([3], 0.8)).toBe(3);
    expect(percentile([1, 2, 3, 4, 5], 0.8)).toBe(4);
    expect(percentile([5, 1, 4, 2, 3], 0.5)).toBe(3);
    expect(percentile([1, Number.NaN, -2, 2], 0.5)).toBe(1);
  });
});

describe("leadTime", () => {
  const base = { ...dry, road: "PAVED" as const, distanceKm: 4, supplierLeadDays: 2, tripDays: [] as number[] };

  it("uses the plan until there are enough real trips", () => {
    expect(leadTime(base)).toEqual({ days: 3, plannedDays: 3, measuredDays: null, trips: 0, source: "planned" });
    expect(leadTime({ ...base, tripDays: Array(MIN_TRIPS - 1).fill(9) })).toMatchObject({ days: 3, measuredDays: null, source: "planned" });
  });

  it("switches to the real time when trips are slower than the plan (4 in 5 within it)", () => {
    const r = leadTime({ ...base, tripDays: [4.2, 4.5, 5.1, 6.4, 4.9] });
    expect(r).toMatchObject({ days: 6, plannedDays: 3, measuredDays: 5.1, trips: 5, source: "measured" });
  });

  it("never shortens a careful plan because the record is fast", () => {
    const r = leadTime({ ...base, road: "DIRT", distanceKm: 95, slowInRains: true, rainyNow: true, tripDays: [0.2, 0.3, 0.25] });
    expect(r).toMatchObject({ days: 8, plannedDays: 8, source: "planned" });
    expect(r.measuredDays).toBeCloseTo(0.3);
  });

  it("is always at least a day", () => {
    expect(leadTime({ ...base, supplierLeadDays: 0 }).days).toBeGreaterThanOrEqual(1);
  });
});
