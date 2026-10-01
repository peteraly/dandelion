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
import { FACTORY_PICKUP_KINDS, isOrgKind, isPlanKind, saleFor } from "@/lib/domain/sales";

export interface Actor {
  userId: string;
  role: Role;
  hubId: string | null;
  supplierId: string | null;
  /** Admin session has passed passkey/TOTP. Always false for field users. */
  mfa: boolean;
  /** Entered through the open demo (Prompt E): fictional data only, and a few actions are refused. */
  openDemo?: boolean;
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
  "admin.organisation.view",
  "admin.organisation.manage",
  "admin.area.sales",
  "admin.area.roads",
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
  // sellers on direct paths (prompt §8.8): organisation sales
  "order.org_sale.create",
  "order.org_sale.deliver",
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
  const sale = saleFor(o.kind);
  const seller = o.sellerUserId === a.userId && sale.seller === a.role;
  const buyer = o.buyerUserId === a.userId && sale.buyer === a.role;
  switch (a.role) {
    case "SUPPLIER":
      // Organisation-wide: any colleague of the supplier acts on what the organisation sells (ADR-029).
      return sale.seller === "SUPPLIER" && a.supplierId !== null && o.supplierId === a.supplierId;
    case "BOSS_RIDER":
      return buyer || seller;
    case "HUB_MANAGER":
      return a.hubId !== null && o.hubId === a.hubId && (buyer || seller);
    case "FIELD_CHAMPION":
      return buyer || (seller && (!isPlanKind(o.kind) || o.customerChampionId === a.userId));
    default:
      return false;
  }
}

const sellerRole = (a: Actor, o: OrderResource) => saleFor(o.kind).seller === a.role;
const buyerRole = (a: Actor, o: OrderResource) => saleFor(o.kind).buyer === a.role;
/** Roles that may enrol customers and sell to them: on the ladder the champion; on direct paths riders and suppliers (the area switch is checked in the service). */
// Only local sellers hold customers (safeguarding, lib/domain/sales.ts CLOSED_KINDS): delivery partners and supplier
// staff never enrol, see or sell to a customer.
const SELLS_TO_CUSTOMERS: readonly Role[] = ["FIELD_CHAMPION"];
const SELLS_TO_ORGS: readonly Role[] = ["SUPPLIER", "HUB_MANAGER", "BOSS_RIDER"];

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
  "admin.organisation.view": adminOnly,
  "admin.organisation.manage": adminOnly,
  "admin.area.sales": adminOnly,
  "admin.area.roads": adminOnly,

  "order.view": (a, r) => isAdmin(a) || (r.type === "order" && isOrderParty(a, r.order)),
  // Only the buyer pays; "I have paid" never confirms anything, it only asks the verifier to look.
  "order.claim_paid": orderRule((a, o) => (isPlanKind(o.kind) || isOrgKind(o.kind) ? false : o.buyerUserId === a.userId)),
  "order.confirm_release": orderRule((a, o) => !isPlanKind(o.kind) && !isOrgKind(o.kind) && (o.sellerUserId === a.userId || (isRole(a, "SUPPLIER") && FACTORY_PICKUP_KINDS.includes(o.kind)))),
  "order.confirm_receipt": orderRule((a, o) => !isPlanKind(o.kind) && !isOrgKind(o.kind) && o.buyerUserId === a.userId),
  "exception.report": (a, r) => {
    if (a.role === "SUPER_ADMIN") return isAdmin(a);
    if (r.type === "none") return true;
    if (r.type === "order") return isOrderParty(a, r.order);
    if (r.type === "batch") return r.batch.custodianUserId === a.userId || (a.role === "HUB_MANAGER" && r.batch.hubId === a.hubId);
    return false;
  },
  "note.create": (a) => a.role !== "SUPER_ADMIN",
  "account.lock_self": () => true,

  "order.confirm_batch_ready": orderRule((a, o) => isRole(a, "SUPPLIER") && FACTORY_PICKUP_KINDS.includes(o.kind)),
  "supplier.home.view": (a) => isRole(a, "SUPPLIER") && a.supplierId !== null,
  "order.org_sale.create": (a) => SELLS_TO_ORGS.includes(a.role),
  "order.org_sale.deliver": orderRule((a, o) => isOrgKind(o.kind) && sellerRole(a, o)),
  "order.accept_pickup": orderRule((a, o) => FACTORY_PICKUP_KINDS.includes(o.kind) && buyerRole(a, o)),
  "order.view_delivery_code": orderRule((a, o) => isRole(a, "BOSS_RIDER") && o.kind === "RIDER_TO_HUB"),

  "order.start_inspection": orderRule((a, o) => isRole(a, "HUB_MANAGER") && o.kind === "RIDER_TO_HUB"),
  "order.inspect": orderRule((a, o) => isRole(a, "HUB_MANAGER") && o.kind === "RIDER_TO_HUB"),
  "order.prepare_transfer": orderRule((a, o) => isRole(a, "HUB_MANAGER") && o.kind === "HUB_TO_CHAMPION"),
  "order.decline_request": orderRule((a, o) => o.kind === "HUB_TO_CHAMPION"),
  "hub.inventory.view": (a, r) => isAdmin(a) || (isRole(a, "HUB_MANAGER") && r.type === "batch" && r.batch.hubId === a.hubId) || (isRole(a, "HUB_MANAGER") && r.type === "none"),
  "hub.request_restock": (a) => isRole(a, "HUB_MANAGER"),

  "order.request_stock": (a) => isRole(a, "FIELD_CHAMPION"),
  "customer.create": (a) => SELLS_TO_CUSTOMERS.includes(a.role),
  "customer.view": (a, r) => isAdmin(a) || (SELLS_TO_CUSTOMERS.includes(a.role) && r.type === "customer" && r.customer.championId === a.userId),
  "order.start_plan": (a, r) => SELLS_TO_CUSTOMERS.includes(a.role) && r.type === "customer" && r.customer.championId === a.userId,
  "order.expect_payment": orderRule((a, o) => isPlanKind(o.kind) && sellerRole(a, o)),
  "order.start_handover": orderRule((a, o) => isPlanKind(o.kind) && sellerRole(a, o)),
  "order.complete_handover": orderRule((a, o) => isPlanKind(o.kind) && sellerRole(a, o)),
  "order.close_plan": orderRule((a, o) => isPlanKind(o.kind) && sellerRole(a, o)),
  "refund.request": orderRule((a, o) => isPlanKind(o.kind) && sellerRole(a, o)),
};

export function can(actor: Actor, action: Action, resource: Resource = { type: "none" }): boolean {
  const rule = RULES[action];
  return rule ? rule(actor, resource) : false;
}

export function authorize(actor: Actor | null, action: Action, resource: Resource = { type: "none" }): asserts actor is Actor {
  if (!actor) throw new PolicyError(action, "unauthenticated");
  if (!can(actor, action, resource)) throw new PolicyError(action, "not_permitted");
}
