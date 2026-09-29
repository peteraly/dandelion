import { describe, expect, it } from "vitest";
import { custodyMachine, canSplit, isLocked, type CustodyCtx, type CustodyEvent } from "@/lib/domain/custody";
import { ORDER_MACHINES, amountRuleFor, type OrderCtx } from "@/lib/domain/orders";
import { paymentMachine, amountMatches, type VerificationEvidence } from "@/lib/domain/payments";
import type { Machine } from "@/lib/domain/machine";
import { CUSTODY_STATES, LOCKED_CUSTODY_STATES, SYSTEM_ACTORS, LOGIN_ROLES, type ActorKind, type CustodyState } from "@/lib/domain/types";
import { tzs } from "@/lib/money";

const APPROVAL = { requesterId: "admin-a", approverIds: ["admin-b"], threshold: 2 };
const ALL_ACTORS: ActorKind[] = [...LOGIN_ROLES, ...SYSTEM_ACTORS];

const okCustody: CustodyCtx = {
  orderFullyPaid: true,
  orderHasConfirmedPayment: false,
  senderConfirmed: true,
  receiverConfirmed: true,
  inspectionPassed: true,
  deliveryCodeValid: true,
  customerCodeValid: true,
  educationConfirmed: true,
  approval: APPROVAL,
};
const okOrder: OrderCtx = {
  fullyPaid: true,
  hasConfirmedPayment: false,
  hasDonorFunding: false,
  senderConfirmed: true,
  receiverConfirmed: true,
  deliveryCodeValid: true,
  stockAvailable: true,
  stockReserved: true,
  customerCodeValid: true,
  educationConfirmed: true,
  approval: APPROVAL,
};
const okPayment: VerificationEvidence = {
  source: "CALLBACK",
  providerQueried: true,
  providerStatus: "SUCCESS",
  dedupeRecorded: true,
  amountMatched: true,
  payeeMatched: true,
  signatureOk: true,
};

/** Exercise every (row, from-state) pair of a machine with a permissive context. */
function coverAllFixedEdges<S extends string, E extends string, C>(m: Machine<S, E, C>, ctxFor: (row: number, from: S) => C) {
  const covered = new Set<string>();
  m.rows.forEach((row, i) => {
    for (const from of row.from) {
      const actor = row.actors[0]!;
      const res = m.transition(from, row.event, actor, ctxFor(i, from));
      expect(res.ok, `${m.name} row ${i} ${row.event} from ${from}: ${res.ok ? "" : res.reason}`).toBe(true);
      if (res.ok) covered.add(`${i}:${from}:${res.to}`);
    }
  });
  return covered;
}

describe("custody machine", () => {
  it("exercises every transition row from every from-state (100% transition coverage)", () => {
    const covered = coverAllFixedEdges(custodyMachine, (_i, from) => ({
      ...okCustody,
      lockedFromState: from === "DAMAGED_OR_QUARANTINED" ? ("AVAILABLE_AT_HUB" as CustodyState) : undefined,
    }));
    // every row appears
    const rowsCovered = new Set([...covered].map((k) => k.split(":")[0]));
    expect(rowsCovered.size).toBe(custodyMachine.rows.length);
  });

  it("reaches every allowed target of RESOLVE_RESUME", () => {
    const row = custodyMachine.rows.find((r) => r.event === "RESOLVE_RESUME")!;
    const targets = typeof row.to === "string" ? [row.to] : row.to.oneOf;
    const reached = new Set<string>();
    for (const locked of CUSTODY_STATES) {
      const res = custodyMachine.transition("DAMAGED_OR_QUARANTINED", "RESOLVE_RESUME", "SYSTEM_APPROVALS", {
        ...okCustody,
        lockedFromState: locked,
      });
      if (res.ok) reached.add(res.to);
    }
    const fromInspection = custodyMachine.transition("INSPECTION_ISSUE", "RESOLVE_RESUME", "SYSTEM_APPROVALS", okCustody);
    expect(fromInspection).toMatchObject({ ok: true, to: "AT_HUB_INSPECTION" });
    reached.add("AT_HUB_INSPECTION");
    expect([...reached].sort()).toEqual([...targets].sort());
  });

  it("§3.3: no pickup, hub acceptance, or champion handover without full payment and both confirmations", () => {
    for (const [event, from] of [
      ["PICKUP", "READY_FOR_PICKUP"],
      ["HUB_ACCEPT", "AT_HUB_INSPECTION"],
      ["CHAMPION_HANDOVER", "RESERVED_FOR_CHAMPION"],
    ] as const) {
      const actor = custodyMachine.rows.find((r) => r.event === event)!.actors[0]!;
      expect(custodyMachine.transition(from, event, actor, { ...okCustody, orderFullyPaid: false }).ok).toBe(false);
      expect(custodyMachine.transition(from, event, actor, { ...okCustody, senderConfirmed: false }).ok).toBe(false);
      expect(custodyMachine.transition(from, event, actor, { ...okCustody, receiverConfirmed: false }).ok).toBe(false);
      expect(custodyMachine.transition(from, event, actor, okCustody).ok).toBe(true);
    }
  });

  it("§3.3: customer handover needs full payment, customer code, and education", () => {
    const t = (c: Partial<CustodyCtx>) => custodyMachine.transition("RESERVED_FOR_CUSTOMER", "CUSTOMER_HANDOVER", "FIELD_CHAMPION", { ...okCustody, ...c });
    expect(t({ orderFullyPaid: false }).ok).toBe(false);
    expect(t({ customerCodeValid: false }).ok).toBe(false);
    expect(t({ educationConfirmed: false }).ok).toBe(false);
    expect(t({}).ok).toBe(true);
  });

  it("only the verifier can move a batch to READY_FOR_PICKUP", () => {
    for (const actor of ALL_ACTORS.filter((a) => a !== "SYSTEM_VERIFIER")) {
      expect(custodyMachine.transition("PAYMENT_PENDING", "PAYMENT_CONFIRMED", actor, okCustody).ok).toBe(false);
    }
    expect(custodyMachine.transition("PAYMENT_PENDING", "PAYMENT_CONFIRMED", "SYSTEM_VERIFIER", { ...okCustody, orderFullyPaid: false }).ok).toBe(false);
  });

  it("§3.4: locked batches accept no event except a dual-approved resolution", () => {
    const events = [...new Set(custodyMachine.rows.map((r) => r.event))] as CustodyEvent[];
    for (const locked of LOCKED_CUSTODY_STATES) {
      expect(isLocked(locked)).toBe(true);
      for (const ev of events) {
        for (const actor of ALL_ACTORS) {
          const res = custodyMachine.transition(locked, ev, actor, { ...okCustody, lockedFromState: "AVAILABLE_AT_HUB" });
          if (res.ok) {
            expect(["RESOLVE_RESUME", "RESOLVE_RETURN"]).toContain(ev);
            expect(actor).toBe("SYSTEM_APPROVALS");
          }
        }
      }
      // without dual approval, even the approvals executor is refused
      const noApproval = custodyMachine.transition(locked, "RESOLVE_RETURN", "SYSTEM_APPROVALS", { ...okCustody, approval: undefined });
      expect(noApproval.ok).toBe(false);
      const selfApproved = custodyMachine.transition(locked, "RESOLVE_RETURN", "SYSTEM_APPROVALS", {
        ...okCustody,
        approval: { requesterId: "a", approverIds: ["a"], threshold: 2 },
      });
      expect(selfApproved.ok).toBe(false);
    }
  });

  it("splits only from the right unlocked parent state with enough stock", () => {
    expect(canSplit("SPLIT_FOR_CHAMPION", { state: "AVAILABLE_AT_HUB", quantity: 5 }, 3)).toBeNull();
    expect(canSplit("SPLIT_FOR_CHAMPION", { state: "AVAILABLE_AT_HUB", quantity: 2 }, 3)).toBe("insufficient_stock");
    expect(canSplit("SPLIT_FOR_CHAMPION", { state: "DAMAGED_OR_QUARANTINED", quantity: 5 }, 1)).toBe("batch_locked");
    expect(canSplit("SPLIT_FOR_CUSTOMER", { state: "AVAILABLE_AT_HUB", quantity: 5 }, 1)).toBe("parent_wrong_state");
    expect(canSplit("SPLIT_FOR_CUSTOMER", { state: "WITH_CHAMPION", quantity: 5 }, 0)).toBe("invalid_quantity");
  });

  it("rejects unknown transitions", () => {
    expect(custodyMachine.transition("HANDED_TO_CUSTOMER", "PICKUP", "SUPPLIER", okCustody).ok).toBe(false);
    for (const s of CUSTODY_STATES as readonly CustodyState[]) {
      expect(custodyMachine.eventsFrom(s).every((e) => typeof e === "string")).toBe(true);
    }
  });
});

describe("order machines", () => {
  for (const [kind, m] of Object.entries(ORDER_MACHINES)) {
    it(`${kind}: exercises every transition row from every from-state`, () => {
      const covered = coverAllFixedEdges(m, (i) => {
        const row = m.rows[i]!;
        // Rows guarded by "not fully paid" need fullyPaid=false.
        if (row.event === "INSTALLMENT_CONFIRMED") return { ...okOrder, fullyPaid: false };
        return okOrder;
      });
      const rows = new Set([...covered].map((k) => k.split(":")[0]));
      expect(rows.size).toBe(m.rows.length);
    });

    it(`${kind}: only the verifier confirms payment, and only when fully paid`, () => {
      const row = m.rows.find((r) => r.event === "PAYMENT_CONFIRMED");
      if (!row) return;
      for (const actor of ALL_ACTORS.filter((a) => a !== "SYSTEM_VERIFIER")) {
        expect(m.transition(row.from[0]!, "PAYMENT_CONFIRMED", actor, okOrder).ok).toBe(false);
      }
      expect(m.transition(row.from[0]!, "PAYMENT_CONFIRMED", "SYSTEM_VERIFIER", { ...okOrder, fullyPaid: false }).ok).toBe(false);
    });
  }

  it("customer DONOR_FUNDED picks FULLY_PAID only when the order is covered", () => {
    const m = ORDER_MACHINES.CHAMPION_TO_CUSTOMER;
    expect(m.transition("PLAN_ACTIVE", "DONOR_FUNDED", "SYSTEM_APPROVALS", { ...okOrder, fullyPaid: false })).toMatchObject({ ok: true, to: "PLAN_ACTIVE" });
    expect(m.transition("PLAN_ACTIVE", "DONOR_FUNDED", "SYSTEM_APPROVALS", okOrder)).toMatchObject({ ok: true, to: "FULLY_PAID" });
    expect(m.transition("PLAN_ACTIVE", "DONOR_FUNDED", "SYSTEM_APPROVALS", { ...okOrder, approval: undefined }).ok).toBe(false);
    expect(m.transition("PLAN_ACTIVE", "DONOR_FUNDED", "SUPER_ADMIN", okOrder).ok).toBe(false);
  });

  it("customer handover completion needs code + education + full payment", () => {
    const m = ORDER_MACHINES.CHAMPION_TO_CUSTOMER;
    expect(m.transition("HANDOVER_PENDING", "COMPLETE", "FIELD_CHAMPION", { ...okOrder, customerCodeValid: false }).ok).toBe(false);
    expect(m.transition("HANDOVER_PENDING", "COMPLETE", "FIELD_CHAMPION", { ...okOrder, educationConfirmed: false }).ok).toBe(false);
    expect(m.transition("HANDOVER_PENDING", "COMPLETE", "FIELD_CHAMPION", { ...okOrder, fullyPaid: false }).ok).toBe(false);
  });

  it("plans with any payment cannot be closed (refund review instead)", () => {
    const m = ORDER_MACHINES.CHAMPION_TO_CUSTOMER;
    expect(m.transition("PLAN_ACTIVE", "CLOSE_PLAN", "FIELD_CHAMPION", { ...okOrder, hasConfirmedPayment: true }).ok).toBe(false);
    expect(m.transition("PLAN_ACTIVE", "CLOSE_PLAN", "FIELD_CHAMPION", { ...okOrder, hasDonorFunding: true }).ok).toBe(false);
  });

  it("amount rules: B2B exact, customer up to remaining", () => {
    expect(amountRuleFor("SUPPLIER_TO_RIDER")).toBe("EXACT_REMAINING");
    expect(amountRuleFor("CHAMPION_TO_CUSTOMER")).toBe("UP_TO_REMAINING");
  });
});

describe("payment machine (§3.1, §3.2)", () => {
  it("has exactly three statuses", () => {
    expect(paymentMachine.states).toEqual(["PAYMENT_PENDING", "PAYMENT_CONFIRMED", "PAYMENT_FAILED_OR_REVIEW"]);
  });

  it("exercises every transition", () => {
    const covered = coverAllFixedEdges(paymentMachine, (i) =>
      paymentMachine.rows[i]!.event === "REVERSED" ? { ...okPayment, providerStatus: "REVERSED" as const } : okPayment,
    );
    expect(new Set([...covered].map((k) => k.split(":")[0])).size).toBe(paymentMachine.rows.length);
  });

  it("a payment in review is never confirmed later; a fresh intent is used instead", () => {
    expect(paymentMachine.transition("PAYMENT_FAILED_OR_REVIEW", "CONFIRM", "SYSTEM_VERIFIER", okPayment).ok).toBe(false);
  });

  it("no actor but the verifier can confirm — not an admin, not a user, not AI", () => {
    for (const actor of ALL_ACTORS.filter((a) => a !== "SYSTEM_VERIFIER")) {
      expect(paymentMachine.transition("PAYMENT_PENDING", "CONFIRM", actor, okPayment).ok).toBe(false);
    }
  });

  it.each([
    ["no callback or poll", { source: undefined }],
    ["no direct provider query", { providerQueried: false }],
    ["provider says pending", { providerStatus: "PENDING" as const }],
    ["provider says not found (spoofed)", { providerStatus: "NOT_FOUND" as const }],
    ["no dedupe row (duplicate/replay)", { dedupeRecorded: false }],
    ["amount mismatch", { amountMatched: false }],
    ["payee mismatch", { payeeMatched: false }],
    ["bad signature", { signatureOk: false }],
  ])("refuses confirmation when %s", (_label, override) => {
    expect(paymentMachine.transition("PAYMENT_PENDING", "CONFIRM", "SYSTEM_VERIFIER", { ...okPayment, ...override }).ok).toBe(false);
  });

  it("amount matching", () => {
    expect(amountMatches("EXACT_REMAINING", tzs(8000), tzs(8000))).toEqual({ ok: true });
    expect(amountMatches("EXACT_REMAINING", tzs(7000), tzs(8000))).toEqual({ ok: false, reason: "WRONG_AMOUNT" });
    expect(amountMatches("EXACT_REMAINING", tzs(9000), tzs(8000))).toEqual({ ok: false, reason: "OVERPAYMENT" });
    expect(amountMatches("UP_TO_REMAINING", tzs(1000), tzs(5400))).toEqual({ ok: true });
    expect(amountMatches("UP_TO_REMAINING", tzs(5400), tzs(5400))).toEqual({ ok: true });
    expect(amountMatches("UP_TO_REMAINING", tzs(5401), tzs(5400))).toEqual({ ok: false, reason: "OVERPAYMENT" });
    expect(amountMatches("UP_TO_REMAINING", tzs(0), tzs(5400))).toEqual({ ok: false, reason: "WRONG_AMOUNT" });
  });
});
