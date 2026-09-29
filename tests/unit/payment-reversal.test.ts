/**
 * A payment the provider reverses must take the order back to waiting — only
 * the verifier may do it, only while nothing has been handed over, and only
 * when the order is no longer covered.
 */
import { describe, expect, it } from "vitest";
import { championToCustomerMachine, supplierToRiderMachine } from "@/lib/domain/orders";
import { custodyMachine } from "@/lib/domain/custody";

describe("payment reversal transitions", () => {
  it("reopens a fully paid or handover-pending plan, verifier only, only when no longer covered", () => {
    expect(championToCustomerMachine.transition("FULLY_PAID", "PAYMENT_REVERSED", "SYSTEM_VERIFIER", { fullyPaid: false })).toMatchObject({ ok: true, to: "PLAN_ACTIVE" });
    expect(championToCustomerMachine.transition("HANDOVER_PENDING", "PAYMENT_REVERSED", "SYSTEM_VERIFIER", { fullyPaid: false })).toMatchObject({ ok: true, to: "PLAN_ACTIVE" });
    expect(championToCustomerMachine.transition("FULLY_PAID", "PAYMENT_REVERSED", "SYSTEM_VERIFIER", { fullyPaid: true }).ok).toBe(false);
    expect(championToCustomerMachine.transition("FULLY_PAID", "PAYMENT_REVERSED", "FIELD_CHAMPION", { fullyPaid: false }).ok).toBe(false);
    expect(championToCustomerMachine.transition("FULLY_PAID", "PAYMENT_REVERSED", "SUPER_ADMIN", { fullyPaid: false }).ok).toBe(false);
    // A handed-over product is never taken back by a state change; that is a refund case.
    expect(championToCustomerMachine.transition("COMPLETED", "PAYMENT_REVERSED", "SYSTEM_VERIFIER", { fullyPaid: false }).ok).toBe(false);
  });

  it("takes a paid but uncompleted B2B order back to awaiting payment, and the batch back to reserved", () => {
    expect(supplierToRiderMachine.transition("PAID", "PAYMENT_REVERSED", "SYSTEM_VERIFIER", { fullyPaid: false })).toMatchObject({ ok: true, to: "AWAITING_PAYMENT" });
    expect(supplierToRiderMachine.transition("COMPLETED", "PAYMENT_REVERSED", "SYSTEM_VERIFIER", { fullyPaid: false }).ok).toBe(false);
    expect(supplierToRiderMachine.transition("PAID", "PAYMENT_REVERSED", "BOSS_RIDER", { fullyPaid: false }).ok).toBe(false);
    expect(custodyMachine.transition("READY_FOR_PICKUP", "PAYMENT_REVERSED", "SYSTEM_VERIFIER", {})).toMatchObject({ ok: true, to: "RESERVED_FOR_RIDER" });
    expect(custodyMachine.transition("IN_TRANSIT", "PAYMENT_REVERSED", "SYSTEM_VERIFIER", {}).ok).toBe(false);
  });
});
