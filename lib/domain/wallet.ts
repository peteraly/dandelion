/**
 * A member's balance when Dandelion collects the money (founders, 2026-10-01; Prompt L §2).
 *
 * Every buyer pays Dandelion's collection account; each confirmed payment is credited to the seller it was for. The
 * credit becomes **available** once the order is finished (the goods were handed over), so money never leaves for a
 * sale that is still open or might be refunded; until then it is **on hold**. Dandelion's operating fee on the order
 * (fixed when the order was made) comes off the seller's credit. Withdrawals waiting or sent come off what is
 * available. Pure: rows in, numbers out.
 */
import type { OrderKind, OrderState, PaymentRoute, WithdrawalState } from "./types";

/** The sales Dandelion's fee applies to (founders: supplier → delivery partner, delivery partner → customer). */
export const FEE_KINDS: readonly OrderKind[] = ["SUPPLIER_TO_RIDER", "RIDER_TO_CUSTOMER"];

/** The fee to fix on a new order: only when the platform collects, only on the fee kinds, never more than the order. */
export function platformFeeFor(kind: OrderKind, totalTzs: number, feeTzs: number, route: PaymentRoute): number {
  if (route !== "PLATFORM" || !FEE_KINDS.includes(kind)) return 0;
  return Math.max(0, Math.min(Math.trunc(feeTzs), totalTzs));
}

export interface CreditRow {
  orderState: OrderState;
  /** Confirmed money for this order paid into the collection account for this member. */
  confirmedTzs: number;
  platformFeeTzs: number;
}

export interface WithdrawalRow {
  amountTzs: number;
  state: WithdrawalState;
}

export interface Balance {
  /** Can be withdrawn now. */
  availableTzs: number;
  /** Paid by buyers for orders not finished yet. */
  onHoldTzs: number;
  /** Asked for or approved, not yet sent. */
  pendingWithdrawalTzs: number;
  /** Sent to the member, ever. */
  withdrawnTzs: number;
  /** Credited from finished orders, ever, after fees. */
  earnedTzs: number;
  /** Dandelion's fees on finished orders, ever. */
  feesTzs: number;
  /** True when withdrawals exceed credits (a reversal after a payout): admins must look. */
  overdrawn: boolean;
}

const FINISHED: readonly OrderState[] = ["COMPLETED"];

export function balance(credits: readonly CreditRow[], withdrawals: readonly WithdrawalRow[]): Balance {
  let earned = 0;
  let fees = 0;
  let onHold = 0;
  for (const c of credits) {
    if (c.confirmedTzs <= 0) continue;
    const fee = Math.min(c.platformFeeTzs, c.confirmedTzs);
    if (FINISHED.includes(c.orderState)) {
      earned += c.confirmedTzs - fee;
      fees += fee;
    } else {
      onHold += c.confirmedTzs - fee;
    }
  }
  const pending = withdrawals.filter((w) => w.state === "REQUESTED" || w.state === "APPROVED").reduce((a, w) => a + w.amountTzs, 0);
  const withdrawn = withdrawals.filter((w) => w.state === "SENT").reduce((a, w) => a + w.amountTzs, 0);
  const free = earned - pending - withdrawn;
  return { availableTzs: Math.max(0, free), onHoldTzs: onHold, pendingWithdrawalTzs: pending, withdrawnTzs: withdrawn, earnedTzs: earned, feesTzs: fees, overdrawn: free < 0 };
}

/** Why a withdrawal of `amount` cannot be asked for, or null when it can. */
export function withdrawalRefusal(amountTzs: number, b: Balance, minTzs: number): "withdrawal_too_small" | "withdrawal_exceeds_available" | "withdrawal_pending" | null {
  if (!Number.isInteger(amountTzs) || amountTzs < minTzs) return "withdrawal_too_small";
  if (b.pendingWithdrawalTzs > 0) return "withdrawal_pending";
  if (amountTzs > b.availableTzs) return "withdrawal_exceeds_available";
  return null;
}
