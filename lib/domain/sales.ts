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

export const LADDER_KINDS: readonly OrderKind[] = ALLOWED_SALES.filter((r) => r.ladder).map((r) => r.kind);
export const DIRECT_KINDS: readonly OrderKind[] = ALLOWED_SALES.filter((r) => !r.ladder).map((r) => r.kind);
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

/** Is `kind` allowed in an area whose switches are `allowed`? Ladder kinds always are. */
export function saleAllowed(kind: OrderKind, allowed: readonly string[]): boolean {
  return LADDER_KINDS.includes(kind) || allowed.includes(kind);
}

export const DEFAULT_ALLOWED_SALES: readonly OrderKind[] = LADDER_KINDS;
