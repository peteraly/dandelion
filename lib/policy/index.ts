/**
 * The ONE place role-scoped access is decided (invariant §3.11).
 * Every server action, route handler, and data query for a user goes
 * through `authorize` / `can`. The UI hiding a button is never the check.
 *
 * Scoping (handbook §14):
 *  - riders see only their assigned pickups and deliveries;
 *  - hub managers see only their hub's stock and champion transfers;
 *  - champions see only their own customers;
 *  - suppliers see only their own organisation's pickups — any user of the
 *    organisation, not only the one named on the order (ADR-029);
 *  - admins see what they need to operate — only with a second factor.
 */
import type { OrderKind, Role } from "@/lib/domain/types";

export interface Actor {
  userId: string;
  role: Role;
  hubId: string | null;
  supplierId: string | null;
  /** Admin session has passed passkey/TOTP. Always false for field users. */
  mfa: boolean;
}

export interface OrderResource {
  kind: OrderKind;
  sellerUserId: string;
  buyerUserId: string | null;
  supplierId: string | null;
  hubId: string | null;
  /** For customer orders: the champion who owns the customer. */
  customerChampionId?: string | null;
}

export interface CustomerResource {
  championId: string;
}

export interface BatchResource {
  custodianUserId: string | null;
  hubId: string | null;
  supplierId: string;
}

export type Resource =
  | { type: "order"; order: OrderResource }
  | { type: "customer"; customer: CustomerResource }
  | { type: "batch"; batch: BatchResource }
  | { type: "user"; userId: string }
  | { type: "none" };

export const ACTIONS = [
  // admin
  "admin.dashboard",
  "admin.user.create",
  "admin.user.suspend",
  "admin.user.lock",
  "admin.user.reenroll",
  "admin.user.view",
  "admin.approval.request",
  "admin.approval.decide",
  "admin.pricelist.draft",
  "admin.pickup.create",
  "admin.exception.view",
  "admin.export.small",
  "admin.export.large",
  "admin.statement.import",
  "admin.ledger.view",
  "admin.logs.view",
  "admin.data_request.handle",
  "admin.passkey.register",
  "admin.supplier.view",
  "admin.supplier.manage",
  "admin.ecosystem.view",
  // shared field
  "order.view",
  "order.claim_paid",
  "order.confirm_release",
  "order.confirm_receipt",
  "exception.report",
  "note.create",
  "account.lock_self",
  // supplier
  "order.confirm_batch_ready",
  "supplier.home.view",
  // rider
  "order.accept_pickup",
  "order.view_delivery_code",
  // hub
  "order.start_inspection",
  "order.inspect",
  "order.prepare_transfer",
  "order.decline_request",
  "hub.inventory.view",
  "hub.request_restock",
  // champion
  "order.request_stock",
  "customer.create",
  "customer.view",
  "order.start_plan",
  "order.expect_payment",
  "order.start_handover",
  "order.complete_handover",
  "order.close_plan",
  "refund.request",
] as const;
export type Action = (typeof ACTIONS)[number];

export class PolicyError extends Error {
  constructor(
    public readonly action: Action,
    public readonly reason: string,
  ) {
    super(`forbidden: ${action} (${reason})`);
    this.name = "PolicyError";
  }
}

const isAdmin = (a: Actor) => a.role === "SUPER_ADMIN" && a.mfa;
const isRole = (a: Actor, r: Role) => a.role === r;

/** Is this actor a party to the order (as seen by their role)? */
export function isOrderParty(a: Actor, o: OrderResource): boolean {
  switch (a.role) {
    case "SUPPLIER":
      // Organisation-wide: a colleague may prepare or release a batch a colleague was assigned.
      return o.kind === "SUPPLIER_TO_RIDER" && a.supplierId !== null && o.supplierId === a.supplierId;
    case "BOSS_RIDER":
      return (o.kind === "SUPPLIER_TO_RIDER" && o.buyerUserId === a.userId) || (o.kind === "RIDER_TO_HUB" && o.sellerUserId === a.userId);
    case "HUB_MANAGER":
      return (
        a.hubId !== null &&
        o.hubId === a.hubId &&
        ((o.kind === "RIDER_TO_HUB" && o.buyerUserId === a.userId) || (o.kind === "HUB_TO_CHAMPION" && o.sellerUserId === a.userId))
      );
    case "FIELD_CHAMPION":
      return (
        (o.kind === "HUB_TO_CHAMPION" && o.buyerUserId === a.userId) ||
        (o.kind === "CHAMPION_TO_CUSTOMER" && o.sellerUserId === a.userId && o.customerChampionId === a.userId)
      );
    default:
      return false;
  }
}

const orderRule =
  (pred: (a: Actor, o: OrderResource) => boolean) =>
  (a: Actor, r: Resource): boolean =>
    r.type === "order" && isOrderParty(a, r.order) && pred(a, r.order);

const adminOnly = (a: Actor) => isAdmin(a);

const RULES: Record<Action, (a: Actor, r: Resource) => boolean> = {
  "admin.dashboard": adminOnly,
  "admin.user.create": adminOnly,
  "admin.user.suspend": adminOnly,
  "admin.user.lock": adminOnly,
  "admin.user.reenroll": adminOnly,
  "admin.user.view": adminOnly,
  "admin.approval.request": adminOnly,
  "admin.approval.decide": adminOnly,
  "admin.pricelist.draft": adminOnly,
  "admin.pickup.create": adminOnly,
  "admin.exception.view": adminOnly,
  "admin.export.small": adminOnly,
  "admin.export.large": adminOnly,
  "admin.statement.import": adminOnly,
  "admin.ledger.view": adminOnly,
  "admin.logs.view": adminOnly,
  "admin.data_request.handle": adminOnly,
  // Passkey registration happens right after a TOTP-verified admin login.
  "admin.passkey.register": adminOnly,
  "admin.supplier.view": adminOnly,
  "admin.supplier.manage": adminOnly,
  "admin.ecosystem.view": adminOnly,

  "order.view": (a, r) => isAdmin(a) || (r.type === "order" && isOrderParty(a, r.order)),
  // Only the buyer pays; "I have paid" never confirms anything, it only asks the verifier to look.
  "order.claim_paid": orderRule((a, o) =>
    o.kind === "CHAMPION_TO_CUSTOMER" ? false : o.buyerUserId === a.userId,
  ),
  "order.confirm_release": orderRule((a, o) => (o.sellerUserId === a.userId || (isRole(a, "SUPPLIER") && o.kind === "SUPPLIER_TO_RIDER")) && o.kind !== "CHAMPION_TO_CUSTOMER"),
  "order.confirm_receipt": orderRule((a, o) => o.buyerUserId === a.userId && o.kind !== "CHAMPION_TO_CUSTOMER"),
  "exception.report": (a, r) => {
    if (a.role === "SUPER_ADMIN") return isAdmin(a);
    if (r.type === "none") return true;
    if (r.type === "order") return isOrderParty(a, r.order);
    if (r.type === "batch") return r.batch.custodianUserId === a.userId || (a.role === "HUB_MANAGER" && r.batch.hubId === a.hubId);
    return false;
  },
  "note.create": (a) => a.role !== "SUPER_ADMIN",
  "account.lock_self": () => true,

  "order.confirm_batch_ready": orderRule((a, o) => isRole(a, "SUPPLIER") && o.kind === "SUPPLIER_TO_RIDER"),
  "supplier.home.view": (a) => isRole(a, "SUPPLIER") && a.supplierId !== null,
  "order.accept_pickup": orderRule((a, o) => isRole(a, "BOSS_RIDER") && o.kind === "SUPPLIER_TO_RIDER"),
  "order.view_delivery_code": orderRule((a, o) => isRole(a, "BOSS_RIDER") && o.kind === "RIDER_TO_HUB"),

  "order.start_inspection": orderRule((a, o) => isRole(a, "HUB_MANAGER") && o.kind === "RIDER_TO_HUB"),
  "order.inspect": orderRule((a, o) => isRole(a, "HUB_MANAGER") && o.kind === "RIDER_TO_HUB"),
  "order.prepare_transfer": orderRule((a, o) => isRole(a, "HUB_MANAGER") && o.kind === "HUB_TO_CHAMPION"),
  "order.decline_request": orderRule((a, o) => o.kind === "HUB_TO_CHAMPION"),
  "hub.inventory.view": (a, r) => isAdmin(a) || (isRole(a, "HUB_MANAGER") && r.type === "batch" && r.batch.hubId === a.hubId) || (isRole(a, "HUB_MANAGER") && r.type === "none"),
  "hub.request_restock": (a) => isRole(a, "HUB_MANAGER"),

  "order.request_stock": (a) => isRole(a, "FIELD_CHAMPION"),
  "customer.create": (a) => isRole(a, "FIELD_CHAMPION"),
  "customer.view": (a, r) => isAdmin(a) || (isRole(a, "FIELD_CHAMPION") && r.type === "customer" && r.customer.championId === a.userId),
  "order.start_plan": (a, r) => isRole(a, "FIELD_CHAMPION") && r.type === "customer" && r.customer.championId === a.userId,
  "order.expect_payment": orderRule((a, o) => isRole(a, "FIELD_CHAMPION") && o.kind === "CHAMPION_TO_CUSTOMER"),
  "order.start_handover": orderRule((a, o) => isRole(a, "FIELD_CHAMPION") && o.kind === "CHAMPION_TO_CUSTOMER"),
  "order.complete_handover": orderRule((a, o) => isRole(a, "FIELD_CHAMPION") && o.kind === "CHAMPION_TO_CUSTOMER"),
  "order.close_plan": orderRule((a, o) => isRole(a, "FIELD_CHAMPION") && o.kind === "CHAMPION_TO_CUSTOMER"),
  "refund.request": orderRule((a, o) => isRole(a, "FIELD_CHAMPION") && o.kind === "CHAMPION_TO_CUSTOMER"),
};

export function can(actor: Actor, action: Action, resource: Resource = { type: "none" }): boolean {
  const rule = RULES[action];
  return rule ? rule(actor, resource) : false;
}

export function authorize(actor: Actor | null, action: Action, resource: Resource = { type: "none" }): asserts actor is Actor {
  if (!actor) throw new PolicyError(action, "unauthenticated");
  if (!can(actor, action, resource)) throw new PolicyError(action, "not_permitted");
}
