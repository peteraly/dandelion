/**
 * Payment status machine (invariants §3.1 and §3.2).
 *
 * Only SYSTEM_VERIFIER — the verification job — may move a payment, and a
 * confirmation needs every verification check to have passed. There is no
 * transition any user, admin, or AI can fire.
 */
import { defineMachine, requireTrue, type Guard } from "./machine";
import { PAYMENT_STATUSES, type PaymentStatus } from "./types";
import type { Tzs } from "@/lib/money";

export type PaymentEvent = "CONFIRM" | "FAIL_OR_REVIEW" | "REVERSED";

export interface VerificationEvidence {
  /** How the transaction reached us. */
  source?: "CALLBACK" | "POLL";
  /** A direct status query to the provider was made and answered. */
  providerQueried?: boolean;
  /** Status reported by that direct query (never by the callback). */
  providerStatus?: "SUCCESS" | "FAILED" | "PENDING" | "REVERSED" | "NOT_FOUND";
  /** The permanent (provider, providerTxRef) dedupe row was inserted by this job. */
  dedupeRecorded?: boolean;
  amountMatched?: boolean;
  payeeMatched?: boolean;
  /** False only if the provider supports signatures and the check failed. */
  signatureOk?: boolean;
}

const verified: Guard<VerificationEvidence>[] = [
  (c) => (c.source === "CALLBACK" || c.source === "POLL" ? null : "no_callback_or_poll"),
  requireTrue((c) => c.providerQueried, "provider_not_queried"),
  (c) => (c.providerStatus === "SUCCESS" ? null : "provider_status_not_success"),
  requireTrue((c) => c.dedupeRecorded, "dedupe_not_recorded"),
  (c) => (c.signatureOk === false ? "signature_invalid" : null),
  requireTrue((c) => c.amountMatched, "amount_mismatch"),
  requireTrue((c) => c.payeeMatched, "payee_mismatch"),
];

export const paymentMachine = defineMachine<PaymentStatus, PaymentEvent, VerificationEvidence>("payment", PAYMENT_STATUSES, [
  // Review is terminal for an intent: admins resolve the exception; money that later
  // arrives legitimately confirms a fresh intent instead of rewriting this record.
  { event: "CONFIRM", from: ["PAYMENT_PENDING"], to: "PAYMENT_CONFIRMED", actors: ["SYSTEM_VERIFIER"], guards: verified },
  { event: "FAIL_OR_REVIEW", from: ["PAYMENT_PENDING"], to: "PAYMENT_FAILED_OR_REVIEW", actors: ["SYSTEM_VERIFIER"] },
  {
    event: "REVERSED",
    from: ["PAYMENT_CONFIRMED"],
    to: "PAYMENT_FAILED_OR_REVIEW",
    actors: ["SYSTEM_VERIFIER"],
    guards: [(c) => (c.providerQueried && c.providerStatus === "REVERSED" ? null : "reversal_not_verified")],
  },
]);

export type AmountRule = "EXACT_REMAINING" | "UP_TO_REMAINING";

/** Pure amount check. `remaining` is the unpaid balance at verification time. */
export function amountMatches(rule: AmountRule, amount: Tzs, remaining: Tzs): { ok: true } | { ok: false; reason: "WRONG_AMOUNT" | "OVERPAYMENT" } {
  if (amount <= 0) return { ok: false, reason: "WRONG_AMOUNT" };
  if (rule === "EXACT_REMAINING") return amount === remaining ? { ok: true } : { ok: false, reason: amount > remaining ? "OVERPAYMENT" : "WRONG_AMOUNT" };
  return amount <= remaining ? { ok: true } : { ok: false, reason: "OVERPAYMENT" };
}
