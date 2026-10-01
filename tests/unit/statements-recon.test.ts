import { describe, expect, it } from "vitest";
import { diffStatement, parseStatementCsv } from "@/lib/services/statements";
import { reconcileOrder } from "@/lib/services/reconciliation";

describe("statement CSV", () => {
  it("parses common column names and thousands separators", () => {
    const rows = parseStatementCsv(`Reference,Amount,Payee,Date\nMPX1,"8,000",TILL-1,2026-09-01\nMPX2,11400,TILL-2,2026-09-02\n`);
    expect(rows).toEqual([
      { providerTxRef: "MPX1", amountTzs: 8000, payeeAccount: "TILL-1", occurredOn: "2026-09-01" },
      { providerTxRef: "MPX2", amountTzs: 11400, payeeAccount: "TILL-2", occurredOn: "2026-09-02" },
    ]);
    expect(() => parseStatementCsv("foo,bar\n1,2")).toThrow(/statement_columns_missing/);
    expect(() => parseStatementCsv("")).toThrow(/statement_empty/);
  });

  it("diff: matched, amount differs, missing in statement, missing in app", () => {
    const d = diffStatement(
      [
        { providerTxRef: "A", amountTzs: 100, payeeAccount: null, occurredOn: null },
        { providerTxRef: "B", amountTzs: 250, payeeAccount: null, occurredOn: null },
        { providerTxRef: "Z", amountTzs: 999, payeeAccount: null, occurredOn: null },
      ],
      [
        { providerTxRef: "A", amountTzs: 100, orderRef: "OR-A", confirmedAt: null },
        { providerTxRef: "B", amountTzs: 200, orderRef: "OR-B", confirmedAt: null },
        { providerTxRef: "C", amountTzs: 300, orderRef: "OR-C", confirmedAt: null },
      ],
    );
    expect(d.matched.map((m) => m.providerTxRef)).toEqual(["A"]);
    expect(d.amountDiffers).toEqual([{ providerTxRef: "B", statementTzs: 250, appTzs: 200, orderRef: "OR-B" }]);
    expect(d.missingInStatement.map((m) => m.providerTxRef)).toEqual(["C"]);
    expect(d.missingInApp.map((m) => m.providerTxRef)).toEqual(["Z"]);
  });
});

describe("reconciliation rules", () => {
  const base = {
    id: "o",
    kind: "RIDER_TO_HUB",
    state: "COMPLETED",
    totalTzs: 80_000,
    confirmedTzs: 80_000,
    donorTzs: 0,
    batchId: "b",
    batchState: "AVAILABLE_AT_HUB",
    transferEvents: 1,
    completedAt: new Date(),
    pendingIntentAgeMinutes: null,
    reviewIntents: 0,
  };
  it("a clean completed order raises no flags", () => {
    expect(reconcileOrder(base, 60)).toEqual([]);
  });
  it("flags completion without full payment or custody event", () => {
    expect(reconcileOrder({ ...base, confirmedTzs: 70_000 }, 60).map((f) => f.kind)).toContain("COMPLETED_WITHOUT_FULL_PAYMENT");
    expect(reconcileOrder({ ...base, transferEvents: 0 }, 60).map((f) => f.kind)).toContain("COMPLETED_WITHOUT_CUSTODY_EVENT");
  });
  it("flags over-coverage, stuck pending, reviews, handover without batch state", () => {
    expect(reconcileOrder({ ...base, donorTzs: 1 }, 60).map((f) => f.kind)).toContain("OVER_COVERED");
    expect(reconcileOrder({ ...base, state: "AWAITING_PAYMENT", transferEvents: 0, pendingIntentAgeMinutes: 90 }, 60).map((f) => f.kind)).toContain("PAYMENT_PENDING_TOO_LONG");
    // Counted once (Prompt M §2): a payment in review is already on the admins' list, so reconciliation does not flag it again.
    expect(reconcileOrder({ ...base, reviewIntents: 1 }, 60).map((f) => f.kind)).not.toContain("PAYMENT_IN_REVIEW");
    expect(reconcileOrder({ ...base, kind: "CHAMPION_TO_CUSTOMER", batchState: "WITH_CHAMPION" }, 60).map((f) => f.kind)).toContain("HANDOVER_WITHOUT_BATCH_STATE");
  });
});
