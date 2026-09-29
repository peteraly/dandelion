/**
 * Pure supplier metrics (Prompt B §8.3/§8.4). No I/O: the services feed rows
 * in, the pages and the ecosystem view read the numbers out, the unit tests
 * pin the arithmetic.
 */
import type { ExceptionType, OrderState } from "./types";

/** Exception types that say something about what the supplier shipped. */
export const SUPPLIER_QUALITY_TYPES = ["STOCK_SHORT", "SEAL_BROKEN", "DAMAGED_OR_WET"] as const satisfies readonly ExceptionType[];
export type SupplierQualityType = (typeof SUPPLIER_QUALITY_TYPES)[number];

/** Pickup states in which the supplier still has something to do or wait for. */
export const OPEN_PICKUP_STATES = ["PICKUP_ASSIGNED", "BATCH_READY", "AWAITING_PAYMENT", "PAID"] as const satisfies readonly OrderState[];

export interface QualitySignal {
  batches: number;
  withIssue: number;
  /** withIssue / batches, 0 when there are no batches. */
  share: number;
}

/** Share of a supplier's batches that carry at least one quality exception. */
export function qualitySignal(batchIds: readonly string[], issueBatchIds: ReadonlySet<string>): QualitySignal {
  const batches = new Set(batchIds).size;
  let withIssue = 0;
  for (const id of new Set(batchIds)) if (issueBatchIds.has(id)) withIssue++;
  return { batches, withIssue, share: batches === 0 ? 0 : withIssue / batches };
}

/** Sum of provider-confirmed amounts at or after `from` (never "expected" money). */
export function sumConfirmedSince(intents: readonly { confirmedAmountTzs: number | null; confirmedAt: Date | null }[], from: Date): number {
  let sum = 0;
  for (const i of intents) if (i.confirmedAt && i.confirmedAmountTzs !== null && i.confirmedAt.getTime() >= from.getTime()) sum += i.confirmedAmountTzs;
  return sum;
}

/** Pickups still waiting on the supplier for longer than its lead time. */
export function waitingPastLeadTime(pickups: readonly { state: OrderState; createdAt: Date }[], leadTimeDays: number, at: Date): number {
  const cutoff = at.getTime() - leadTimeDays * 86_400_000;
  return pickups.filter((p) => p.state === "PICKUP_ASSIGNED" && p.createdAt.getTime() < cutoff).length;
}

export function isOpenPickup(state: OrderState): boolean {
  return (OPEN_PICKUP_STATES as readonly OrderState[]).includes(state);
}
