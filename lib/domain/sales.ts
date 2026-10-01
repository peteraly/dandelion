/**
 * The chain as a graph of allowed sales (prompt §8.8.1): who may sell to
 * whom, in which shape, and whether the handbook's ladder already allows it.
 * Everything that creates an order derives its kind from this table; anything
 * not in it is refused before a row is written.
 */
import type { OrderKind, Role } from "./types";

export type SaleBuyer = Role | "CUSTOMER" | "ORGANISATION";
export type SaleShape = "bulk" | "plan";

export interface SaleRow {
  kind: OrderKind;
  seller: Role;
  buyer: SaleBuyer;
  shape: SaleShape;
  /** Part of the handbook ladder: always allowed. Others are per-area switches, off until the founders decide. */
  ladder: boolean;
}

export const ALLOWED_SALES: readonly SaleRow[] = [
  { kind: "SUPPLIER_TO_RIDER", seller: "SUPPLIER", buyer: "BOSS_RIDER", shape: "bulk", ladder: true },
  { kind: "RIDER_TO_HUB", seller: "BOSS_RIDER", buyer: "HUB_MANAGER", shape: "bulk", ladder: true },
  { kind: "HUB_TO_CHAMPION", seller: "HUB_MANAGER", buyer: "FIELD_CHAMPION", shape: "bulk", ladder: true },
  { kind: "CHAMPION_TO_CUSTOMER", seller: "FIELD_CHAMPION", buyer: "CUSTOMER", shape: "plan", ladder: true },
  // Village drop: the rider sells directly from stock they keep.
  { kind: "RIDER_TO_CUSTOMER", seller: "BOSS_RIDER", buyer: "CUSTOMER", shape: "plan", ladder: false },
  // Factory gate: a customer, a hub or a champion buys at the supplier.
  { kind: "SUPPLIER_TO_CUSTOMER", seller: "SUPPLIER", buyer: "CUSTOMER", shape: "plan", ladder: false },
  { kind: "SUPPLIER_TO_HUB", seller: "SUPPLIER", buyer: "HUB_MANAGER", shape: "bulk", ladder: false },
  { kind: "SUPPLIER_TO_CHAMPION", seller: "SUPPLIER", buyer: "FIELD_CHAMPION", shape: "bulk", ladder: false },
  // Organisations buy in bulk from a supplier, a hub or a rider.
  { kind: "SUPPLIER_TO_ORG", seller: "SUPPLIER", buyer: "ORGANISATION", shape: "bulk", ladder: false },
  { kind: "HUB_TO_ORG", seller: "HUB_MANAGER", buyer: "ORGANISATION", shape: "bulk", ladder: false },
  { kind: "RIDER_TO_ORG", seller: "BOSS_RIDER", buyer: "ORGANISATION", shape: "bulk", ladder: false },
];

/**
 * Safeguarding (founders, 2026-10-01; Prompt J §3.5): hand-overs to girls and women go through women local sellers,
 * or to schools and other organisations. The app stores no ages, so it cannot tell where girls under 18 are served;
 * delivery partners and supplier staff therefore never sell directly to a customer, in any area. These kinds stay
 * in the table so orders made before the rule can finish and history still reads; no new ones are created, and no
 * area switch can turn them back on.
 */
export const CLOSED_KINDS: readonly OrderKind[] = ["RIDER_TO_CUSTOMER", "SUPPLIER_TO_CUSTOMER"];

export const LADDER_KINDS: readonly OrderKind[] = ALLOWED_SALES.filter((r) => r.ladder).map((r) => r.kind);
/** The per-area switches: every non-ladder path except the closed ones. */
export const DIRECT_KINDS: readonly OrderKind[] = ALLOWED_SALES.filter((r) => !r.ladder && !CLOSED_KINDS.includes(r.kind)).map((r) => r.kind);
export const PLAN_KINDS: readonly OrderKind[] = ALLOWED_SALES.filter((r) => r.shape === "plan").map((r) => r.kind);
export const ORG_KINDS: readonly OrderKind[] = ALLOWED_SALES.filter((r) => r.buyer === "ORGANISATION").map((r) => r.kind);
/** Pickups at the factory: the supplier prepares a batch, the buyer collects it. */
export const FACTORY_PICKUP_KINDS: readonly OrderKind[] = ["SUPPLIER_TO_RIDER", "SUPPLIER_TO_HUB", "SUPPLIER_TO_CHAMPION"];
/** Every kind the supplier organisation sells under. */
export const SUPPLIER_SELLER_KINDS: readonly OrderKind[] = ALLOWED_SALES.filter((r) => r.seller === "SUPPLIER").map((r) => r.kind);

export function saleFor(kind: OrderKind): SaleRow {
  return ALLOWED_SALES.find((r) => r.kind === kind)!;
}

export function isPlanKind(kind: OrderKind): boolean {
  return PLAN_KINDS.includes(kind);
}

export function isOrgKind(kind: OrderKind): boolean {
  return ORG_KINDS.includes(kind);
}

/** The kind a (seller, buyer) pair sells under, or null when the table has no such sale. */
export function deriveKind(seller: Role, buyer: SaleBuyer): OrderKind | null {
  return ALLOWED_SALES.find((r) => r.seller === seller && r.buyer === buyer)?.kind ?? null;
}

/** Is `kind` allowed in an area whose switches are `allowed`? Ladder kinds always are; closed kinds never are. */
export function saleAllowed(kind: OrderKind, allowed: readonly string[]): boolean {
  if (CLOSED_KINDS.includes(kind)) return false;
  return LADDER_KINDS.includes(kind) || allowed.includes(kind);
}

export const DEFAULT_ALLOWED_SALES: readonly OrderKind[] = LADDER_KINDS;
