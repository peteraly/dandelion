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
import { containsPhone, ecosystemSnapshot, SnapshotSchema } from "@/lib/services/ecosystem";
import { layoutDistrict } from "@/lib/ecosystem/district";
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

  it("never writes a timestamp in the future: waits between steps stay inside their simulated day", async () => {
    for (const table of ["orders", "ledger_events", "payment_intents", "exceptions"]) {
      const r = await db().execute<{ n: string }>(sql.raw(`select count(*)::text as n from ${table} where created_at > now()`));
      expect(Number(r.rows[0]!.n), table).toBe(0);
    }
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
    for (const t of APPROVAL_TYPES) expect(types.has(t), `approval type ${t}`).toBe(true);
    const statuses = await distinct("approval_requests", "status");
    expect(statuses.has("EXECUTED")).toBe(true);
    expect(statuses.has("REJECTED")).toBe(true);
  });

  it("gives every area two active suppliers, each supplying products, with the quality story in the manifest (Prompt B §8.5)", async () => {
    const perArea = await db().execute<{ n: string }>(sql`select count(*)::text as n from suppliers where active group by service_area_id`);
    expect(perArea.rows.length).toBeGreaterThan(0);
    for (const r of perArea.rows) expect(Number(r.n)).toBeGreaterThanOrEqual(2);
    const unsupplied = await db().execute<{ n: string }>(sql`select count(*)::text as n from suppliers s where active and not exists (select 1 from supplier_products sp where sp.supplier_id = s.id and sp.active)`);
    expect(unsupplied.rows[0]!.n).toBe("0");
    expect(manifest.counts["suppliers.poor.pickups"] ?? 0).toBeGreaterThan(0);
    expect(manifest.counts["suppliers.good.pickups"] ?? 0).toBeGreaterThan(manifest.counts["suppliers.poor.pickups"] ?? 0);
    expect(manifest.anomalies.some((a) => a.kind === "PICKUP_WAITING_ON_SUPPLIER")).toBe(true);
    expect(manifest.counts["suppliers.second_user_enrolled"]).toBe(1);
  });

  it("walks every direct sale path of prompt §8.8: village drops, factory gate, organisations", async () => {
    for (const key of ["orders.RIDER_TO_CUSTOMER", "orders.SUPPLIER_TO_CUSTOMER", "orders.SUPPLIER_TO_CHAMPION", "orders.SUPPLIER_TO_ORG", "orders.HUB_TO_ORG", "paths.rider_stock_pickups", "paths.organisation_deliveries"]) {
      expect(manifest.counts[key] ?? 0, key).toBeGreaterThanOrEqual(1);
    }
    expect(manifest.counts["approvals.AREA_SALES_CHANGE"]).toBeGreaterThanOrEqual(1);
    const orgs = await db().execute<{ n: string }>(sql`select count(*)::text as n from organisations where active group by service_area_id`);
    for (const r of orgs.rows) expect(Number(r.n)).toBeGreaterThanOrEqual(2);
    for (const kind of ["ORG_ORDER_UNPAID", "VILLAGE_DROP_CODE_UNCONFIRMED"]) expect(manifest.anomalies.some((a) => a.kind === kind), kind).toBe(true);
    const states = await distinct("batches", "custody_state");
    expect(states.has("WITH_RIDER")).toBe(true);
    expect(states.has("DELIVERED_TO_ORG")).toBe(true);
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
    // "[deleted]" is the pseudonym a handled deletion request leaves behind (§4.12).
    for (const r of [...users, ...customers]) expect(r.n === "[deleted]" || r.n.includes("(TEST)"), r.n).toBe(true);
    expect(customers.length).toBeGreaterThanOrEqual(30);
  });

  it("records the profile and never touches production settings", async () => {
    const profile = await db().query.settings.findFirst({ where: (t, { eq }) => eq(t.key, "seedProfile") });
    expect(profile?.value).toBe("demo");
    expect(manifest.fictionalPlaces.length).toBeGreaterThan(0);
    expect(manifest.needsNativeReview.length).toBeGreaterThan(0);
  });
});

// Prompt B §3.6 on the generated dataset: counts, no PII, and the p95 budget.
describe("ecosystem snapshot on the demo dataset", () => {
  const adminActor = async () => {
    const a = (await db().query.users.findFirst({ where: eq(s.users.role, "SUPER_ADMIN") }))!;
    return { userId: a.id, role: a.role, hubId: null, supplierId: null, mfa: true } as const;
  };

  it("matches direct SQL and shows the demo banner flag", async () => {
    const snap = await ecosystemSnapshot(await adminActor(), { window: "7d" });
    expect(SnapshotSchema.safeParse(snap).success).toBe(true);
    const count = async (q: string) => Number((await db().execute<{ n: string }>(sql.raw(`select count(*)::text as n from ${q}`))).rows[0]!.n);
    expect(snap.nodes.filter((n) => n.kind === "SUPPLIER").length).toBe(await count("suppliers"));
    expect(snap.nodes.filter((n) => n.kind === "HUB").length).toBe(await count("hubs"));
    expect(snap.openOrders.length).toBe(await count("orders where state not in ('COMPLETED','CANCELLED','CLOSED')"));
    expect(snap.edges.length).toBeGreaterThan(3);
    expect(snap.attention.lockedBatches).toBe(await count("batches where custody_state in ('INSPECTION_ISSUE','DAMAGED_OR_QUARANTINED') and quantity > 0"));
    expect(snap.attention.waitingOnSupplier).toBeGreaterThanOrEqual(1);
    expect(snap.system.demo).toBe(true);
    expect(snap.feed.length).toBe(50);
    // The district map (prompt §9): one tile per node, one band per area, a motorbike for the pickups left in flight.
    const map = layoutDistrict({ nodes: snap.nodes, edges: snap.edges, areas: snap.areas, asOf: snap.asOf });
    expect(map.unplaced).toEqual([]);
    expect(map.tiles.length).toBe(snap.nodes.length);
    expect(map.bands.length).toBe(snap.areas.length);
    expect(map.tiles.filter((x) => x.kind === "HUB").length).toBe(snap.hubs.length);
    expect(map.markers.length).toBeGreaterThanOrEqual(1);
    expect(map.tiles.some((x) => x.locked)).toBe(true);
    const text = JSON.stringify(snap);
    expect(containsPhone(text)).toBe(false);
    for (const c of await db().select({ n: s.customers.displayName }).from(s.customers)) expect(text).not.toContain(c.n);
  });

  it("answers within budget (p95 < 800 ms locally; a warning in CI)", async () => {
    const actor = await adminActor();
    const times: number[] = [];
    for (let i = 0; i < 6; i++) {
      const t0 = performance.now();
      await ecosystemSnapshot(actor, { window: "30d" });
      times.push(performance.now() - t0);
    }
    times.sort((a, b) => a - b);
    const p95 = times[Math.min(times.length - 1, Math.ceil(times.length * 0.95) - 1)]!;
    console.log(`[ecosystem] snapshot p95 ${Math.round(p95)} ms (${times.map((t) => Math.round(t)).join(", ")})`);
    if (process.env.CI && p95 > 800) console.warn(`[ecosystem] p95 ${Math.round(p95)} ms exceeds the 800 ms budget on this runner`);
    else expect(p95).toBeLessThan(800);
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

