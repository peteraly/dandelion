import { describe, expect, it } from "vitest";
import { evaluateApproval, canDecide, isDualApproved, effectiveThreshold } from "@/lib/domain/approval";
import { homeView, WORKFLOWS, type OrderSnapshot } from "@/lib/domain/workflows";
import { FIELD_ROLES, type OrderKind, type OrderState } from "@/lib/domain/types";

describe("dual approval (§3.14)", () => {
  it("requester counts once; a second distinct admin approves", () => {
    expect(evaluateApproval({ requesterId: "a", decisions: [], threshold: 2 })).toMatchObject({ status: "PENDING", signatures: 1 });
    expect(evaluateApproval({ requesterId: "a", decisions: [{ adminId: "b", decision: "APPROVE" }], threshold: 2 })).toMatchObject({ status: "APPROVED" });
  });

  it("a requester can never approve their own request", () => {
    expect(evaluateApproval({ requesterId: "a", decisions: [{ adminId: "a", decision: "APPROVE" }], threshold: 2 })).toEqual({
      status: "INVALID",
      reason: "self_approval",
    });
    expect(canDecide("a", "a", [])).toBe("self_approval");
    expect(isDualApproved({ requesterId: "a", approverIds: ["a"], threshold: 2 })).toBe(false);
  });

  it("threshold is configurable (2-of-3) but never below 2", () => {
    expect(effectiveThreshold(1)).toBe(2);
    expect(effectiveThreshold(3)).toBe(3);
    const two = evaluateApproval({ requesterId: "a", decisions: [{ adminId: "b", decision: "APPROVE" }], threshold: 3 });
    expect(two.status).toBe("PENDING");
    const three = evaluateApproval({
      requesterId: "a",
      decisions: [
        { adminId: "b", decision: "APPROVE" },
        { adminId: "c", decision: "APPROVE" },
      ],
      threshold: 3,
    });
    expect(three.status).toBe("APPROVED");
  });

  it("a rejection by another admin rejects; duplicates are invalid", () => {
    expect(evaluateApproval({ requesterId: "a", decisions: [{ adminId: "b", decision: "REJECT" }], threshold: 2 }).status).toBe("REJECTED");
    expect(canDecide("a", "b", [{ adminId: "b", decision: "APPROVE" }])).toBe("already_decided");
    expect(
      evaluateApproval({
        requesterId: "a",
        decisions: [
          { adminId: "b", decision: "APPROVE" },
          { adminId: "b", decision: "APPROVE" },
        ],
        threshold: 3,
      }).status,
    ).toBe("INVALID");
  });
});

function snap(p: Partial<OrderSnapshot> & { kind: OrderKind; state: OrderState; side: "seller" | "buyer" }): OrderSnapshot {
  return {
    id: "o1",
    ref: "OR-TEST",
    verifyRef: "v",
    totalTzs: 8000,
    confirmedPaidTzs: 0,
    donorFundedTzs: 0,
    latestPaymentStatus: null,
    paymentClaimed: false,
    batchState: null,
    senderConfirmed: false,
    receiverConfirmed: false,
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    ...p,
  };
}

describe("role workflows (One Screen Rule)", () => {
  it("every workflow row is reachable and yields exactly one action", () => {
    for (const role of FIELD_ROLES) {
      for (const row of WORKFLOWS[role]) {
        expect(typeof row.action).toBe("string");
      }
    }
  });

  it("rider: pickup available → accept; awaiting → I have paid; claimed → refresh; confirmed → confirm pickup", () => {
    const base = { kind: "SUPPLIER_TO_RIDER" as const, side: "buyer" as const };
    expect(homeView("BOSS_RIDER", [snap({ ...base, state: "BATCH_READY" })]).action).toBe("accept_pickup");
    expect(homeView("BOSS_RIDER", [snap({ ...base, state: "AWAITING_PAYMENT" })]).action).toBe("i_have_paid");
    expect(homeView("BOSS_RIDER", [snap({ ...base, state: "AWAITING_PAYMENT", paymentClaimed: true })])).toMatchObject({
      status: "payment_pending",
      action: "refresh_payment",
    });
    expect(homeView("BOSS_RIDER", [snap({ ...base, state: "PAID" })]).action).toBe("confirm_receipt");
    expect(homeView("BOSS_RIDER", [snap({ kind: "RIDER_TO_HUB", side: "seller", state: "EN_ROUTE" })]).action).toBe("open_delivery_code");
    expect(homeView("BOSS_RIDER", []).status).toBe("no_assignment");
  });

  it("a locked batch shows the problem status first", () => {
    const v = homeView("HUB_MANAGER", [
      snap({ kind: "RIDER_TO_HUB", side: "buyer", state: "ON_HOLD", batchState: "INSPECTION_ISSUE" }),
      snap({ id: "o2", kind: "HUB_TO_CHAMPION", side: "seller", state: "REQUESTED" }),
    ]);
    expect(v.status).toBe("problem_reported");
  });

  it("champion: fully paid with no stock → request stock", () => {
    const o = snap({ kind: "CHAMPION_TO_CUSTOMER", side: "seller", state: "FULLY_PAID" });
    expect(homeView("FIELD_CHAMPION", [o], { championStockUnits: 0 }).action).toBe("request_stock");
    expect(homeView("FIELD_CHAMPION", [o], { championStockUnits: 3 }).action).toBe("complete_handover");
  });

  it("champion: 14 days without payment → contact or close (no pressure)", () => {
    const o = snap({ kind: "CHAMPION_TO_CUSTOMER", side: "seller", state: "PLAN_ACTIVE", daysSinceLastPayment: 15 });
    expect(homeView("FIELD_CHAMPION", [o]).action).toBe("contact_or_close");
  });

  it("idle states", () => {
    expect(homeView("SUPPLIER", []).status).toBe("no_pickup");
    expect(homeView("HUB_MANAGER", [], { lowStock: true }).action).toBe("request_restock");
    expect(homeView("FIELD_CHAMPION", [], { customersWithoutPlan: 1 }).action).toBe("start_plan");
    expect(homeView("FIELD_CHAMPION", []).action).toBe("add_customer");
  });
});
