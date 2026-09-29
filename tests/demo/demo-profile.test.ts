/**
 * Prompt B §2.6: the demo profile on a real (throwaway) database. It must run
 * through the services only, cover every reachable state, explain every
 * anomaly in its manifest, keep every identity fake, and finish in budget.
 * Uses DATABASE_URL from the "demo" vitest project (dandelion_demo by default).
 */
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, getDb } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import { APPROVAL_TYPES, CUSTODY_STATES, EXCEPTION_TYPES, ORDER_STATES, PAYMENT_STATUSES } from "@/lib/domain/types";
import { runMigrations } from "@/lib/db/migrate";
import { resetDatabase } from "@/scripts/seed";
import { runDemoSeed, type DemoRunResult } from "@/scripts/demo/run";
import type { DemoManifest } from "@/lib/demo/manifest";
import { simulateTick } from "@/lib/demo/tick";
import { resetToDemoDataset } from "@/lib/demo/reset";

process.env.VERCEL_ENV = "";
process.env.SIMULATOR_ENABLED = "true";
process.env.SEED_PROFILE = "demo";
process.env.DEMO_SCALE = process.env.DEMO_SCALE ?? "small";
process.env.APP_ORIGIN = "http://localhost:3000";

let result: DemoRunResult;
let manifest: DemoManifest;
const db = () => getDb();

async function distinct(table: string, column: string): Promise<Set<string>> {
  const r = await db().execute<{ v: string }>(sql.raw(`select distinct ${column}::text as v from ${table}`));
  return new Set(r.rows.map((x) => x.v));
}

beforeAll(async () => {
  await runMigrations().catch(() => undefined); // an empty database has no tables yet; resetDatabase needs the schema present
  await resetDatabase();
  result = await runDemoSeed();
  const row = await db().query.settings.findFirst({ where: (t, { eq }) => eq(t.key, "demoManifest") });
  // Stored as a JSON string; Drizzle's jsonb mapping already parses string values that are valid JSON.
  manifest = (typeof row!.value === "string" ? JSON.parse(row!.value) : row!.value) as DemoManifest;
});

afterAll(async () => {
  await closeDb();
});

describe("demo profile", () => {
  it("ran through the services with no scenario skipped", () => {
    expect(result.skipped, JSON.stringify(manifest.skipped, null, 1)).toBe(0);
    expect(manifest.version).toBe(1);
    expect(manifest.anomalies.length).toBeGreaterThan(5);
  });

  it("finishes within budget (warning only in CI, where the runner is slow)", () => {
    const budget = process.env.DEMO_SCALE === "full" ? 300 : 90;
    if (process.env.CI && result.seconds > budget) console.warn(`[demo] ${result.seconds}s exceeds the ${budget}s budget on this runner`);
    else expect(result.seconds).toBeLessThanOrEqual(budget);
  });

  it("covers every order state, custody state and payment status the flows can leave behind", async () => {
    // Transient states exist only inside a transaction (ACCEPTED_AT_HUB → MAKE_AVAILABLE, PICKED_UP → IN_TRANSIT in the same commit).
    const transientCustody = new Set(["ACCEPTED_AT_HUB", "PICKED_UP"]);
    const orderStates = await distinct("orders", "state");
    for (const st of ORDER_STATES) expect(orderStates.has(st), `order state ${st}`).toBe(true);
    const custody = await distinct("batches", "custody_state");
    for (const st of CUSTODY_STATES) if (!transientCustody.has(st)) expect(custody.has(st), `custody state ${st}`).toBe(true);
    const pay = await distinct("payment_intents", "status");
    for (const st of PAYMENT_STATUSES) expect(pay.has(st), `payment status ${st}`).toBe(true);
  });

  it("raises every exception type at least twice, with some open and some resolved", async () => {
    const rows = await db().execute<{ type: string; status: string; n: number }>(sql`select type, status, count(*)::int as n from exceptions group by 1, 2`);
    const byType = new Map<string, number>();
    for (const r of rows.rows) byType.set(r.type, (byType.get(r.type) ?? 0) + Number(r.n));
    // Three enum values no service ever writes as an exception row (findings in docs/REVIEW.md, not faked here):
    // PHONE_LOST — the lost-phone flow locks the account and logs a security event instead;
    // OVERPAYMENT — the verifier leaves the intent in review and reconciliation flags it, without an exception row;
    // RECONCILIATION_MISMATCH — reconciliation writes flags, never exceptions.
    const unreachable = new Set(["PHONE_LOST", "OVERPAYMENT", "RECONCILIATION_MISMATCH"]);
    for (const t of EXCEPTION_TYPES) if (!unreachable.has(t)) expect(byType.get(t) ?? 0, `exception type ${t}`).toBeGreaterThanOrEqual(2);
    const statuses = new Set(rows.rows.map((r) => r.status));
    expect(statuses.has("RESOLVED")).toBe(true);
    expect(statuses.has("OPEN")).toBe(true);
  });

  it("uses every approval type the services expose, with approved and rejected outcomes", async () => {
    const types = await distinct("approval_requests", "type");
    // STAKEHOLDER_ACTIVATE is defined but no service requests it yet.
    for (const t of APPROVAL_TYPES) if (t !== "STAKEHOLDER_ACTIVATE") expect(types.has(t), `approval type ${t}`).toBe(true);
    const statuses = await distinct("approval_requests", "status");
    expect(statuses.has("EXECUTED")).toBe(true);
    expect(statuses.has("REJECTED")).toBe(true);
  });

  it("shows every user status", async () => {
    const statuses = await distinct("users", "status");
    for (const st of ["ACTIVE", "INVITED", "LOCKED", "SUSPENDED"]) expect(statuses.has(st), `user status ${st}`).toBe(true);
  });

  it("explains every open reconciliation flag in the manifest", async () => {
    const open = await db().execute<{ kind: string }>(sql`select distinct kind from reconciliation_flags where resolved_at is null`);
    const expected = new Set(manifest.anomalies.map((a) => a.kind));
    for (const f of open.rows) expect(expected.has(f.kind), `unexplained flag ${f.kind}`).toBe(true);
  });

  it("keeps every person fictional and marked", async () => {
    const users = await db().select({ n: s.users.displayName }).from(s.users);
    const customers = await db().select({ n: s.customers.displayName }).from(s.customers);
    for (const r of [...users, ...customers]) expect(r.n).toContain("(TEST)");
    expect(customers.length).toBeGreaterThanOrEqual(30);
  });

  it("records the profile and never touches production settings", async () => {
    const profile = await db().query.settings.findFirst({ where: (t, { eq }) => eq(t.key, "seedProfile") });
    expect(profile?.value).toBe("demo");
    expect(manifest.fictionalPlaces.length).toBeGreaterThan(0);
    expect(manifest.needsNativeReview.length).toBeGreaterThan(0);
  });
});

// Prompt B §2.5 — runs last: the final test wipes the database.
describe("simulate one hour / one day, then reset", () => {
  const adminId = async () => (await db().query.users.findFirst({ where: eq(s.users.role, "SUPER_ADMIN") }))!.id;
  const count = async (table: string) => Number((await db().execute<{ n: string }>(sql.raw(`select count(*)::text as n from ${table}`))).rows[0]!.n);

  it("an hour adds activity on the real clock through the services and runs the poller", async () => {
    // An hour is a slice: it may hold new plans, installments, handovers, problems or resolutions — not all of them.
    const activity = async () => (await count("orders")) + (await count("payment_intents")) + (await count("ledger_events")) + (await count("exceptions"));
    const before = await activity();
    const r = await simulateTick("hour", await adminId());
    expect(r.kind).toBe("hour");
    expect(r.tick).toBe(1);
    expect(Object.values(r.counts).reduce((a, b) => a + b, 0), JSON.stringify(r.skipped)).toBeGreaterThan(0);
    expect(await activity()).toBeGreaterThan(before);
    const hb = await db().query.jobHeartbeats.findFirst({ where: eq(s.jobHeartbeats.name, "poller") });
    expect(hb?.lastStatus).toBe("ok (manual)");
    const ticks = await db().query.settings.findFirst({ where: eq(s.settings.key, "demoTicks") });
    expect(Number(ticks?.value)).toBe(1);
  });

  it("a day also runs reconciliation and anchoring, and both ticks are in the admin log", async () => {
    const r = await simulateTick("day", await adminId());
    expect(r.tick).toBe(2);
    expect(r.jobs.reconciled).toBe(true);
    expect(r.jobs.anchor.startsWith("error")).toBe(false);
    const hb = await db().query.jobHeartbeats.findFirst({ where: eq(s.jobHeartbeats.name, "reconciliation") });
    expect(hb?.lastStatus).toBe("ok (manual)");
    const log = await db().execute<{ n: string }>(sql`select count(*)::text as n from admin_action_log where action = 'demo.tick'`);
    expect(Number(log.rows[0]!.n)).toBe(2);
    // The new rows carry the real clock, not the seed's simulated past.
    const newest = await db().execute<{ at: string }>(sql`select max(created_at)::text as at from orders`);
    expect(Date.now() - new Date(newest.rows[0]!.at).getTime()).toBeLessThan(10 * 60_000);
  });

  it("the reset needs the typed word, then leaves nothing behind", async () => {
    const id = await adminId();
    await expect(resetToDemoDataset(id, "yes")).rejects.toMatchObject({ code: "reset_confirm_required" });
    expect(await count("users")).toBeGreaterThan(0);
    const r = await resetToDemoDataset(id, "demo");
    expect(r.wiped).toBe(true);
    expect(r.redeployTriggered).toBe(false);
    expect(r.note).toContain("npm run db:seed");
    // The wipe drops the schema (append-only triggers forbid TRUNCATE); the rebuild's migrations recreate it.
    const tables = await db().execute<{ n: string }>(sql`select count(*)::text as n from information_schema.tables where table_schema = 'public'`);
    expect(tables.rows[0]!.n).toBe("0");
  });
});

