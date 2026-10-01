/**
 * Prompt §8.8.1/§8.8.7: the chain is a table of allowed sales. Anything that
 * creates an order derives its kind from it; a pair outside it has no kind,
 * the ladder is always allowed, everything else is a per-area switch.
 */
import { describe, expect, it } from "vitest";
import { ALLOWED_SALES, CLOSED_KINDS, DEFAULT_ALLOWED_SALES, DIRECT_KINDS, FACTORY_PICKUP_KINDS, LADDER_KINDS, ORG_KINDS, PLAN_KINDS, SUPPLIER_SELLER_KINDS, type SaleBuyer, deriveKind, isOrgKind, isPlanKind, saleAllowed, saleFor } from "@/lib/domain/sales";
import { INITIAL_ORDER_STATE, ORDER_MACHINES } from "@/lib/domain/orders";
import { ORDER_KINDS, type Role } from "@/lib/domain/types";

const SELLERS: Role[] = ["SUPER_ADMIN", "SUPPLIER", "BOSS_RIDER", "HUB_MANAGER", "FIELD_CHAMPION"];
const BUYERS: SaleBuyer[] = [...SELLERS, "CUSTOMER", "ORGANISATION"];

describe("allowed sales table", () => {
  it("covers every order kind exactly once, with no duplicate (seller, buyer) pair", () => {
    expect([...ALLOWED_SALES.map((r) => r.kind)].sort()).toEqual([...ORDER_KINDS].sort());
    const pairs = ALLOWED_SALES.map((r) => `${r.seller}>${r.buyer}`);
    expect(new Set(pairs).size).toBe(pairs.length);
    for (const k of ORDER_KINDS) expect(saleFor(k).kind).toBe(k);
  });

  it("derives the kind of every row from its seller and buyer, and refuses every other pair", () => {
    for (const r of ALLOWED_SALES) expect(deriveKind(r.seller, r.buyer)).toBe(r.kind);
    let derivable = 0;
    for (const seller of SELLERS) for (const buyer of BUYERS) if (deriveKind(seller, buyer)) derivable++;
    expect(derivable).toBe(ALLOWED_SALES.length);
    // Pairs the handbook and the founders never described have no kind at all.
    expect(deriveKind("FIELD_CHAMPION", "BOSS_RIDER")).toBeNull();
    expect(deriveKind("HUB_MANAGER", "CUSTOMER")).toBeNull();
    expect(deriveKind("FIELD_CHAMPION", "ORGANISATION")).toBeNull();
    expect(deriveKind("SUPER_ADMIN", "CUSTOMER")).toBeNull();
    expect(deriveKind("BOSS_RIDER", "SUPPLIER")).toBeNull();
  });

  it("always allows the ladder and needs the area's switch for everything else", () => {
    expect(LADDER_KINDS).toEqual(["SUPPLIER_TO_RIDER", "RIDER_TO_HUB", "HUB_TO_CHAMPION", "CHAMPION_TO_CUSTOMER"]);
    expect(DEFAULT_ALLOWED_SALES).toEqual(LADDER_KINDS);
    for (const k of LADDER_KINDS) expect(saleAllowed(k, [])).toBe(true);
    for (const k of DIRECT_KINDS) {
      expect(saleAllowed(k, []), k).toBe(false);
      expect(saleAllowed(k, [k]), k).toBe(true);
      expect(saleAllowed(k, DIRECT_KINDS.filter((x) => x !== k)), k).toBe(false);
    }
    expect([...LADDER_KINDS, ...DIRECT_KINDS, ...CLOSED_KINDS].sort()).toEqual([...ORDER_KINDS].sort());
  });

  it("safeguarding: delivery partners and supplier staff never sell to a customer, whatever an area's switches say", () => {
    expect(CLOSED_KINDS).toEqual(["RIDER_TO_CUSTOMER", "SUPPLIER_TO_CUSTOMER"]);
    for (const k of CLOSED_KINDS) {
      expect(DIRECT_KINDS, k).not.toContain(k);
      expect(saleAllowed(k, [...ORDER_KINDS]), k).toBe(false);
    }
    // Every sale to a customer that can still be made is a local seller's.
    expect(ALLOWED_SALES.filter((r) => r.buyer === "CUSTOMER" && !CLOSED_KINDS.includes(r.kind)).map((r) => r.seller)).toEqual(["FIELD_CHAMPION"]);
  });

  it("customers pay in installments; stakeholders and organisations pay the exact amount", () => {
    for (const r of ALLOWED_SALES) {
      expect(r.shape, r.kind).toBe(r.buyer === "CUSTOMER" ? "plan" : "bulk");
      expect(isPlanKind(r.kind)).toBe(r.buyer === "CUSTOMER");
      expect(isOrgKind(r.kind)).toBe(r.buyer === "ORGANISATION");
    }
    expect(PLAN_KINDS).toEqual(["CHAMPION_TO_CUSTOMER", "RIDER_TO_CUSTOMER", "SUPPLIER_TO_CUSTOMER"]);
    expect(ORG_KINDS).toEqual(["SUPPLIER_TO_ORG", "HUB_TO_ORG", "RIDER_TO_ORG"]);
    expect(PLAN_KINDS.some((k) => ORG_KINDS.includes(k))).toBe(false);
  });

  it("gives every kind a state machine and the initial state its shape implies", () => {
    for (const k of ORDER_KINDS) {
      expect(ORDER_MACHINES[k], k).toBeDefined();
      expect(INITIAL_ORDER_STATE[k], k).toBeDefined();
    }
    for (const k of PLAN_KINDS) expect(INITIAL_ORDER_STATE[k]).toBe("PLAN_ACTIVE");
    for (const k of ORG_KINDS) expect(INITIAL_ORDER_STATE[k]).toBe("AWAITING_PAYMENT");
    for (const k of FACTORY_PICKUP_KINDS) expect(INITIAL_ORDER_STATE[k]).toBe("PICKUP_ASSIGNED");
  });

  it("factory pickups are the supplier's bulk sales to stakeholders; supplier kinds are every row the supplier sells", () => {
    const supplierBulkToStakeholders = ALLOWED_SALES.filter((r) => r.seller === "SUPPLIER" && r.shape === "bulk" && r.buyer !== "ORGANISATION").map((r) => r.kind);
    expect([...FACTORY_PICKUP_KINDS].sort()).toEqual(supplierBulkToStakeholders.sort());
    expect([...SUPPLIER_SELLER_KINDS].sort()).toEqual(ALLOWED_SALES.filter((r) => r.seller === "SUPPLIER").map((r) => r.kind).sort());
    for (const k of SUPPLIER_SELLER_KINDS) expect(saleFor(k).seller).toBe("SUPPLIER");
  });
});

describe("earnings arithmetic (prompt §8.8.4)", () => {
  it("is received minus paid, per window, and can be negative while stock is still unsold", async () => {
    const { earned } = await import("@/lib/services/earnings");
    expect(earned(11_400, 7_500)).toBe(3_900);
    expect(earned(0, 0)).toBe(0);
    // A rider who bought four kits and sold one so far has paid more than she received.
    expect(earned(11_400, 4 * 7_500)).toBe(-18_600);
  });
});
