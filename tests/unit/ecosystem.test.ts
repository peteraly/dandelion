/**
 * Prompt B §3.6 (unit): the snapshot schema, the feed's label tables — one
 * label per ledger event type, security event type and admin action — and
 * the phone scrubber the PII test relies on.
 */
import { describe, expect, it } from "vitest";
import en from "@/messages/en.json";
import sw from "@/messages/sw.json";
import { LEDGER_EVENT_TYPES, EXCEPTION_TYPES } from "@/lib/domain/types";
import { ADMIN_ACTIONS, SECURITY_EVENT_TYPES, securityLabelKey } from "@/lib/domain/events";
import { ATTENTION_KEYS, containsPhone, SnapshotSchema } from "@/lib/services/ecosystem";

describe("ecosystem labels", () => {
  for (const [name, catalogue] of [
    ["en", en],
    ["sw", sw],
  ] as const) {
    it(`${name}: every ledger event, security event and admin action has a feed label`, () => {
      const feed = catalogue.ecosystem.feed as { ledger: Record<string, string>; security: Record<string, string>; admin: Record<string, string> };
      for (const t of LEDGER_EVENT_TYPES) expect(feed.ledger[t], `ledger ${t}`).toBeTruthy();
      for (const t of SECURITY_EVENT_TYPES) expect(feed.security[t], `security ${t}`).toBeTruthy();
      expect(feed.security.PROBLEM).toContain("{type}");
      expect(feed.security.UNKNOWN).toBeTruthy();
      for (const a of ADMIN_ACTIONS) expect(feed.admin[a.replace(/\./g, "_")], `admin ${a}`).toBeTruthy();
      expect(feed.admin.UNKNOWN).toBeTruthy();
      const attention = catalogue.ecosystem.attention as Record<string, string>;
      for (const k of ATTENTION_KEYS) expect(attention[k], `attention ${k}`).toBeTruthy();
    });
  }

  it("maps PROBLEM_* security events to the generic label plus the problem type", () => {
    for (const t of EXCEPTION_TYPES) expect(securityLabelKey(`PROBLEM_${t}`)).toEqual({ key: "PROBLEM", problem: t });
    expect(securityLabelKey("PIN_FAILED")).toEqual({ key: "PIN_FAILED", problem: null });
    expect(securityLabelKey("SOMETHING_NEW")).toEqual({ key: "UNKNOWN", problem: null });
  });
});

describe("ecosystem snapshot schema", () => {
  it("accepts a minimal well-formed snapshot and rejects a bad window", () => {
    const base = {
      asOf: new Date().toISOString(),
      window: "24h",
      filters: { areaId: null, hubId: null },
      areas: [],
      hubs: [],
      nodes: [],
      edges: [],
      openOrders: [],
      recentPayments: [],
      money: { byKind: {}, pendingIntents: 0, reviewIntents: 0, plans: { active: 0, completedInWindow: 0, stalled: 0 } },
      attention: Object.fromEntries([...ATTENTION_KEYS.map((k) => [k, 0]), ["openExceptionsByType", {}]]),
      system: { heartbeats: [], anchoring: { configured: false, network: "celo-sepolia", lastAnchorAt: null, lastStatus: null, unanchored: 0 }, smsOutbox24h: 0, paymentProvider: "mock", smsProvider: "mock", ai: { enabled: false, model: "x", monthCalls: 0, monthCostMicroUsd: 0 }, environment: "development", version: "dev", seedProfile: "", demo: false },
      feed: [],
    };
    expect(SnapshotSchema.safeParse(base).success).toBe(true);
    expect(SnapshotSchema.safeParse({ ...base, window: "1h" }).success).toBe(false);
  });
});

describe("phone scrubber", () => {
  it("finds Tanzanian numbers in any common spelling and ignores masked ones", () => {
    expect(containsPhone("+255700000010")).toBe(true);
    expect(containsPhone("call 0700 000 010 now")).toBe(true);
    expect(containsPhone("+255 700 000 010")).toBe(true);
    expect(containsPhone("+255 ••• ••• 010")).toBe(false);
    expect(containsPhone("OR-ABC123 · 75,000 TZS")).toBe(false);
  });
});
