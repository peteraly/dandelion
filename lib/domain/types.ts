/**
 * Shared domain vocabulary. These arrays are the single source of truth for
 * the Postgres enums in lib/db/schema.ts.
 */

export const LOGIN_ROLES = ["SUPER_ADMIN", "SUPPLIER", "BOSS_RIDER", "HUB_MANAGER", "FIELD_CHAMPION"] as const;
export type Role = (typeof LOGIN_ROLES)[number];
export const FIELD_ROLES = ["SUPPLIER", "BOSS_RIDER", "HUB_MANAGER", "FIELD_CHAMPION"] as const satisfies readonly Role[];
export type FieldRole = (typeof FIELD_ROLES)[number];

/** Non-human actors. Only these can perform certain transitions. */
export const SYSTEM_ACTORS = ["SYSTEM_VERIFIER", "SYSTEM_APPROVALS", "SYSTEM"] as const;
export type SystemActor = (typeof SYSTEM_ACTORS)[number];
export type ActorKind = Role | SystemActor;

/** Handbook §10 custody states. */
export const CUSTODY_STATES = [
  "AVAILABLE_AT_SUPPLIER",
  /** A rider's own stock for direct distribution (village drops, organisation sales) — prompt §8.8. */
  "WITH_RIDER",
  /** Sold to an organisation (NGO, school …); nothing is tracked past this. */
  "DELIVERED_TO_ORG",
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
  "HANDED_TO_CUSTOMER",
  "INSPECTION_ISSUE",
  "DAMAGED_OR_QUARANTINED",
  "RETURNED",
] as const;
export type CustodyState = (typeof CUSTODY_STATES)[number];

export const LOCKED_CUSTODY_STATES = ["INSPECTION_ISSUE", "DAMAGED_OR_QUARANTINED"] as const satisfies readonly CustodyState[];

/** Handbook §9: exactly three payment statuses. */
export const PAYMENT_STATUSES = ["PAYMENT_PENDING", "PAYMENT_CONFIRMED", "PAYMENT_FAILED_OR_REVIEW"] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

/**
 * Order kinds: the handbook's ladder (first four) plus the direct paths of
 * prompt §8.8 — village drops, factory-gate sales and organisation buyers.
 * Which paths an area allows is a per-area, dual-approved setting (lib/domain/sales.ts).
 */
export const ORDER_KINDS = [
  "SUPPLIER_TO_RIDER",
  "RIDER_TO_HUB",
  "HUB_TO_CHAMPION",
  "CHAMPION_TO_CUSTOMER",
  "RIDER_TO_CUSTOMER",
  "SUPPLIER_TO_CUSTOMER",
  "SUPPLIER_TO_HUB",
  "SUPPLIER_TO_CHAMPION",
  "SUPPLIER_TO_ORG",
  "HUB_TO_ORG",
  "RIDER_TO_ORG",
] as const;
export type OrderKind = (typeof ORDER_KINDS)[number];

export const ORDER_STATES = [
  "PICKUP_ASSIGNED",
  "BATCH_READY",
  "EN_ROUTE",
  "INSPECTING",
  "REQUESTED",
  "PLAN_ACTIVE",
  "AWAITING_PAYMENT",
  "PAID",
  "FULLY_PAID",
  "HANDOVER_PENDING",
  "ON_HOLD",
  "COMPLETED",
  "CANCELLED",
  "CLOSED",
] as const;
export type OrderState = (typeof ORDER_STATES)[number];

export const PAYMENT_PURPOSES = ["SUPPLIER_SALE", "HUB_SALE", "CHAMPION_SALE", "CUSTOMER_SALE", "ORGANISATION_SALE"] as const;
export type PaymentPurpose = (typeof PAYMENT_PURPOSES)[number];

export const PURPOSE_BY_ORDER_KIND: Record<OrderKind, PaymentPurpose> = {
  SUPPLIER_TO_RIDER: "SUPPLIER_SALE",
  RIDER_TO_HUB: "HUB_SALE",
  HUB_TO_CHAMPION: "CHAMPION_SALE",
  CHAMPION_TO_CUSTOMER: "CUSTOMER_SALE",
  RIDER_TO_CUSTOMER: "CUSTOMER_SALE",
  SUPPLIER_TO_CUSTOMER: "CUSTOMER_SALE",
  SUPPLIER_TO_HUB: "SUPPLIER_SALE",
  SUPPLIER_TO_CHAMPION: "SUPPLIER_SALE",
  SUPPLIER_TO_ORG: "ORGANISATION_SALE",
  HUB_TO_ORG: "ORGANISATION_SALE",
  RIDER_TO_ORG: "ORGANISATION_SALE",
};

/** Buyer organisations (prompt §8.8.4): a record, not a login. */
/** Buyer organisations (prompt §8.8.4); pharmacies and businesses (often women-owned) since the founders' decision of 2026-10-01. */
export const ORGANISATION_KINDS = ["NGO", "NON_PROFIT", "SCHOOL", "COMMUNITY", "OTHER", "PHARMACY", "BUSINESS"] as const;
export type OrganisationKind = (typeof ORGANISATION_KINDS)[number];

/** Handbook §12 problem list (plus WASH concern from §11). */
export const EXCEPTION_TYPES = [
  "PAYMENT_PENDING_TOO_LONG",
  "PAYMENT_REVERSED",
  "WRONG_AMOUNT",
  "OVERPAYMENT",
  "PAYEE_MISMATCH",
  "UNMATCHED_PAYMENT",
  "STOCK_SHORT",
  "DAMAGED_OR_WET",
  "SEAL_BROKEN",
  "WRONG_HUB",
  "PHONE_LOST",
  "REFUND_REQUEST",
  "CUSTOMER_UNWELL",
  "SUSPECTED_THEFT",
  "WASH_CONCERN",
  "RECONCILIATION_MISMATCH",
  /** A customer reported, from the shop, that something about her order or hand-over made her feel unsafe (Prompt L §3). */
  "SAFETY_CONCERN",
  "OTHER",
] as const;
export type ExceptionType = (typeof EXCEPTION_TYPES)[number];

/**
 * Problems about money (Prompt M §2): the admin home counts them once, as "payments to check"; every other open
 * problem is "problems reported". A problem waiting for a second admin's signature counts only under approvals.
 */
export const PAYMENT_PROBLEM_TYPES = ["PAYMENT_PENDING_TOO_LONG", "PAYMENT_REVERSED", "WRONG_AMOUNT", "OVERPAYMENT", "PAYEE_MISMATCH", "UNMATCHED_PAYMENT"] as const satisfies readonly ExceptionType[];

/** Problems a field user may report from REPORT A PROBLEM. */
export const REPORTABLE_PROBLEMS = [
  "PAYMENT_PENDING_TOO_LONG",
  "WRONG_AMOUNT",
  "STOCK_SHORT",
  "DAMAGED_OR_WET",
  "SEAL_BROKEN",
  "WRONG_HUB",
  "REFUND_REQUEST",
  "CUSTOMER_UNWELL",
  "SUSPECTED_THEFT",
  "WASH_CONCERN",
  "OTHER",
] as const satisfies readonly ExceptionType[];
export type ReportableProblem = (typeof REPORTABLE_PROBLEMS)[number];

/** Problems that lock the batch they are about. */
export const LOCKING_PROBLEMS: Partial<Record<ExceptionType, "INSPECTION_ISSUE" | "DAMAGED_OR_QUARANTINED">> = {
  STOCK_SHORT: "INSPECTION_ISSUE",
  SEAL_BROKEN: "INSPECTION_ISSUE",
  DAMAGED_OR_WET: "DAMAGED_OR_QUARANTINED",
  SUSPECTED_THEFT: "DAMAGED_OR_QUARANTINED",
};

export const APPROVAL_TYPES = [
  "PRICE_LIST_ACTIVATE",
  "EXCEPTION_RESOLVE",
  "DONOR_FUNDING",
  "LARGE_EXPORT",
  "SETTING_CHANGE",
  "PRODUCT_AVAILABILITY",
  "STAKEHOLDER_ACTIVATE",
  /** Which sale paths an area allows (prompt §8.8.2) — it decides who earns, so two admins decide. */
  "AREA_SALES_CHANGE",
] as const;
export type ApprovalType = (typeof APPROVAL_TYPES)[number];

export const PRODUCT_CATEGORIES = ["REUSABLE", "DISPOSABLE"] as const;

/** The worst stretch of road between the district town and a hub (Prompt I §2.1). Not a location. */
export const ROAD_TYPES = ["PAVED", "GRAVEL", "DIRT"] as const;
export type RoadType = (typeof ROAD_TYPES)[number];
export type ProductCategory = (typeof PRODUCT_CATEGORIES)[number];

/** Ledger event types (handbook §3.2 adapted to the anchored-Merkle design). */
export const LEDGER_EVENT_TYPES = [
  "BATCH_REGISTERED",
  "PAYMENT_CONFIRMED",
  "PAYMENT_REVIEW",
  "CUSTODY_TRANSFERRED",
  "HANDOVER_COMPLETED",
  "EXCEPTION_RAISED",
  "EXCEPTION_RESOLVED",
  "STAKEHOLDER_ACTIVATED",
  "PRICE_LIST_UPDATED",
  "DONOR_FUNDING_APPROVED",
  "DAILY_RECONCILIATION",
  /** A withdrawal sent from the Dandelion collection account to a member (Prompt L §2.2). */
  "PAYOUT_SENT",
] as const;
export type LedgerEventType = (typeof LEDGER_EVENT_TYPES)[number];

/**
 * Where buyers' money goes (founders, 2026-10-01; Prompt L §2): PLATFORM — every payment to Dandelion's collection
 * account, credited to the seller's balance; members withdraw and admins send. DIRECT — the buyer pays the seller.
 */
export const PAYMENT_ROUTES = ["PLATFORM", "DIRECT"] as const;
export type PaymentRoute = (typeof PAYMENT_ROUTES)[number];

/** A member's withdrawal from their balance: one admin approves, a different admin sends. */
export const WITHDRAWAL_STATES = ["REQUESTED", "APPROVED", "SENT", "REJECTED"] as const;
export type WithdrawalState = (typeof WITHDRAWAL_STATES)[number];

/**
 * A customer's order request from the shop (Prompt L §3): open until a delivery partner in her area accepts it (the
 * sale is then an ordinary plan), or she cancels, or it expires unanswered.
 */
export const CUSTOMER_REQUEST_STATES = ["OPEN", "ACCEPTED", "CANCELLED", "EXPIRED"] as const;
export type CustomerRequestState = (typeof CUSTOMER_REQUEST_STATES)[number];
