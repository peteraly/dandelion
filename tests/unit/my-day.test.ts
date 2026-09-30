/**
 * Prompt C §5.1: the "my day" list shows one verb per open order, taken from
 * the same workflow rows that pick the primary action — never a second
 * primary action, and nothing for an order the role has no step for yet.
 */
import { describe, expect, it } from "vitest";
import { homeView, rowForOrder, type OrderSnapshot } from "@/lib/domain/workflows";

function snap(partial: Partial<OrderSnapshot> & Pick<OrderSnapshot, "id" | "kind" | "state" | "side">): OrderSnapshot {
  return { ref: `OR-${partial.id}`, verifyRef: "v", totalTzs: 1000, confirmedPaidTzs: 0, donorFundedTzs: 0, latestPaymentStatus: null, paymentClaimed: false, batchState: null, senderConfirmed: false, receiverConfirmed: false, updatedAt: new Date("2026-09-30T08:00:00Z"), ...partial };
}

describe("my day verbs", () => {
  it("gives a rider one verb per pickup and delivery, and none for a pickup the supplier has not confirmed yet", () => {
    const ready = snap({ id: "a", kind: "SUPPLIER_TO_RIDER", state: "BATCH_READY", side: "buyer" });
    const assigned = snap({ id: "b", kind: "SUPPLIER_TO_RIDER", state: "PICKUP_ASSIGNED", side: "buyer" });
    const enRoute = snap({ id: "c", kind: "RIDER_TO_HUB", state: "EN_ROUTE", side: "seller" });
    expect(rowForOrder("BOSS_RIDER", ready)).toEqual({ status: "pickup_available", action: "accept_pickup" });
    expect(rowForOrder("BOSS_RIDER", assigned)).toBeNull();
    expect(rowForOrder("BOSS_RIDER", enRoute)).toEqual({ status: "in_transit", action: "open_delivery_code" });
  });

  it("agrees with the home screen: the primary order's verb is the primary action, the others keep their own", () => {
    const orders = [snap({ id: "a", kind: "SUPPLIER_TO_RIDER", state: "BATCH_READY", side: "buyer", updatedAt: new Date("2026-09-30T09:00:00Z") }), snap({ id: "c", kind: "RIDER_TO_HUB", state: "EN_ROUTE", side: "seller" })];
    const home = homeView("BOSS_RIDER", orders);
    expect(home.order?.id).toBe("a");
    expect(rowForOrder("BOSS_RIDER", orders[0]!)?.action).toBe(home.action);
    expect(rowForOrder("BOSS_RIDER", orders[1]!)?.action).toBe("open_delivery_code");
  });
});
