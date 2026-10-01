/**
 * Order state machines, one table per order kind (handbook §8 A–E).
 * "Awaiting payment" is an ORDER state; payment status lives on PaymentIntent.
 */
import { defineMachine, requireTrue, type Guard, type Machine, type TransitionRow } from "./machine";
import { isDualApproved, type DualApprovalProof } from "./approval";
import { ORDER_STATES, type ActorKind, type OrderKind, type OrderState } from "./types";
import { isPlanKind } from "./sales";

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
  | "PAYMENT_REVERSED"
  | "INSTALLMENT_CONFIRMED"
  | "DONOR_FUNDED"
  | "START_HANDOVER"
  | "CANCEL_HANDOVER"
  | "COMPLETE"
  | "CANCEL"
  | "CLOSE_PLAN"
  | "REASSIGN"
  | "PAYMENT_CARRIED";

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

type OrderMachine = Machine<OrderState, OrderEvent, OrderCtx>;
type Rows = TransitionRow<OrderState, OrderEvent, OrderCtx>[];

/**
 * Bulk sale that starts as a pickup at the factory (handbook §8 A/B): the
 * supplier prepares the batch, the buyer collects it once the provider has
 * confirmed the payment and both parties confirm. `buyer` is the collecting
 * role — a boss rider on the ladder, a hub manager or champion at the factory gate.
 */
function factoryPickupMachine(kind: OrderKind, buyer: ActorKind): OrderMachine {
  return defineMachine<OrderState, OrderEvent, OrderCtx>(`order:${kind}`, ORDER_STATES, [
    { event: "CONFIRM_BATCH_READY", from: ["PICKUP_ASSIGNED"], to: "BATCH_READY", actors: ["SUPPLIER"] },
    { event: "ACCEPT_PICKUP", from: ["BATCH_READY"], to: "AWAITING_PAYMENT", actors: [buyer] },
    { event: "PAYMENT_CONFIRMED", from: ["AWAITING_PAYMENT"], to: "PAID", actors: ["SYSTEM_VERIFIER"], guards: [fullyPaid] },
    // The provider reversed the payment before the transfer completed: back to waiting, nothing moved.
    { event: "PAYMENT_REVERSED", from: ["PAID"], to: "AWAITING_PAYMENT", actors: ["SYSTEM_VERIFIER"], guards: [notFullyPaid] },
    {
      event: "COMPLETE",
      from: ["PAID"],
      to: "COMPLETED",
      actors: ["SUPPLIER", buyer, "SYSTEM_VERIFIER"],
      guards: [fullyPaid, ...bothConfirmed],
    },
    { event: "CANCEL", from: ["PICKUP_ASSIGNED", "BATCH_READY", "AWAITING_PAYMENT"], to: "CANCELLED", actors: ["SUPER_ADMIN"], guards: [noPayment] },
  ]);
}

export const supplierToRiderMachine = factoryPickupMachine("SUPPLIER_TO_RIDER", "BOSS_RIDER");
export const supplierToHubMachine = factoryPickupMachine("SUPPLIER_TO_HUB", "HUB_MANAGER");
export const supplierToChampionMachine = factoryPickupMachine("SUPPLIER_TO_CHAMPION", "FIELD_CHAMPION");

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
  // The provider reversed the payment before the transfer completed: back to waiting, nothing moved.
  { event: "PAYMENT_REVERSED", from: ["PAID"], to: "AWAITING_PAYMENT", actors: ["SYSTEM_VERIFIER"], guards: [notFullyPaid] },
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
  // The provider reversed the payment before the transfer completed: back to waiting, nothing moved.
  { event: "PAYMENT_REVERSED", from: ["PAID"], to: "AWAITING_PAYMENT", actors: ["SYSTEM_VERIFIER"], guards: [notFullyPaid] },
  {
    event: "COMPLETE",
    from: ["PAID"],
    to: "COMPLETED",
    actors: ["HUB_MANAGER", "FIELD_CHAMPION", "SYSTEM_VERIFIER"],
    guards: [fullyPaid, ...bothConfirmed],
  },
]);

/**
 * Sale to a customer (handbook §8 D/E): voluntary installments, one open
 * intent, a handover code. `seller` is who holds the stock and meets the
 * customer — a champion on the ladder, a rider on a village drop, a supplier
 * at the factory gate.
 */
function planMachine(kind: OrderKind, seller: ActorKind): OrderMachine {
  const rows: Rows = [
    { event: "INSTALLMENT_CONFIRMED", from: ["PLAN_ACTIVE"], to: "PLAN_ACTIVE", actors: ["SYSTEM_VERIFIER"], guards: [notFullyPaid] },
    { event: "PAYMENT_CONFIRMED", from: ["PLAN_ACTIVE"], to: "FULLY_PAID", actors: ["SYSTEM_VERIFIER"], guards: [fullyPaid] },
    // A reversed payment reopens the plan (and cancels a pending handover) as long as the product has not been handed over.
    { event: "PAYMENT_REVERSED", from: ["FULLY_PAID", "HANDOVER_PENDING"], to: "PLAN_ACTIVE", actors: ["SYSTEM_VERIFIER"], guards: [notFullyPaid] },
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
      actors: [seller],
      guards: [fullyPaid, requireTrue((c) => c.stockReserved, "no_stock_reserved")],
    },
    { event: "CANCEL_HANDOVER", from: ["HANDOVER_PENDING"], to: "FULLY_PAID", actors: [seller, "SUPER_ADMIN"] },
    {
      event: "COMPLETE",
      from: ["HANDOVER_PENDING"],
      to: "COMPLETED",
      actors: [seller],
      guards: [
        fullyPaid,
        requireTrue((c) => c.customerCodeValid, "customer_code_invalid"),
        requireTrue((c) => c.educationConfirmed, "education_not_confirmed"),
      ],
    },
    { event: "CLOSE_PLAN", from: ["PLAN_ACTIVE"], to: "CLOSED", actors: [seller, "SUPER_ADMIN"], guards: [noPayment] },
    // A shop order not handed over in time passes to the next seller (Prompt M §3.1); her payment follows it.
    { event: "REASSIGN", from: ["FULLY_PAID", "HANDOVER_PENDING"], to: "CANCELLED", actors: ["SYSTEM"] },
    // The payment she made on the order that passed on, carried to this one.
    {
      event: "PAYMENT_CARRIED",
      from: ["PLAN_ACTIVE"],
      to: { oneOf: ["PLAN_ACTIVE", "FULLY_PAID"], pick: (c) => (c.fullyPaid ? "FULLY_PAID" : "PLAN_ACTIVE") },
      actors: ["SYSTEM"],
    },
  ];
  return defineMachine<OrderState, OrderEvent, OrderCtx>(`order:${kind}`, ORDER_STATES, rows);
}

export const championToCustomerMachine = planMachine("CHAMPION_TO_CUSTOMER", "FIELD_CHAMPION");
export const riderToCustomerMachine = planMachine("RIDER_TO_CUSTOMER", "BOSS_RIDER");
export const supplierToCustomerMachine = planMachine("SUPPLIER_TO_CUSTOMER", "SUPPLIER");

/**
 * Bulk sale to an organisation (prompt §8.8.4): one exact payment, then the
 * seller delivers and confirms; the organisation has no login, so its side
 * is the SMS receipt and the public verify link. No stock is reserved while
 * the money is pending; delivery takes the units from the seller's lot.
 */
function orgSaleMachine(kind: OrderKind, seller: ActorKind): OrderMachine {
  return defineMachine<OrderState, OrderEvent, OrderCtx>(`order:${kind}`, ORDER_STATES, [
    { event: "PAYMENT_CONFIRMED", from: ["AWAITING_PAYMENT"], to: "PAID", actors: ["SYSTEM_VERIFIER"], guards: [fullyPaid] },
    { event: "PAYMENT_REVERSED", from: ["PAID"], to: "AWAITING_PAYMENT", actors: ["SYSTEM_VERIFIER"], guards: [notFullyPaid] },
    {
      event: "COMPLETE",
      from: ["PAID"],
      to: "COMPLETED",
      actors: [seller],
      guards: [fullyPaid, requireTrue((c) => c.senderConfirmed, "sender_not_confirmed"), requireTrue((c) => c.stockAvailable, "insufficient_stock")],
    },
    { event: "CANCEL", from: ["AWAITING_PAYMENT"], to: "CANCELLED", actors: [seller, "SUPER_ADMIN"], guards: [noPayment] },
  ]);
}

export const supplierToOrgMachine = orgSaleMachine("SUPPLIER_TO_ORG", "SUPPLIER");
export const hubToOrgMachine = orgSaleMachine("HUB_TO_ORG", "HUB_MANAGER");
export const riderToOrgMachine = orgSaleMachine("RIDER_TO_ORG", "BOSS_RIDER");

export const ORDER_MACHINES: Record<OrderKind, OrderMachine> = {
  SUPPLIER_TO_RIDER: supplierToRiderMachine,
  RIDER_TO_HUB: riderToHubMachine,
  HUB_TO_CHAMPION: hubToChampionMachine,
  CHAMPION_TO_CUSTOMER: championToCustomerMachine,
  RIDER_TO_CUSTOMER: riderToCustomerMachine,
  SUPPLIER_TO_CUSTOMER: supplierToCustomerMachine,
  SUPPLIER_TO_HUB: supplierToHubMachine,
  SUPPLIER_TO_CHAMPION: supplierToChampionMachine,
  SUPPLIER_TO_ORG: supplierToOrgMachine,
  HUB_TO_ORG: hubToOrgMachine,
  RIDER_TO_ORG: riderToOrgMachine,
};

export const INITIAL_ORDER_STATE: Record<OrderKind, OrderState> = {
  SUPPLIER_TO_RIDER: "PICKUP_ASSIGNED",
  RIDER_TO_HUB: "EN_ROUTE",
  HUB_TO_CHAMPION: "REQUESTED",
  CHAMPION_TO_CUSTOMER: "PLAN_ACTIVE",
  RIDER_TO_CUSTOMER: "PLAN_ACTIVE",
  SUPPLIER_TO_CUSTOMER: "PLAN_ACTIVE",
  SUPPLIER_TO_HUB: "PICKUP_ASSIGNED",
  SUPPLIER_TO_CHAMPION: "PICKUP_ASSIGNED",
  SUPPLIER_TO_ORG: "AWAITING_PAYMENT",
  HUB_TO_ORG: "AWAITING_PAYMENT",
  RIDER_TO_ORG: "AWAITING_PAYMENT",
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
  return isPlanKind(kind) ? "UP_TO_REMAINING" : "EXACT_REMAINING";
}
