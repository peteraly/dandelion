/**
 * Demand-driven restocking (Prompt H §2). Sales to customers, schools and
 * organisations are pulled by the buyer; stock cannot be, because the factory
 * is days away. So each hub keeps enough for the days a pickup takes to
 * arrive, measured from what it actually sold:
 *
 *   daily demand   = units sold from the hub in the window ÷ days in the window
 *   reorder point  = the larger of the hub's minimum and demand × (lead time + safety days)
 *   order up to    = demand × (lead time + safety days + days of cover)
 *
 * A pickup is suggested when stock on hand plus stock already on the way is
 * at or below the reorder point, sized up to the order-up-to level in packs
 * of ten. Pure: numbers in, a suggestion out; the admin still assigns it.
 */

export interface ReplenishmentInput {
  onHand: number;
  onTheWay: number;
  soldInWindow: number;
  windowDays: number;
  /** Days from assigning a pickup to the stock being available at the hub. */
  leadTimeDays: number;
  minStock: number;
  safetyDays?: number;
  coverDays?: number;
}

export interface Replenishment {
  dailyDemand: number;
  /** Whole days the stock on hand lasts at the current pace; null when nothing sells. */
  daysOfCover: number | null;
  reorderPoint: number;
  orderUpTo: number;
  suggested: number;
  reason: "below_minimum" | "below_reorder_point" | "ok";
}

export const SAFETY_DAYS = 3;
export const COVER_DAYS = 14;
const PACK = 10;

export function replenishment(i: ReplenishmentInput): Replenishment {
  const safety = i.safetyDays ?? SAFETY_DAYS;
  const cover = i.coverDays ?? COVER_DAYS;
  const dailyDemand = i.windowDays > 0 ? Math.max(0, i.soldInWindow) / i.windowDays : 0;
  const reorderPoint = Math.max(i.minStock, Math.ceil(dailyDemand * (i.leadTimeDays + safety)));
  const orderUpTo = Math.max(reorderPoint + i.minStock, Math.ceil(dailyDemand * (i.leadTimeDays + safety + cover)));
  const position = Math.max(0, i.onHand) + Math.max(0, i.onTheWay);
  const daysOfCover = dailyDemand > 0 ? Math.floor(Math.max(0, i.onHand) / dailyDemand) : null;
  if (position > reorderPoint) return { dailyDemand, daysOfCover, reorderPoint, orderUpTo, suggested: 0, reason: "ok" };
  const suggested = Math.max(PACK, Math.ceil((orderUpTo - position) / PACK) * PACK);
  return { dailyDemand, daysOfCover, reorderPoint, orderUpTo, suggested, reason: i.onHand < i.minStock ? "below_minimum" : "below_reorder_point" };
}
