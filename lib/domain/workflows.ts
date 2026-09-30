/**
 * Role workflows (handbook §8 A–D) as ordered decision tables.
 *
 * Given a role-scoped snapshot of the user's orders, each table picks the
 * ONE current status and ONE next action (the One Screen Rule, §7). Rows
 * are evaluated top to bottom; the first match wins. The UI only renders
 * the result — it never computes workflow state itself.
 */
import type { CustodyState, FieldRole, OrderKind, OrderState, PaymentStatus } from "./types";
import { isLocked } from "./custody";

export interface OrderSnapshot {
  id: string;
  ref: string;
  verifyRef: string;
  kind: OrderKind;
  state: OrderState;
  /** Which side of this order the viewing user is on. */
  side: "seller" | "buyer";
  totalTzs: number;
  confirmedPaidTzs: number;
  donorFundedTzs: number;
  /** Status of the most recent payment intent, if any. */
  latestPaymentStatus: PaymentStatus | null;
  /** The payer said "I have paid" on the open intent. */
  paymentClaimed: boolean;
  batchState: CustodyState | null;
  senderConfirmed: boolean;
  receiverConfirmed: boolean;
  /** For customer orders: days since the last confirmed payment (or since plan start). */
  daysSinceLastPayment?: number;
  updatedAt: Date;
}

export interface RoleExtras {
  /** Hub stock below the configured minimum. */
  lowStock?: boolean;
  /** Champion has enrolled customers without an active plan. */
  customersWithoutPlan?: number;
  /** Champion's units on hand, by product id. */
  championStockUnits?: number;
}

export type ActionKey =
  | "view_upcoming"
  | "confirm_batch_ready"
  | "view_payment_status"
  | "refresh_payment"
  | "confirm_release"
  | "confirm_receipt"
  | "view_completed"
  | "report_problem"
  | "refresh"
  | "accept_pickup"
  | "i_have_paid"
  | "open_delivery_code"
  | "refresh_delivery"
  | "confirm_handover_to_hub"
  | "view_inventory"
  | "start_inspection"
  | "inspect_stock"
  | "prepare_transfer"
  | "request_restock"
  | "add_customer"
  | "start_plan"
  | "record_payment"
  | "complete_handover"
  | "confirm_customer_handover"
  | "request_stock"
  | "contact_or_close"
  | "view_customers"
  | "deliver_org";

export interface WorkflowRow {
  status: string;
  match: (o: OrderSnapshot) => boolean;
  action: ActionKey;
}

export interface HomeView {
  status: string;
  action: ActionKey;
  order: OrderSnapshot | null;
}

const active = (o: OrderSnapshot) => !["COMPLETED", "CANCELLED", "CLOSED"].includes(o.state);
const locked = (o: OrderSnapshot) => active(o) && o.batchState !== null && isLocked(o.batchState);
const k = (kind: OrderKind, side: "seller" | "buyer") => (o: OrderSnapshot) => o.kind === kind && o.side === side;
const recentlyDone = (o: OrderSnapshot) => o.state === "COMPLETED";

/** One of several kinds, on one side. */
const kk = (kinds: readonly OrderKind[], side: "seller" | "buyer") => (o: OrderSnapshot) => kinds.includes(o.kind) && o.side === side;
/** Supplier selling a batch to whoever collects at the factory (ladder rider, or a hub / champion at the factory gate). */
const supplierPickupRows = (kinds: readonly OrderKind[]): WorkflowRow[] => [
  { status: "problem_reported", match: (o) => kk(kinds, "seller")(o) && locked(o), action: "report_problem" },
  { status: "payment_confirmed", match: (o) => kk(kinds, "seller")(o) && o.state === "PAID" && !o.senderConfirmed, action: "confirm_release" },
  { status: "pickup_assigned", match: (o) => kk(kinds, "seller")(o) && o.state === "PICKUP_ASSIGNED", action: "confirm_batch_ready" },
  { status: "payment_pending", match: (o) => kk(kinds, "seller")(o) && o.state === "AWAITING_PAYMENT" && o.paymentClaimed, action: "refresh_payment" },
  { status: "batch_ready", match: (o) => kk(kinds, "seller")(o) && (o.state === "BATCH_READY" || o.state === "AWAITING_PAYMENT"), action: "view_payment_status" },
  { status: "waiting_rider_pickup", match: (o) => kk(kinds, "seller")(o) && o.state === "PAID", action: "refresh" },
  { status: "pickup_complete", match: (o) => kk(kinds, "seller")(o) && recentlyDone(o), action: "view_completed" },
];
/** Collecting a batch at the factory, on the buyer's side. */
const factoryBuyerRows = (kind: OrderKind): WorkflowRow[] => [
  { status: "delivery_problem", match: (o) => k(kind, "buyer")(o) && locked(o), action: "report_problem" },
  { status: "payment_confirmed", match: (o) => k(kind, "buyer")(o) && o.state === "PAID" && !o.receiverConfirmed, action: "confirm_receipt" },
  { status: "pickup_available", match: (o) => k(kind, "buyer")(o) && o.state === "BATCH_READY", action: "accept_pickup" },
  { status: "payment_pending", match: (o) => k(kind, "buyer")(o) && o.state === "AWAITING_PAYMENT" && o.paymentClaimed, action: "refresh_payment" },
  { status: "awaiting_payment", match: (o) => k(kind, "buyer")(o) && o.state === "AWAITING_PAYMENT", action: "i_have_paid" },
  { status: "waiting_supplier_release", match: (o) => k(kind, "buyer")(o) && o.state === "PAID", action: "refresh" },
  { status: "pickup_complete", match: (o) => k(kind, "buyer")(o) && recentlyDone(o), action: "view_completed" },
];
/** Selling to a customer with installments and a handover code (the champion's rows, for whoever sells directly). */
const planRows = (kind: OrderKind): WorkflowRow[] => [
  { status: "handover_required", match: (o) => k(kind, "seller")(o) && o.state === "HANDOVER_PENDING", action: "confirm_customer_handover" },
  { status: "full_payment_complete", match: (o) => k(kind, "seller")(o) && o.state === "FULLY_PAID", action: "complete_handover" },
  { status: "payment_pending", match: (o) => k(kind, "seller")(o) && o.state === "PLAN_ACTIVE" && o.latestPaymentStatus === "PAYMENT_PENDING" && o.paymentClaimed, action: "refresh_payment" },
  { status: "customer_paused", match: (o) => k(kind, "seller")(o) && o.state === "PLAN_ACTIVE" && (o.daysSinceLastPayment ?? 0) >= 14, action: "contact_or_close" },
  { status: "installment_active", match: (o) => k(kind, "seller")(o) && o.state === "PLAN_ACTIVE", action: "record_payment" },
  { status: "handover_complete", match: (o) => k(kind, "seller")(o) && recentlyDone(o), action: "view_customers" },
];
/** Selling in bulk to an organisation (prompt §8.8.4): paid first, then delivered by the seller. */
const orgRows = (kind: OrderKind): WorkflowRow[] => [
  { status: "org_paid", match: (o) => k(kind, "seller")(o) && o.state === "PAID", action: "deliver_org" },
  { status: "org_awaiting_payment", match: (o) => k(kind, "seller")(o) && o.state === "AWAITING_PAYMENT", action: "refresh_payment" },
  { status: "org_delivered", match: (o) => k(kind, "seller")(o) && recentlyDone(o), action: "view_completed" },
];

export const SUPPLIER_WORKFLOW: WorkflowRow[] = [
  ...supplierPickupRows(["SUPPLIER_TO_RIDER", "SUPPLIER_TO_HUB", "SUPPLIER_TO_CHAMPION"]),
  ...planRows("SUPPLIER_TO_CUSTOMER"),
  ...orgRows("SUPPLIER_TO_ORG"),
];

export const RIDER_WORKFLOW: WorkflowRow[] = [
  { status: "delivery_problem", match: (o) => (k("SUPPLIER_TO_RIDER", "buyer")(o) || k("RIDER_TO_HUB", "seller")(o)) && locked(o), action: "report_problem" },
  { status: "payment_confirmed", match: (o) => k("SUPPLIER_TO_RIDER", "buyer")(o) && o.state === "PAID" && !o.receiverConfirmed, action: "confirm_receipt" },
  { status: "pickup_available", match: (o) => k("SUPPLIER_TO_RIDER", "buyer")(o) && o.state === "BATCH_READY", action: "accept_pickup" },
  { status: "payment_pending", match: (o) => k("SUPPLIER_TO_RIDER", "buyer")(o) && o.state === "AWAITING_PAYMENT" && o.paymentClaimed, action: "refresh_payment" },
  { status: "awaiting_payment", match: (o) => k("SUPPLIER_TO_RIDER", "buyer")(o) && o.state === "AWAITING_PAYMENT", action: "i_have_paid" },
  { status: "waiting_supplier_release", match: (o) => k("SUPPLIER_TO_RIDER", "buyer")(o) && o.state === "PAID", action: "refresh" },
  ...planRows("RIDER_TO_CUSTOMER"),
  ...orgRows("RIDER_TO_ORG"),
  { status: "hub_accepted", match: (o) => k("RIDER_TO_HUB", "seller")(o) && (o.state === "AWAITING_PAYMENT" || o.state === "PAID") && !o.senderConfirmed, action: "confirm_handover_to_hub" },
  { status: "in_transit", match: (o) => k("RIDER_TO_HUB", "seller")(o) && o.state === "EN_ROUTE", action: "open_delivery_code" },
  { status: "hub_inspection_pending", match: (o) => k("RIDER_TO_HUB", "seller")(o) && o.state === "INSPECTING", action: "refresh_delivery" },
  { status: "hub_payment_pending", match: (o) => k("RIDER_TO_HUB", "seller")(o) && (o.state === "AWAITING_PAYMENT" || o.state === "PAID"), action: "refresh_payment" },
  { status: "hub_payment_confirmed", match: (o) => k("RIDER_TO_HUB", "seller")(o) && recentlyDone(o), action: "view_completed" },
  { status: "pickup_complete", match: (o) => k("SUPPLIER_TO_RIDER", "buyer")(o) && recentlyDone(o), action: "view_completed" },
];

export const HUB_WORKFLOW: WorkflowRow[] = [
  { status: "problem_reported", match: (o) => (k("RIDER_TO_HUB", "buyer")(o) || k("HUB_TO_CHAMPION", "seller")(o)) && locked(o), action: "report_problem" },
  { status: "inspection_required", match: (o) => k("RIDER_TO_HUB", "buyer")(o) && o.state === "INSPECTING", action: "inspect_stock" },
  { status: "rider_arriving", match: (o) => k("RIDER_TO_HUB", "buyer")(o) && o.state === "EN_ROUTE", action: "start_inspection" },
  { status: "rider_payment_pending", match: (o) => k("RIDER_TO_HUB", "buyer")(o) && o.state === "AWAITING_PAYMENT" && o.paymentClaimed, action: "refresh_payment" },
  { status: "stock_accepted", match: (o) => k("RIDER_TO_HUB", "buyer")(o) && o.state === "AWAITING_PAYMENT", action: "i_have_paid" },
  { status: "waiting_rider_handover", match: (o) => k("RIDER_TO_HUB", "buyer")(o) && o.state === "PAID", action: "refresh" },
  { status: "champion_payment_confirmed", match: (o) => k("HUB_TO_CHAMPION", "seller")(o) && o.state === "PAID" && !o.senderConfirmed, action: "confirm_release" },
  { status: "champion_request", match: (o) => k("HUB_TO_CHAMPION", "seller")(o) && o.state === "REQUESTED", action: "prepare_transfer" },
  { status: "champion_payment_pending", match: (o) => k("HUB_TO_CHAMPION", "seller")(o) && (o.state === "AWAITING_PAYMENT" || o.state === "PAID"), action: "refresh_payment" },
  ...factoryBuyerRows("SUPPLIER_TO_HUB"),
  ...orgRows("HUB_TO_ORG"),
  { status: "stock_recorded", match: (o) => k("RIDER_TO_HUB", "buyer")(o) && recentlyDone(o), action: "view_inventory" },
];

export const CHAMPION_WORKFLOW: WorkflowRow[] = [
  { status: "stock_problem", match: (o) => k("HUB_TO_CHAMPION", "buyer")(o) && locked(o), action: "report_problem" },
  { status: "handover_required", match: (o) => k("CHAMPION_TO_CUSTOMER", "seller")(o) && o.state === "HANDOVER_PENDING", action: "confirm_customer_handover" },
  { status: "full_payment_complete", match: (o) => k("CHAMPION_TO_CUSTOMER", "seller")(o) && o.state === "FULLY_PAID", action: "complete_handover" },
  { status: "stock_payment_confirmed", match: (o) => k("HUB_TO_CHAMPION", "buyer")(o) && o.state === "PAID" && !o.receiverConfirmed, action: "confirm_receipt" },
  { status: "stock_payment_pending", match: (o) => k("HUB_TO_CHAMPION", "buyer")(o) && o.state === "AWAITING_PAYMENT" && o.paymentClaimed, action: "refresh_payment" },
  { status: "stock_awaiting_payment", match: (o) => k("HUB_TO_CHAMPION", "buyer")(o) && o.state === "AWAITING_PAYMENT", action: "i_have_paid" },
  {
    status: "payment_pending",
    match: (o) => k("CHAMPION_TO_CUSTOMER", "seller")(o) && o.state === "PLAN_ACTIVE" && o.latestPaymentStatus === "PAYMENT_PENDING" && o.paymentClaimed,
    action: "refresh_payment",
  },
  {
    status: "customer_paused",
    match: (o) => k("CHAMPION_TO_CUSTOMER", "seller")(o) && o.state === "PLAN_ACTIVE" && (o.daysSinceLastPayment ?? 0) >= 14,
    action: "contact_or_close",
  },
  { status: "installment_active", match: (o) => k("CHAMPION_TO_CUSTOMER", "seller")(o) && o.state === "PLAN_ACTIVE", action: "record_payment" },
  { status: "stock_requested", match: (o) => k("HUB_TO_CHAMPION", "buyer")(o) && o.state === "REQUESTED", action: "refresh" },
  ...factoryBuyerRows("SUPPLIER_TO_CHAMPION"),
  { status: "handover_complete", match: (o) => k("CHAMPION_TO_CUSTOMER", "seller")(o) && recentlyDone(o), action: "view_customers" },
];

export const WORKFLOWS: Record<FieldRole, WorkflowRow[]> = {
  SUPPLIER: SUPPLIER_WORKFLOW,
  BOSS_RIDER: RIDER_WORKFLOW,
  HUB_MANAGER: HUB_WORKFLOW,
  FIELD_CHAMPION: CHAMPION_WORKFLOW,
};

const IDLE: Record<FieldRole, HomeView> = {
  SUPPLIER: { status: "no_pickup", action: "view_upcoming", order: null },
  BOSS_RIDER: { status: "no_assignment", action: "refresh", order: null },
  HUB_MANAGER: { status: "no_delivery", action: "view_inventory", order: null },
  FIELD_CHAMPION: { status: "no_active_customer", action: "add_customer", order: null },
};

/**
 * Pick the single current status and next action for a field role.
 * Completed orders only count if nothing else is active ("recent" filtering
 * is done by the caller's query window).
 */
export function homeView(role: FieldRole, orders: readonly OrderSnapshot[], extras: RoleExtras = {}): HomeView {
  const rows = WORKFLOWS[role];
  const sorted = [...orders].sort((a, b) => a.updatedAt.getTime() - b.updatedAt.getTime());
  const activeOrders = sorted.filter(active);
  // Actionable rows over active orders first (oldest first), then completions.
  for (const row of rows) {
    const hit = activeOrders.find(row.match);
    if (hit) {
      // A champion with a fully paid customer but no stock must request stock first.
      if (role === "FIELD_CHAMPION" && row.action === "complete_handover" && (extras.championStockUnits ?? 0) < 1) {
        return { status: "full_payment_no_stock", action: "request_stock", order: hit };
      }
      return { status: row.status, action: row.action, order: hit };
    }
  }
  if (role === "HUB_MANAGER" && extras.lowStock) return { status: "low_stock", action: "request_restock", order: null };
  if (role === "FIELD_CHAMPION" && (extras.customersWithoutPlan ?? 0) > 0) {
    return { status: "customer_enrolled", action: "start_plan", order: null };
  }
  const done = [...sorted].reverse().find((o) => rows.some((r) => r.match(o)));
  if (done) {
    const row = rows.find((r) => r.match(done))!;
    return { status: row.status, action: row.action, order: done };
  }
  return IDLE[role];
}
