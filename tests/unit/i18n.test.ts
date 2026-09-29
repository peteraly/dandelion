import { describe, expect, it } from "vitest";
import en from "@/messages/en.json";
import sw from "@/messages/sw.json";
import { WORKFLOWS } from "@/lib/domain/workflows";
import { REPORTABLE_PROBLEMS, LEDGER_EVENT_TYPES, LOGIN_ROLES, ORDER_KINDS, PAYMENT_STATUSES } from "@/lib/domain/types";

function flatten(o: unknown, prefix = ""): Record<string, string> {
  const out: Record<string, string> = {};
  if (typeof o !== "object" || o === null) return out;
  for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === "object" && v !== null) Object.assign(out, flatten(v, key));
    else out[key] = String(v);
  }
  return out;
}

const fen = flatten(en);
const fsw = flatten(sw);

describe("i18n catalogues", () => {
  it("every string exists in both SW and EN", () => {
    const enKeys = Object.keys(fen).filter((k) => !k.startsWith("_meta")).sort();
    const swKeys = Object.keys(fsw).filter((k) => !k.startsWith("_meta")).sort();
    expect(swKeys).toEqual(enKeys);
  });

  it("Swahili is flagged for native review", () => {
    expect(sw._meta.needs_native_review).toBe(true);
    expect(en._meta.needs_native_review).toBe(false);
  });

  it("ICU placeholders match between locales", () => {
    // ICU arguments: {name} or {name, plural, …}; plural branch text like "{kipande #}" is not an argument.
    const ph = (s: string) => (s.match(/\{[a-zA-Z]+(?=[,}])/g) ?? []).sort();
    for (const k of Object.keys(fen)) {
      if (k.startsWith("_meta")) continue;
      expect(ph(fsw[k] ?? ""), k).toEqual(ph(fen[k]!));
    }
  });

  it("every workflow status and action, problem, role, order kind, payment status and ledger event type has copy", () => {
    for (const rows of Object.values(WORKFLOWS)) {
      for (const r of rows) {
        expect(fen[`home.status.${r.status}.title`], r.status).toBeTruthy();
        expect(fen[`home.status.${r.status}.explain`], r.status).toBeTruthy();
        expect(fen[`home.action.${r.action}`], r.action).toBeTruthy();
      }
    }
    for (const s of ["no_pickup", "no_assignment", "no_delivery", "no_active_customer", "customer_enrolled", "low_stock", "full_payment_no_stock"]) {
      expect(fen[`home.status.${s}.title`], s).toBeTruthy();
    }
    for (const p of REPORTABLE_PROBLEMS) expect(fen[`problems.${p}.label`], p).toBeTruthy();
    for (const r of LOGIN_ROLES) expect(fen[`roles.${r}`]).toBeTruthy();
    for (const k of ORDER_KINDS) expect(fen[`orderKinds.${k}`]).toBeTruthy();
    for (const p of PAYMENT_STATUSES) expect(fen[`payment.${p}`]).toBeTruthy();
    for (const e of LEDGER_EVENT_TYPES) expect(fen[`verify.eventTypes.${e}`]).toBeTruthy();
  });

  it("public copy never claims a blockchain guarantee", () => {
    for (const [k, v] of Object.entries({ ...fen, ...fsw })) {
      if (k.startsWith("_meta")) continue;
      expect(v.toLowerCase(), k).not.toMatch(/guaranteed by (the )?blockchain|inahakikishwa na blockchain/);
    }
    expect(fen["public.ledgerHonest"]).toContain("does not prove");
  });

  it("no debt or pressure language in customer-facing copy", () => {
    const customerKeys = Object.keys(fen).filter((k) => k.startsWith("sms.customer") || k.startsWith("home.status.customer_paused"));
    for (const k of customerKeys) {
      expect(fen[k]!.toLowerCase(), k).not.toMatch(/\b(overdue|penalty|must pay|owe|debt collector|late fee will)\b/);
    }
  });
});
