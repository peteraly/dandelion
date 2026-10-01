/**
 * Demand-driven restocking (Prompt H §2). Sales to customers, schools and
 * organisations are pulled by the buyer; stock cannot be, because the factory
 * is days away. So each hub keeps enough for the days a pickup takes to
 * arrive, measured from what it actually sold:
 *
 *   daily demand   = units sold from the hub in the window ÷ days it had stock to sell
 *   reorder point  = the larger of the hub's minimum and demand × (lead time + safety days)
 *   order up to    = demand × (lead time + safety days + days of cover)
 *
 * A pickup is suggested when stock on hand plus stock already on the way,
 * minus what local sellers asked for and are still waiting on, is at or below
 * the reorder point, sized up to the order-up-to level in packs of ten.
 *
 * Days with an empty shelf (Prompt I §2.3) do not count as days of demand: a
 * hub that sold 30 packs in the 7 days it had any wanted about 4 a day, not
 * 2, and planning on 2 would keep it empty. Pure: numbers in, a suggestion
 * out; the admin still assigns it.
 */

export interface ReplenishmentInput {
  onHand: number;
  onTheWay: number;
  soldInWindow: number;
  windowDays: number;
  /** Days from assigning a pickup to the stock being available at the hub. */
  leadTimeDays: number;
  minStock: number;
  /** Days in the window the hub had none of the product (from the nightly stock record); 0 when unknown. */
  daysOutOfStock?: number;
  /** Units local sellers asked this hub for and are still waiting on. */
  waiting?: number;
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
/** Never read demand from fewer selling days than this: three good days are not a trend. */
export const MIN_SELLING_DAYS = 3;
const PACK = 10;

export function replenishment(i: ReplenishmentInput): Replenishment {
  const safety = i.safetyDays ?? SAFETY_DAYS;
  const cover = i.coverDays ?? COVER_DAYS;
  const sellingDays = Math.min(i.windowDays, Math.max(MIN_SELLING_DAYS, i.windowDays - Math.max(0, i.daysOutOfStock ?? 0)));
  const dailyDemand = i.windowDays > 0 ? Math.max(0, i.soldInWindow) / sellingDays : 0;
  const reorderPoint = Math.max(i.minStock, Math.ceil(dailyDemand * (i.leadTimeDays + safety)));
  const orderUpTo = Math.max(reorderPoint + i.minStock, Math.ceil(dailyDemand * (i.leadTimeDays + safety + cover)));
  const position = Math.max(0, i.onHand) + Math.max(0, i.onTheWay) - Math.max(0, i.waiting ?? 0);
  const daysOfCover = dailyDemand > 0 ? Math.floor(Math.max(0, i.onHand) / dailyDemand) : null;
  if (position > reorderPoint) return { dailyDemand, daysOfCover, reorderPoint, orderUpTo, suggested: 0, reason: "ok" };
  const suggested = Math.max(PACK, Math.ceil((orderUpTo - position) / PACK) * PACK);
  return { dailyDemand, daysOfCover, reorderPoint, orderUpTo, suggested, reason: i.onHand < i.minStock ? "below_minimum" : "below_reorder_point" };
}
