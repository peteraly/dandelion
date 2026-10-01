/**
 * How long a restock really takes to reach a hub (Prompt I §2.2). Two sources:
 *
 *  - the plan: the supplier's promised days plus days on the road, from the
 *    road to the hub (paved, gravel, dirt), its distance from the district
 *    town, and whether the rains slow it this month;
 *  - the record: for each completed delivery, the days from "pickup
 *    assigned" to "on the hub's shelf", which the app already timestamps.
 *
 * With at least MIN_TRIPS recent trips, the slow end of the record (4 in 5
 * trips arrive within it) is compared with the plan and the longer of the
 * two is used: a hub planned on paper as a day away that really takes three
 * is stocked for three; a measured fast route never shortens a careful plan,
 * because running out in a village costs more than a few extra packs on a
 * shelf. Pure: numbers in, a lead time out.
 */
import type { RoadType } from "./types";

/** Days on the road by the worst stretch, before distance and rains. */
export const ROAD_DAYS: Record<RoadType, number> = { PAVED: 1, GRAVEL: 1, DIRT: 2 };
/** Beyond this distance from the district town, a trip takes a day more. */
export const FAR_KM = 80;
/** Fewer recent trips than this and the record is not trusted yet. */
export const MIN_TRIPS = 3;
/** The share of trips that should arrive within the planned time. */
export const TRIP_PERCENTILE = 0.8;

export interface RoadInput {
  road: RoadType | null;
  distanceKm: number | null;
  slowInRains: boolean;
  rainyNow: boolean;
}

/** Days on the road on the plan: the road's days, a day more when far, twice that when the rains slow it now. */
export function plannedRoadDays(r: RoadInput): number {
  const base = (r.road ? ROAD_DAYS[r.road] : 1) + (r.distanceKm !== null && r.distanceKm > FAR_KM ? 1 : 0);
  return r.slowInRains && r.rainyNow ? base * 2 : base;
}

/** Whether `month` (1–12) is one of the area's rainy months. */
export function isRainyMonth(rainyMonths: readonly number[], month: number): boolean {
  return rainyMonths.includes(month);
}

/** The value below which `p` of the values fall (nearest rank); null for no values. */
export function percentile(values: readonly number[], p: number): number | null {
  const v = values.filter((x) => Number.isFinite(x) && x >= 0).sort((a, b) => a - b);
  if (!v.length) return null;
  return v[Math.min(v.length - 1, Math.max(0, Math.ceil(p * v.length) - 1))]!;
}

export interface LeadTimeInput extends RoadInput {
  supplierLeadDays: number;
  /** Days from pickup assigned to stock on the hub's shelf, one per recent completed delivery. */
  tripDays: readonly number[];
}

export interface LeadTime {
  /** What restock planning uses: whole days, at least one. */
  days: number;
  plannedDays: number;
  /** The slow end of the record, when there are enough trips; null otherwise. */
  measuredDays: number | null;
  trips: number;
  source: "planned" | "measured";
}

export function leadTime(i: LeadTimeInput): LeadTime {
  const plannedDays = Math.max(1, i.supplierLeadDays + plannedRoadDays(i));
  const trips = i.tripDays.filter((x) => Number.isFinite(x) && x >= 0).length;
  const measured = trips >= MIN_TRIPS ? percentile(i.tripDays, TRIP_PERCENTILE) : null;
  const measuredDays = measured === null ? null : Math.round(measured * 10) / 10;
  if (measuredDays !== null && Math.ceil(measuredDays) > plannedDays) return { days: Math.ceil(measuredDays), plannedDays, measuredDays, trips, source: "measured" };
  return { days: plannedDays, plannedDays, measuredDays, trips, source: "planned" };
}
