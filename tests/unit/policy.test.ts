import { describe, expect, it } from "vitest";
import { ACTIONS, authorize, can, PolicyError, type Actor, type OrderResource } from "@/lib/policy";

const admin: Actor = { userId: "adm", role: "SUPER_ADMIN", hubId: null, supplierId: null, mfa: true };
const adminNoMfa: Actor = { ...admin, mfa: false };
const supplier: Actor = { userId: "sup", role: "SUPPLIER", hubId: null, supplierId: "S1", mfa: false };
const rider: Actor = { userId: "rid", role: "BOSS_RIDER", hubId: null, supplierId: null, mfa: false };
const otherRider: Actor = { ...rider, userId: "rid2" };
const hub: Actor = { userId: "hub", role: "HUB_MANAGER", hubId: "H1", supplierId: null, mfa: false };
const otherHub: Actor = { ...hub, userId: "hub2", hubId: "H2" };
const champ: Actor = { userId: "ch", role: "FIELD_CHAMPION", hubId: null, supplierId: null, mfa: false };
const otherChamp: Actor = { ...champ, userId: "ch2" };

const pickup: OrderResource = { kind: "SUPPLIER_TO_RIDER", sellerUserId: "sup", buyerUserId: "rid", supplierId: "S1", hubId: null };
const delivery: OrderResource = { kind: "RIDER_TO_HUB", sellerUserId: "rid", buyerUserId: "hub", supplierId: null, hubId: "H1" };
const transfer: OrderResource = { kind: "HUB_TO_CHAMPION", sellerUserId: "hub", buyerUserId: "ch", supplierId: null, hubId: "H1" };
const sale: OrderResource = { kind: "CHAMPION_TO_CUSTOMER", sellerUserId: "ch", buyerUserId: null, supplierId: null, hubId: null, customerChampionId: "ch" };
const o = (order: OrderResource) => ({ type: "order" as const, order });

describe("policy: admin", () => {
  it("admin actions need a second factor", () => {
    for (const a of ACTIONS.filter((x) => x.startsWith("admin."))) {
      expect(can(admin, a), a).toBe(true);
      expect(can(adminNoMfa, a), a).toBe(false);
      for (const f of [supplier, rider, hub, champ]) expect(can(f, a), `${f.role} ${a}`).toBe(false);
    }
  });
  it("admins can view any order but cannot act as a party in the field flow", () => {
    expect(can(admin, "order.view", o(pickup))).toBe(true);
    expect(can(admin, "order.claim_paid", o(pickup))).toBe(false);
    expect(can(admin, "order.confirm_release", o(pickup))).toBe(false);
  });
});

describe("policy: supplier", () => {
  it("sees and acts on own pickups only", () => {
    expect(can(supplier, "order.view", o(pickup))).toBe(true);
    expect(can(supplier, "order.confirm_batch_ready", o(pickup))).toBe(true);
    expect(can(supplier, "order.confirm_release", o(pickup))).toBe(true);
    expect(can({ ...supplier, supplierId: "S2" }, "order.view", o(pickup))).toBe(false);
    expect(can(supplier, "order.view", o(delivery))).toBe(false);
    expect(can(supplier, "order.claim_paid", o(pickup))).toBe(false);
  });
});

describe("policy: rider", () => {
  it("sees only assigned pickups and own deliveries", () => {
    expect(can(rider, "order.view", o(pickup))).toBe(true);
    expect(can(rider, "order.accept_pickup", o(pickup))).toBe(true);
    expect(can(rider, "order.claim_paid", o(pickup))).toBe(true);
    expect(can(rider, "order.confirm_receipt", o(pickup))).toBe(true);
    expect(can(rider, "order.view_delivery_code", o(delivery))).toBe(true);
    expect(can(rider, "order.confirm_release", o(delivery))).toBe(true);
    expect(can(otherRider, "order.view", o(pickup))).toBe(false);
    expect(can(otherRider, "order.view_delivery_code", o(delivery))).toBe(false);
    expect(can(rider, "order.view", o(transfer))).toBe(false);
    expect(can(rider, "customer.create")).toBe(false);
  });
});

describe("policy: hub manager", () => {
  it("sees only its hub's deliveries and champion transfers", () => {
    expect(can(hub, "order.start_inspection", o(delivery))).toBe(true);
    expect(can(hub, "order.inspect", o(delivery))).toBe(true);
    expect(can(hub, "order.claim_paid", o(delivery))).toBe(true);
    expect(can(hub, "order.prepare_transfer", o(transfer))).toBe(true);
    expect(can(hub, "order.confirm_release", o(transfer))).toBe(true);
    expect(can(otherHub, "order.view", o(delivery))).toBe(false);
    expect(can(otherHub, "order.prepare_transfer", o(transfer))).toBe(false);
    expect(can(hub, "order.view", o(sale))).toBe(false);
    expect(can(hub, "hub.inventory.view", { type: "batch", batch: { custodianUserId: "hub", hubId: "H1", supplierId: "S1" } })).toBe(true);
    expect(can(otherHub, "hub.inventory.view", { type: "batch", batch: { custodianUserId: "hub", hubId: "H1", supplierId: "S1" } })).toBe(false);
  });
});

describe("policy: champion", () => {
  it("sees only own customers and own orders", () => {
    expect(can(champ, "customer.create")).toBe(true);
    expect(can(champ, "customer.view", { type: "customer", customer: { championId: "ch" } })).toBe(true);
    expect(can(otherChamp, "customer.view", { type: "customer", customer: { championId: "ch" } })).toBe(false);
    expect(can(champ, "order.start_plan", { type: "customer", customer: { championId: "ch" } })).toBe(true);
    expect(can(otherChamp, "order.start_plan", { type: "customer", customer: { championId: "ch" } })).toBe(false);
    expect(can(champ, "order.expect_payment", o(sale))).toBe(true);
    expect(can(champ, "order.complete_handover", o(sale))).toBe(true);
    expect(can(otherChamp, "order.complete_handover", o(sale))).toBe(false);
    expect(can(champ, "order.claim_paid", o(transfer))).toBe(true);
    expect(can(champ, "order.confirm_receipt", o(transfer))).toBe(true);
    // A champion never claims a customer's payment; only the provider confirms it.
    expect(can(champ, "order.claim_paid", o(sale))).toBe(false);
    expect(can(champ, "order.view", o(delivery))).toBe(false);
  });
});

describe("authorize", () => {
  it("throws PolicyError for unauthenticated and forbidden", () => {
    expect(() => authorize(null, "order.view", o(pickup))).toThrow(PolicyError);
    expect(() => authorize(otherRider, "order.view", o(pickup))).toThrow(PolicyError);
    expect(() => authorize(rider, "order.view", o(pickup))).not.toThrow();
  });
  it("every action has a rule", () => {
    for (const a of ACTIONS) expect(typeof can(admin, a)).toBe("boolean");
  });
});
