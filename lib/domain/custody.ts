/**
 * Custody state machine for batches (handbook §10), encoding invariants
 * §3.3 (no release without full payment, dual confirmation) and §3.4
 * (locked batches stay locked until a dual-approved resolution).
 */
import { defineMachine, requireTrue, type Guard } from "./machine";
import { isDualApproved, type DualApprovalProof } from "./approval";
import { CUSTODY_STATES, LOCKED_CUSTODY_STATES, type CustodyState, type ActorKind } from "./types";

export type CustodyEvent =
  | "RESERVE_FOR_RIDER"
  | "PAYMENT_CLAIMED"
  | "PAYMENT_CONFIRMED"
  | "PAYMENT_FAILED"
  | "PICKUP"
  | "START_TRANSIT"
  | "START_INSPECTION"
  | "INSPECTION_FAILED"
  | "HUB_ACCEPT"
  | "MAKE_AVAILABLE"
  | "CHAMPION_HANDOVER"
  | "CANCEL_CHAMPION_RESERVATION"
  | "CUSTOMER_HANDOVER"
  | "CANCEL_CUSTOMER_RESERVATION"
  | "QUARANTINE"
  | "RESOLVE_RESUME"
  | "RESOLVE_RETURN";

export interface CustodyCtx {
  /** Confirmed payments (plus approved donor funding for customer orders) equal the full price. */
  orderFullyPaid?: boolean;
  /** At least one confirmed payment exists for the order. */
  orderHasConfirmedPayment?: boolean;
  senderConfirmed?: boolean;
  receiverConfirmed?: boolean;
  inspectionPassed?: boolean;
  deliveryCodeValid?: boolean;
  customerCodeValid?: boolean;
  educationConfirmed?: boolean;
  /** For RESOLVE_*: proof that a dual approval exists. */
  approval?: DualApprovalProof;
  /** For RESOLVE_RESUME: the state the batch was in when it was locked. */
  lockedFromState?: CustodyState;
}

const fullyPaid = requireTrue<CustodyCtx>((c) => c.orderFullyPaid, "full_payment_not_confirmed");
const sender = requireTrue<CustodyCtx>((c) => c.senderConfirmed, "sender_not_confirmed");
const receiver = requireTrue<CustodyCtx>((c) => c.receiverConfirmed, "receiver_not_confirmed");
const noPayment: Guard<CustodyCtx> = (c) => (c.orderHasConfirmedPayment ? "has_confirmed_payment" : null);
const dualApproved: Guard<CustodyCtx> = (c) => (isDualApproved(c.approval) ? null : "dual_approval_required");

const ALL_FIELD: readonly ActorKind[] = ["SUPPLIER", "BOSS_RIDER", "HUB_MANAGER", "FIELD_CHAMPION", "SUPER_ADMIN"];

/** States from which a locked batch may be resumed after a dual-approved resolution. */
export const RESUMABLE_STATES = [
  "AVAILABLE_AT_SUPPLIER",
  "READY_FOR_PICKUP",
  "IN_TRANSIT",
  "AT_HUB_INSPECTION",
  "AVAILABLE_AT_HUB",
  "WITH_CHAMPION",
] as const satisfies readonly CustodyState[];

const UNLOCKED_ACTIVE: readonly CustodyState[] = [
  "AVAILABLE_AT_SUPPLIER",
  "RESERVED_FOR_RIDER",
  "PAYMENT_PENDING",
  "READY_FOR_PICKUP",
  "PICKED_UP",
  "IN_TRANSIT",
  "AT_HUB_INSPECTION",
  "ACCEPTED_AT_HUB",
  "AVAILABLE_AT_HUB",
  "RESERVED_FOR_CHAMPION",
  "WITH_CHAMPION",
  "RESERVED_FOR_CUSTOMER",
];

function resumeTarget(c: CustodyCtx, from: CustodyState): CustodyState {
  // After an inspection issue the resumed step is always a fresh inspection.
  if (from === "INSPECTION_ISSUE") return "AT_HUB_INSPECTION";
  const prev = c.lockedFromState;
  if (!prev) return from; // will fail the oneOf check
  // Reservations and in-flight payments resume to the stable state before them.
  const map: Partial<Record<CustodyState, CustodyState>> = {
    RESERVED_FOR_RIDER: "AVAILABLE_AT_SUPPLIER",
    PAYMENT_PENDING: "AVAILABLE_AT_SUPPLIER",
    PICKED_UP: "IN_TRANSIT",
    ACCEPTED_AT_HUB: "AVAILABLE_AT_HUB",
    RESERVED_FOR_CHAMPION: "AVAILABLE_AT_HUB",
    RESERVED_FOR_CUSTOMER: "WITH_CHAMPION",
  };
  return map[prev] ?? prev;
}

export const custodyMachine = defineMachine<CustodyState, CustodyEvent, CustodyCtx>("custody", CUSTODY_STATES, [
  { event: "RESERVE_FOR_RIDER", from: ["AVAILABLE_AT_SUPPLIER"], to: "RESERVED_FOR_RIDER", actors: ["BOSS_RIDER"] },
  { event: "PAYMENT_CLAIMED", from: ["RESERVED_FOR_RIDER"], to: "PAYMENT_PENDING", actors: ["BOSS_RIDER"] },
  {
    event: "PAYMENT_CONFIRMED",
    from: ["RESERVED_FOR_RIDER", "PAYMENT_PENDING"],
    to: "READY_FOR_PICKUP",
    actors: ["SYSTEM_VERIFIER"],
    guards: [fullyPaid],
  },
  { event: "PAYMENT_FAILED", from: ["PAYMENT_PENDING"], to: "RESERVED_FOR_RIDER", actors: ["SYSTEM_VERIFIER"] },
  {
    event: "PICKUP",
    from: ["READY_FOR_PICKUP"],
    to: "PICKED_UP",
    actors: ["SUPPLIER", "BOSS_RIDER", "SYSTEM_VERIFIER"],
    guards: [fullyPaid, sender, receiver],
  },
  { event: "START_TRANSIT", from: ["PICKED_UP"], to: "IN_TRANSIT", actors: ["BOSS_RIDER", "SYSTEM"] },
  {
    event: "START_INSPECTION",
    from: ["IN_TRANSIT"],
    to: "AT_HUB_INSPECTION",
    actors: ["HUB_MANAGER"],
    guards: [requireTrue((c) => c.deliveryCodeValid, "delivery_code_invalid")],
  },
  { event: "INSPECTION_FAILED", from: ["AT_HUB_INSPECTION"], to: "INSPECTION_ISSUE", actors: ["HUB_MANAGER"] },
  {
    event: "HUB_ACCEPT",
    from: ["AT_HUB_INSPECTION"],
    to: "ACCEPTED_AT_HUB",
    actors: ["HUB_MANAGER", "BOSS_RIDER", "SYSTEM_VERIFIER"],
    guards: [requireTrue((c) => c.inspectionPassed, "inspection_not_passed"), fullyPaid, sender, receiver],
  },
  { event: "MAKE_AVAILABLE", from: ["ACCEPTED_AT_HUB"], to: "AVAILABLE_AT_HUB", actors: ["SYSTEM", "HUB_MANAGER", "BOSS_RIDER", "SYSTEM_VERIFIER"] },
  {
    event: "CHAMPION_HANDOVER",
    from: ["RESERVED_FOR_CHAMPION"],
    to: "WITH_CHAMPION",
    actors: ["HUB_MANAGER", "FIELD_CHAMPION", "SYSTEM_VERIFIER"],
    guards: [fullyPaid, sender, receiver],
  },
  {
    event: "CANCEL_CHAMPION_RESERVATION",
    from: ["RESERVED_FOR_CHAMPION"],
    to: "RETURNED",
    actors: ["HUB_MANAGER", "FIELD_CHAMPION", "SUPER_ADMIN"],
    guards: [noPayment],
  },
  {
    event: "CUSTOMER_HANDOVER",
    from: ["RESERVED_FOR_CUSTOMER"],
    to: "HANDED_TO_CUSTOMER",
    actors: ["FIELD_CHAMPION"],
    guards: [
      fullyPaid,
      sender,
      requireTrue((c) => c.customerCodeValid, "customer_code_invalid"),
      requireTrue((c) => c.educationConfirmed, "education_not_confirmed"),
    ],
  },
  { event: "CANCEL_CUSTOMER_RESERVATION", from: ["RESERVED_FOR_CUSTOMER"], to: "RETURNED", actors: ["FIELD_CHAMPION", "SUPER_ADMIN"] },
  { event: "QUARANTINE", from: UNLOCKED_ACTIVE, to: "DAMAGED_OR_QUARANTINED", actors: ALL_FIELD },
  {
    event: "RESOLVE_RESUME",
    from: [...LOCKED_CUSTODY_STATES],
    to: { oneOf: RESUMABLE_STATES, pick: resumeTarget },
    actors: ["SYSTEM_APPROVALS"],
    guards: [dualApproved],
  },
  {
    event: "RESOLVE_RETURN",
    from: [...LOCKED_CUSTODY_STATES],
    to: "RETURNED",
    actors: ["SYSTEM_APPROVALS"],
    guards: [dualApproved],
  },
]);

export function isLocked(state: CustodyState): boolean {
  return (LOCKED_CUSTODY_STATES as readonly string[]).includes(state);
}

/** States a brand-new batch row may start in, and the parent state each split requires. */
export const INITIAL_CUSTODY_STATES = {
  REGISTER: "AVAILABLE_AT_SUPPLIER",
  SPLIT_FOR_CHAMPION: "RESERVED_FOR_CHAMPION",
  SPLIT_FOR_CUSTOMER: "RESERVED_FOR_CUSTOMER",
} as const satisfies Record<string, CustodyState>;

export const SPLIT_PARENT_STATE: Record<"SPLIT_FOR_CHAMPION" | "SPLIT_FOR_CUSTOMER", CustodyState> = {
  SPLIT_FOR_CHAMPION: "AVAILABLE_AT_HUB",
  SPLIT_FOR_CUSTOMER: "WITH_CHAMPION",
};

/** A split may only take units from an unlocked parent in the right state with enough quantity. */
export function canSplit(
  kind: "SPLIT_FOR_CHAMPION" | "SPLIT_FOR_CUSTOMER",
  parent: { state: CustodyState; quantity: number },
  qty: number,
): string | null {
  if (isLocked(parent.state)) return "batch_locked";
  if (parent.state !== SPLIT_PARENT_STATE[kind]) return "parent_wrong_state";
  if (!Number.isSafeInteger(qty) || qty <= 0) return "invalid_quantity";
  if (qty > parent.quantity) return "insufficient_stock";
  return null;
}

/** Custody transitions that move stock to a new custodian (ledger: CUSTODY_TRANSFERRED). */
export const CUSTODY_TRANSFER_EVENTS: readonly CustodyEvent[] = ["PICKUP", "HUB_ACCEPT", "CHAMPION_HANDOVER"];
