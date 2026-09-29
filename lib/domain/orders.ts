/**
 * Order state machines, one table per order kind (handbook §8 A–E).
 * "Awaiting payment" is an ORDER state; payment status lives on PaymentIntent.
 */
import { defineMachine, requireTrue, type Guard, type Machine } from "./machine";
import { isDualApproved, type DualApprovalProof } from "./approval";
import { ORDER_STATES, type OrderKind, type OrderState } from "./types";

export type OrderEvent =
  | "CONFIRM_BATCH_READY"
  | "ACCEPT_PICKUP"
  | "START_INSPECTION"
  | "INSPECTION_PASSED"
  | "INSPECTION_FAILED"
  | "RESUME"
  | "RETURN"
  | "PREPARE_TRANSFER"
  | "DECLINE"
  | "PAYMENT_CONFIRMED"
  | "INSTALLMENT_CONFIRMED"
  | "DONOR_FUNDED"
  | "START_HANDOVER"
  | "CANCEL_HANDOVER"
  | "COMPLETE"
  | "CANCEL"
  | "CLOSE_PLAN";

export interface OrderCtx {
  fullyPaid?: boolean;
  hasConfirmedPayment?: boolean;
  hasDonorFunding?: boolean;
  senderConfirmed?: boolean;
  receiverConfirmed?: boolean;
  deliveryCodeValid?: boolean;
  stockAvailable?: boolean;
  stockReserved?: boolean;
  customerCodeValid?: boolean;
  educationConfirmed?: boolean;
  approval?: DualApprovalProof;
}

const fullyPaid = requireTrue<OrderCtx>((c) => c.fullyPaid, "full_payment_not_confirmed");
const notFullyPaid: Guard<OrderCtx> = (c) => (c.fullyPaid ? "already_fully_paid" : null);
const bothConfirmed: Guard<OrderCtx>[] = [
  requireTrue((c) => c.senderConfirmed, "sender_not_confirmed"),
  requireTrue((c) => c.receiverConfirmed, "receiver_not_confirmed"),
];
const noPayment: Guard<OrderCtx> = (c) => (c.hasConfirmedPayment || c.hasDonorFunding ? "has_payment" : null);
const dualApproved: Guard<OrderCtx> = (c) => (isDualApproved(c.approval) ? null : "dual_approval_required");

export const supplierToRiderMachine = defineMachine<OrderState, OrderEvent, OrderCtx>("order:SUPPLIER_TO_RIDER", ORDER_STATES, [
  { event: "CONFIRM_BATCH_READY", from: ["PICKUP_ASSIGNED"], to: "BATCH_READY", actors: ["SUPPLIER"] },
  { event: "ACCEPT_PICKUP", from: ["BATCH_READY"], to: "AWAITING_PAYMENT", actors: ["BOSS_RIDER"] },
  { event: "PAYMENT_CONFIRMED", from: ["AWAITING_PAYMENT"], to: "PAID", actors: ["SYSTEM_VERIFIER"], guards: [fullyPaid] },
  {
    event: "COMPLETE",
    from: ["PAID"],
    to: "COMPLETED",
    actors: ["SUPPLIER", "BOSS_RIDER", "SYSTEM_VERIFIER"],
    guards: [fullyPaid, ...bothConfirmed],
  },
  { event: "CANCEL", from: ["PICKUP_ASSIGNED", "BATCH_READY", "AWAITING_PAYMENT"], to: "CANCELLED", actors: ["SUPER_ADMIN"], guards: [noPayment] },
]);

export const riderToHubMachine = defineMachine<OrderState, OrderEvent, OrderCtx>("order:RIDER_TO_HUB", ORDER_STATES, [
  {
    event: "START_INSPECTION",
    from: ["EN_ROUTE"],
    to: "INSPECTING",
    actors: ["HUB_MANAGER"],
    guards: [requireTrue((c) => c.deliveryCodeValid, "delivery_code_invalid")],
  },
  { event: "INSPECTION_PASSED", from: ["INSPECTING"], to: "AWAITING_PAYMENT", actors: ["HUB_MANAGER"] },
  { event: "INSPECTION_FAILED", from: ["INSPECTING"], to: "ON_HOLD", actors: ["HUB_MANAGER"] },
  { event: "RESUME", from: ["ON_HOLD"], to: "INSPECTING", actors: ["SYSTEM_APPROVALS"], guards: [dualApproved] },
  { event: "RETURN", from: ["ON_HOLD"], to: "CANCELLED", actors: ["SYSTEM_APPROVALS"], guards: [dualApproved] },
  { event: "PAYMENT_CONFIRMED", from: ["AWAITING_PAYMENT"], to: "PAID", actors: ["SYSTEM_VERIFIER"], guards: [fullyPaid] },
  {
    event: "COMPLETE",
    from: ["PAID"],
    to: "COMPLETED",
    actors: ["HUB_MANAGER", "BOSS_RIDER", "SYSTEM_VERIFIER"],
    guards: [fullyPaid, ...bothConfirmed],
  },
]);

export const hubToChampionMachine = defineMachine<OrderState, OrderEvent, OrderCtx>("order:HUB_TO_CHAMPION", ORDER_STATES, [
  {
    event: "PREPARE_TRANSFER",
    from: ["REQUESTED"],
    to: "AWAITING_PAYMENT",
    actors: ["HUB_MANAGER"],
    guards: [requireTrue((c) => c.stockAvailable, "insufficient_stock")],
  },
  { event: "DECLINE", from: ["REQUESTED"], to: "CANCELLED", actors: ["HUB_MANAGER", "FIELD_CHAMPION"] },
  { event: "CANCEL", from: ["AWAITING_PAYMENT"], to: "CANCELLED", actors: ["HUB_MANAGER", "FIELD_CHAMPION", "SUPER_ADMIN"], guards: [noPayment] },
  { event: "PAYMENT_CONFIRMED", from: ["AWAITING_PAYMENT"], to: "PAID", actors: ["SYSTEM_VERIFIER"], guards: [fullyPaid] },
  {
    event: "COMPLETE",
    from: ["PAID"],
    to: "COMPLETED",
    actors: ["HUB_MANAGER", "FIELD_CHAMPION", "SYSTEM_VERIFIER"],
    guards: [fullyPaid, ...bothConfirmed],
  },
]);

export const championToCustomerMachine = defineMachine<OrderState, OrderEvent, OrderCtx>("order:CHAMPION_TO_CUSTOMER", ORDER_STATES, [
  { event: "INSTALLMENT_CONFIRMED", from: ["PLAN_ACTIVE"], to: "PLAN_ACTIVE", actors: ["SYSTEM_VERIFIER"], guards: [notFullyPaid] },
  { event: "PAYMENT_CONFIRMED", from: ["PLAN_ACTIVE"], to: "FULLY_PAID", actors: ["SYSTEM_VERIFIER"], guards: [fullyPaid] },
  {
    event: "DONOR_FUNDED",
    from: ["PLAN_ACTIVE"],
    to: { oneOf: ["PLAN_ACTIVE", "FULLY_PAID"], pick: (c) => (c.fullyPaid ? "FULLY_PAID" : "PLAN_ACTIVE") },
    actors: ["SYSTEM_APPROVALS"],
    guards: [dualApproved],
  },
  {
    event: "START_HANDOVER",
    from: ["FULLY_PAID"],
    to: "HANDOVER_PENDING",
    actors: ["FIELD_CHAMPION"],
    guards: [fullyPaid, requireTrue((c) => c.stockReserved, "no_stock_reserved")],
  },
  { event: "CANCEL_HANDOVER", from: ["HANDOVER_PENDING"], to: "FULLY_PAID", actors: ["FIELD_CHAMPION", "SUPER_ADMIN"] },
  {
    event: "COMPLETE",
    from: ["HANDOVER_PENDING"],
    to: "COMPLETED",
    actors: ["FIELD_CHAMPION"],
    guards: [
      fullyPaid,
      requireTrue((c) => c.customerCodeValid, "customer_code_invalid"),
      requireTrue((c) => c.educationConfirmed, "education_not_confirmed"),
    ],
  },
  { event: "CLOSE_PLAN", from: ["PLAN_ACTIVE"], to: "CLOSED", actors: ["FIELD_CHAMPION", "SUPER_ADMIN"], guards: [noPayment] },
]);

export const ORDER_MACHINES: Record<OrderKind, Machine<OrderState, OrderEvent, OrderCtx>> = {
  SUPPLIER_TO_RIDER: supplierToRiderMachine,
  RIDER_TO_HUB: riderToHubMachine,
  HUB_TO_CHAMPION: hubToChampionMachine,
  CHAMPION_TO_CUSTOMER: championToCustomerMachine,
};

export const INITIAL_ORDER_STATE: Record<OrderKind, OrderState> = {
  SUPPLIER_TO_RIDER: "PICKUP_ASSIGNED",
  RIDER_TO_HUB: "EN_ROUTE",
  HUB_TO_CHAMPION: "REQUESTED",
  CHAMPION_TO_CUSTOMER: "PLAN_ACTIVE",
};

export const TERMINAL_ORDER_STATES: readonly OrderState[] = ["COMPLETED", "CANCELLED", "CLOSED"];

/** Order states in which a payment for the order may be expected. */
export const PAYABLE_ORDER_STATES: readonly OrderState[] = ["AWAITING_PAYMENT", "PLAN_ACTIVE"];

/**
 * Payment matching rule per order kind (review correction §4.3):
 * B2B sales are one exact payment; customer installments may be any
 * positive amount up to the remaining balance.
 */
export function amountRuleFor(kind: OrderKind): "EXACT_REMAINING" | "UP_TO_REMAINING" {
  return kind === "CHAMPION_TO_CUSTOMER" ? "UP_TO_REMAINING" : "EXACT_REMAINING";
}
