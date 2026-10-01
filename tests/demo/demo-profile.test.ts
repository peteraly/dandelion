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
import { advanceLiveChains, parseLive } from "@/lib/demo/live";
import { restockSuggestions } from "@/lib/services/replenishment";
import { requestStock } from "@/lib/services/orders";
import { JOURNEY_STEPS, advanceJourney, journeyOrderIds, startJourney } from "@/lib/demo/journey";
import { loadPlans } from "@/lib/demo/load";
import { phoneBlindIndex } from "@/lib/crypto/blind-index";
import { decryptString } from "@/lib/crypto/envelope";
import { loadWorld } from "@/lib/demo/load";
import { RealClock } from "@/lib/demo/clock";
import { Rng } from "@/lib/demo/rng";
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

  it("walks every open direct sale path of prompt §8.8 — factory gate for sellers, rider stock, organisations — and never sells to a customer except through a local seller", async () => {
    for (const key of ["orders.SUPPLIER_TO_CHAMPION", "orders.SUPPLIER_TO_ORG", "orders.HUB_TO_ORG", "orders.RIDER_TO_ORG", "paths.rider_stock_pickups", "paths.organisation_deliveries"]) {
      expect(manifest.counts[key] ?? 0, key).toBeGreaterThanOrEqual(1);
    }
    // Safeguarding (Prompt J §3.5): no delivery partner or supplier sale to a customer anywhere in the dataset.
    const closed = await db().execute<{ n: string }>(sql`select count(*)::text as n from orders where kind in ('RIDER_TO_CUSTOMER', 'SUPPLIER_TO_CUSTOMER')`);
    expect(closed.rows[0]!.n).toBe("0");
    // A women-owned pharmacy buys in each area (business buyers, founders' decision of 2026-10-01).
    const pharmacies = await db().execute<{ n: string }>(sql`select count(*)::text as n from organisations where kind = 'PHARMACY' and women_owned and active`);
    expect(Number(pharmacies.rows[0]!.n)).toBeGreaterThanOrEqual(1);
    expect(manifest.counts["approvals.AREA_SALES_CHANGE"]).toBeGreaterThanOrEqual(1);
    const orgs = await db().execute<{ n: string }>(sql`select count(*)::text as n from organisations where active group by service_area_id`);
    for (const r of orgs.rows) expect(Number(r.n)).toBeGreaterThanOrEqual(2);
    for (const kind of ["ORG_ORDER_UNPAID", "HANDOVER_CODE_UNCONFIRMED"]) expect(manifest.anomalies.some((a) => a.kind === kind), kind).toBe(true);
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

  it("gives suppliers and organisations names short enough for a map tile (Prompt D §5.6)", async () => {
    const suppliers = await db().query.suppliers.findMany({ columns: { businessName: true } });
    const orgs = await db().query.organisations.findMany({ columns: { name: true } });
    for (const n of [...suppliers.map((x) => x.businessName), ...orgs.map((x) => x.name)]) {
      expect(n.endsWith(" (TEST)"), n).toBe(true);
      expect(n.replace(" (TEST)", "").length, n).toBeLessThanOrEqual(18);
    }
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
    const map = layoutDistrict({ nodes: snap.nodes, edges: snap.edges, areas: snap.areas, asOf: snap.asOf, orders: snap.openOrders, payments: snap.recentPayments });
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

  it("an hour moves each live delivery one step, so the map catches it at the factory, on the road and at the hub", async () => {
    // The seed ends by starting the live district: deliveries under way on the real clock, not only history.
    expect(manifest.counts["live.started"] ?? 0).toBeGreaterThan(0);
    const live = async () => parseLive((await db().query.settings.findFirst({ where: eq(s.settings.key, "demoLiveOrders") }))?.value);
    const order = async (id: string) => (await db().query.orders.findFirst({ where: eq(s.orders.id, id) }))!;
    const seed = String((await db().query.settings.findFirst({ where: eq(s.settings.key, "demoSeed") }))?.value ?? "demo");
    // The seed left deliveries under way and the hour tick above moved them; follow one from the moment it starts.
    expect((await live()).length).toBeGreaterThan(0);
    const fresh = async () => {
      for (const id of await live()) {
        const x = await order(id);
        if (x.kind === "SUPPLIER_TO_RIDER" && x.state === "PICKUP_ASSIGNED") return id;
      }
      return null;
    };
    let first = await fresh();
    if (!first) {
      // Deliveries start from demand (Prompt I): a local seller asks her hub for more than it holds and has coming.
      const [want] = await restockSuggestions(null);
      const seller = (await db().query.users.findFirst({ where: (t, { and, eq }) => and(eq(t.hubId, want!.hubId), eq(t.role, "FIELD_CHAMPION"), eq(t.status, "ACTIVE")) }))!;
      await requestStock({ userId: seller.id, role: seller.role, hubId: seller.hubId, supplierId: null, mfa: false }, { productId: want!.productId, quantity: Math.min(500, want!.onHand + want!.onTheWay + 10) });
    }
    for (let i = 0; i < 12 && !first; i++) {
      await advanceLiveChains(await loadWorld(new Rng(`${seed}:start:${i}`), new RealClock(), seed));
      first = await fresh();
    }
    expect(first).not.toBeNull();
    const seen: string[] = [];
    const note = (o: { kind: string; state: string }) => {
      const key = `${o.kind}:${o.state}`;
      if (seen[seen.length - 1] !== key) seen.push(key);
    };
    const admin = { userId: await adminId(), role: "SUPER_ADMIN" as const, hubId: null, supplierId: null, mfa: true };
    let id = first!;
    let o = await order(id);
    note(o);
    let sawOnMap = false;
    for (let i = 0; i < 20 && !(o.kind === "RIDER_TO_HUB" && o.state === "COMPLETED"); i++) {
      await advanceLiveChains(await loadWorld(new Rng(`${seed}:live:${i}`), new RealClock(), seed));
      o = await order(id);
      note(o);
      if (o.kind === "SUPPLIER_TO_RIDER" && o.state === "COMPLETED") {
        // Collected at the factory: the chain goes on as the rider's delivery to the hub.
        o = (await db().query.orders.findFirst({ where: (t, { and, eq }) => and(eq(t.parentOrderId, id), eq(t.kind, "RIDER_TO_HUB")) }))!;
        id = o.id;
        note(o);
      }
      if (o.state !== "COMPLETED") {
        const snap = await ecosystemSnapshot(admin, { window: "24h" });
        const lay = layoutDistrict({ nodes: snap.nodes, edges: snap.edges, areas: snap.areas, asOf: snap.asOf, orders: snap.openOrders, payments: snap.recentPayments });
        if (lay.markers.some((m) => m.items.some((it) => it.orderId === id))) sawOnMap = true;
      }
    }
    expect(seen.slice(0, 4)).toEqual(["SUPPLIER_TO_RIDER:PICKUP_ASSIGNED", "SUPPLIER_TO_RIDER:BATCH_READY", "SUPPLIER_TO_RIDER:AWAITING_PAYMENT", "SUPPLIER_TO_RIDER:PAID"]);
    expect(seen).toContain("RIDER_TO_HUB:EN_ROUTE");
    expect(seen).toContain("RIDER_TO_HUB:INSPECTING");
    expect(seen[seen.length - 1]).toBe("RIDER_TO_HUB:COMPLETED");
    expect(sawOnMap).toBe(true);
    // New deliveries keep starting, so something is always on the way.
    expect((await live()).length).toBeGreaterThanOrEqual(1);
  });

  it("the walkthrough runs one sale through every stakeholder, and each phone gets the texts it should", async () => {
    const id = await adminId();
    let st = await startJourney(id);
    const texts = async (phone: string) => (await db().select().from(s.smsOutbox).where(eq(s.smsOutbox.toIndex, phoneBlindIndex(phone)))).map((m) => m);
    for (const step of JOURNEY_STEPS) {
      st = await advanceJourney(id);
      expect(st.error, `${step.key}: ${st.error}`).toBeUndefined();
      if (step.key === "plan") {
        // While the walkthrough drives the plan, the live engine leaves it alone.
        const seed = String((await db().query.settings.findFirst({ where: eq(s.settings.key, "demoSeed") }))?.value ?? "demo");
        const plans = await loadPlans(await loadWorld(new Rng(`${seed}:held`), new RealClock(), seed));
        expect(plans.some((p) => p.orderId === st.planId)).toBe(false);
        expect(journeyOrderIds(st)).toContain(st.planId);
      }
    }
    expect(st.step).toBe(JOURNEY_STEPS.length);
    expect(st.log.map((l) => l.key)).toEqual(JOURNEY_STEPS.map((x) => x.key));
    for (const oid of [st.planId, st.restockId, st.pickupId, st.deliveryId]) expect((await db().query.orders.findFirst({ where: eq(s.orders.id, oid!) }))?.state).toBe("COMPLETED");
    // The customer's phone: code, plan, paid in full, hand-over code, receipt — and the receipt never names the product.
    const customer = await texts(st.customerPhone);
    expect(customer.map((m) => m.purpose)).toEqual(expect.arrayContaining(["OTP", "CUSTOMER_PLAN", "CUSTOMER_PAID", "HANDOVER_CODE", "RECEIPT"]));
    const product = await db().query.products.findFirst({ where: eq(s.products.id, st.productId) });
    expect(customer.find((m) => m.purpose === "RECEIPT")!.body).not.toContain(product!.name);
    // The delivery partner was told about the pickup.
    const rider = await db().query.users.findFirst({ where: eq(s.users.id, st.riderId) });
    const riderPhone = await decryptString(rider!.phoneEnc);
    expect((await texts(riderPhone)).some((m) => m.purpose === "PICKUP")).toBe(true);
    // Finished: nothing is held back any more, and another step changes nothing.
    expect(journeyOrderIds(st)).toEqual([]);
    expect((await advanceJourney(id)).step).toBe(JOURNEY_STEPS.length);
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

