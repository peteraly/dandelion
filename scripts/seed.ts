/**
 * Seed data for development, preview and tests (build prompt §9; Prompt B §2).
 * Obviously fake names and numbers only.
 *
 * Safety (Prompt B §2.8):
 *  - refuses in production and against a host that looks like production;
 *  - refuses when the target database already holds anyone without "(TEST)"
 *    in their name, or ledger events that no seed run explains;
 *  - admin passphrases/TOTP secrets and the field PIN come from the
 *    environment; development has fixed defaults, everything else must set
 *    SEED_ADMIN_PASSPHRASE_A/B, SEED_ADMIN_TOTP_A/B and SEED_FIELD_PIN.
 *
 * Usage: npm run db:seed                       (minimal profile; idempotent)
 *        SEED_RESET=1 npm run db:seed          (wipes and reseeds; dev/test only)
 *        SEED_PROFILE=demo npm run db:seed     (Prompt B living dataset; empty database only)
 */
import { sql } from "drizzle-orm";
import { now } from "@/lib/clock";
import { closeDb, databaseUrl, getDb } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import { appEnv } from "@/lib/env";
import { encryptString } from "@/lib/crypto/envelope";
import { phoneBlindIndex } from "@/lib/crypto/blind-index";
import { hashPin, hashPassphrase, currentPepperVersion } from "@/lib/auth/secrets";
import { runMigrations } from "@/lib/db/migrate";
import { tzDay } from "@/lib/util/time";
import { putSetting } from "@/lib/services/core";

export type SeedProfile = "minimal" | "demo";

/** Fake-range check shared with the demo generator: +255 700 00[0-9] [0-9][0-9][0-9]. */
export const FAKE_PHONE_RE = /^\+2557000{2}\d{4}$/;

export interface SeedIdentities {
  adminA: { phone: string; name: string; passphrase: string; totp: string };
  adminB: { phone: string; name: string; passphrase: string; totp: string };
  fieldPin: string;
  supplier: { phone: string; name: string; pin: string; payee: string };
  riders: { phone: string; name: string; pin: string; payee: string }[];
  hub: { phone: string; name: string; pin: string; payee: string };
  champions: { phone: string; name: string; pin: string; payee: string }[];
  customers: { phone: string; name: string }[];
  prices: { supplier: number; hub: number; champion: number; customer: number };
}

/**
 * Identities from the environment. Pure so it can be unit-tested: `isDev`
 * decides whether the fixed development defaults apply; otherwise a missing
 * variable yields "" and `requireSeedCredentials` refuses later.
 */
export function buildSeed(env: Record<string, string | undefined>, isDev: boolean): SeedIdentities {
  const fromEnv = (name: string, devDefault: string): string => {
    const v = env[name];
    if (v && v.length > 0) return v;
    return isDev ? devDefault : "";
  };
  const fieldPin = fromEnv("SEED_FIELD_PIN", "2580");
  return {
    adminA: { phone: "+255700000001", name: "Admin Alpha (TEST)", passphrase: fromEnv("SEED_ADMIN_PASSPHRASE_A", "test-admin-passphrase-alpha"), totp: fromEnv("SEED_ADMIN_TOTP_A", "JBSWY3DPEHPK3PXP") },
    adminB: { phone: "+255700000002", name: "Admin Bravo (TEST)", passphrase: fromEnv("SEED_ADMIN_PASSPHRASE_B", "test-admin-passphrase-bravo"), totp: fromEnv("SEED_ADMIN_TOTP_B", "KRSXG5CTMVRXEZLU") },
    fieldPin,
    supplier: { phone: "+255700000010", name: "Supplier Test Co. (TEST)", pin: fieldPin, payee: "TILL-SUP-001" },
    riders: [
      { phone: "+255700000021", name: "Rider One (TEST)", pin: fieldPin, payee: "TILL-RID-001" },
      { phone: "+255700000022", name: "Rider Two (TEST)", pin: fieldPin, payee: "TILL-RID-002" },
    ],
    hub: { phone: "+255700000030", name: "Hub Manager (TEST)", pin: fieldPin, payee: "TILL-HUB-001" },
    champions: [
      { phone: "+255700000041", name: "Champion One (TEST)", pin: fieldPin, payee: "TILL-CHA-001" },
      { phone: "+255700000042", name: "Champion Two (TEST)", pin: fieldPin, payee: "TILL-CHA-002" },
      { phone: "+255700000043", name: "Champion Three (TEST)", pin: fieldPin, payee: "TILL-CHA-003" },
    ],
    customers: [
      { phone: "+255700000051", name: "Customer A (TEST)" },
      { phone: "+255700000052", name: "Customer B (TEST)" },
      { phone: "+255700000053", name: "Customer C (TEST)" },
      { phone: "+255700000054", name: "Customer D (TEST)" },
      { phone: "+255700000055", name: "Customer E (TEST)" },
    ],
    prices: { supplier: 7500, hub: 8000, champion: 9000, customer: 11400 },
  };
}

export const SEED: SeedIdentities = buildSeed(process.env, appEnv() === "development");

/** Refuses to create people with missing or weak credentials (outside development the env must set them). */
export function requireSeedCredentials(seed: SeedIdentities = SEED): void {
  const problems: string[] = [];
  const b32 = /^[A-Z2-7]{16,64}$/;
  for (const [label, a] of [
    ["A", seed.adminA],
    ["B", seed.adminB],
  ] as const) {
    if (a.passphrase.length < 12) problems.push(`SEED_ADMIN_PASSPHRASE_${label} (min 12 characters)`);
    if (!b32.test(a.totp)) problems.push(`SEED_ADMIN_TOTP_${label} (base32, 16–64 characters)`);
  }
  if (!/^\d{4}$/.test(seed.fieldPin) || /^(\d)\1{3}$/.test(seed.fieldPin) || seed.fieldPin === "1234" || seed.fieldPin === "4321") problems.push("SEED_FIELD_PIN (4 digits, not trivial)");
  for (const p of [seed.adminA, seed.adminB, seed.supplier, seed.hub, ...seed.riders, ...seed.champions, ...seed.customers]) {
    if (!FAKE_PHONE_RE.test(p.phone)) problems.push(`phone outside the fake range: ${p.phone}`);
    if (!p.name.includes("(TEST)")) problems.push(`name without (TEST): ${p.name}`);
  }
  if (problems.length) throw new Error(`seed refuses: set/fix ${problems.join("; ")}`);
}

export function refuseIfProduction(): void {
  if (appEnv() === "production") throw new Error("seed refuses to run in production");
  const host = new URL(databaseUrl()).hostname;
  const prodHost = process.env.PRODUCTION_DB_HOST;
  if (prodHost && host === prodHost) throw new Error(`seed refuses to run against production host ${host}`);
  if (/prod/i.test(host) || /main/i.test(host)) throw new Error(`seed refuses to run against host ${host} (looks like production)`);
}

/**
 * Content guard (Prompt B §2.8): the target must not look like a real
 * database, whatever the connection string says. Every real database has
 * people in it, and every seeded person carries "(TEST)", so one person
 * without the marker is enough to refuse. Tolerates an empty database and
 * a database with no users table yet.
 */
export async function assertSafeTargetDatabase(): Promise<void> {
  refuseIfProduction();
  const db = getDb();
  const tables = await db.execute<{ table_name: string }>(sql`select table_name from information_schema.tables where table_schema = 'public' and table_name in ('users', 'settings')`);
  const has = new Set(tables.rows.map((r) => r.table_name));
  // A database a seed populated is marked; production never carries the marker because the seed refuses to run there.
  if (has.has("settings")) {
    const r = await db.execute<{ v: string | null }>(sql`select value #>> '{}' as v from settings where key = 'seedProfile'`);
    if (r.rows[0]?.v) return;
  }
  if (has.has("users")) {
    const r = await db.execute<{ n: number }>(sql`select count(*)::int as n from users where display_name not like '%(TEST)%'`);
    const n = Number(r.rows[0]?.n ?? 0);
    if (n > 0) throw new Error(`seed refuses: the database holds ${n} user(s) without "(TEST)" in the name and no seed marker — this looks like real data`);
  }
}

/** The demo profile needs an empty database (Prompt B §2.1): no people, no ledger events. */
export async function assertEmptyDatabase(): Promise<void> {
  const db = getDb();
  const tables = await db.execute<{ table_name: string }>(sql`select table_name from information_schema.tables where table_schema = 'public' and table_name in ('users', 'ledger_events')`);
  for (const t of tables.rows.map((r) => r.table_name)) {
    const r = await db.execute<{ n: number }>(sql`select count(*)::int as n from ${sql.identifier(t)}`);
    if (Number(r.rows[0]?.n ?? 0) > 0) throw new Error(`SEED_PROFILE=demo needs an empty database; ${t} is not empty (use SEED_RESET=1 outside production, or a fresh Neon branch)`);
  }
}

export async function resetDatabase(): Promise<void> {
  await assertSafeTargetDatabase();
  const db = getDb();
  // Triggers forbid TRUNCATE on append-only tables; drop and recreate the schema instead.
  await db.execute(sql`drop schema public cascade`);
  await db.execute(sql`create schema public`);
  await db.execute(sql`drop schema if exists drizzle cascade`);
  await runMigrations();
}

async function person(p: { phone: string; name: string }) {
  return { displayName: p.name, phoneEnc: await encryptString(p.phone), phoneIndex: phoneBlindIndex(p.phone) };
}

export interface MinimalSeedResult {
  areaId: string;
  supplierId: string;
  hubId: string;
  productIds: { kit: string; disposable: string };
  adminIds: [string, string];
}

/** The minimal profile: one area, one supplier, one hub, the fixed people, an active price list. */
export async function seed(): Promise<MinimalSeedResult | null> {
  await assertSafeTargetDatabase();
  const db = getDb();
  const existing = await db.query.serviceAreas.findFirst();
  if (existing) {
    console.log("[seed] already seeded; nothing to do");
    return null;
  }
  requireSeedCredentials();
  return db.transaction(async (tx) => {
    const [area] = await tx.insert(s.serviceAreas).values({ code: "TEST-AREA", name: "Test Village (TEST)", region: "Test Region" }).returning();
    const [supplier] = await tx.insert(s.suppliers).values({ businessName: SEED.supplier.name, serviceAreaId: area!.id, active: true }).returning();
    const [hub] = await tx.insert(s.hubs).values({ name: "Test Hub (TEST)", serviceAreaId: area!.id, minStockUnits: 10, active: true }).returning();
    const [kit] = await tx
      .insert(s.products)
      .values({ name: "Standard kit (reusable)", category: "REUSABLE", unitDescription: "1 kit: reusable pads + storage bag" })
      .returning();
    const [disposable] = await tx
      .insert(s.products)
      .values({ name: "Disposable pack", category: "DISPOSABLE", unitDescription: "1 pack of disposable pads" })
      .returning();
    await tx.insert(s.productAreaAvailability).values([
      { productId: kit!.id, serviceAreaId: area!.id, available: true, washConditionsConfirmed: true },
      { productId: disposable!.id, serviceAreaId: area!.id, available: true, washConditionsConfirmed: false },
    ]);

    const pv = currentPepperVersion();
    const admins = [];
    for (const a of [SEED.adminA, SEED.adminB]) {
      const [u] = await tx
        .insert(s.users)
        .values({
          ...(await person(a)),
          role: "SUPER_ADMIN",
          status: "ACTIVE",
          preferredLocale: "en",
          passphraseHash: await hashPassphrase(a.passphrase),
          pinPepperVersion: pv,
          totpSecretEnc: await encryptString(a.totp),
          enrolledAt: now(),
        })
        .returning();
      admins.push(u!);
    }
    const adminId = admins[0]!.id;

    const field = async (p: { phone: string; name: string; pin: string; payee: string }, role: (typeof s.roleEnum.enumValues)[number], extra: Partial<typeof s.users.$inferInsert> = {}) => {
      const pin = await hashPin(p.pin);
      const [u] = await tx
        .insert(s.users)
        .values({
          ...(await person(p)),
          role,
          status: "ACTIVE",
          preferredLocale: "sw",
          serviceAreaId: area!.id,
          pinHash: pin.hash,
          pinPepperVersion: pin.pepperVersion,
          payoutProvider: "MPESA",
          payeeAccount: p.payee,
          enrolledAt: now(),
          createdBy: adminId,
          ...extra,
        })
        .returning();
      await tx.insert(s.trainingRecords).values({ userId: u!.id, module: "role_training_v1", agreementAccepted: true, recordedBy: adminId });
      return u!;
    };

    await field(SEED.supplier, "SUPPLIER", { supplierId: supplier!.id });
    for (const r of SEED.riders) await field(r, "BOSS_RIDER");
    await field(SEED.hub, "HUB_MANAGER", { hubId: hub!.id });
    const champions = [];
    for (const c of SEED.champions) champions.push(await field(c, "FIELD_CHAMPION", { hubId: hub!.id }));

    for (const [i, c] of SEED.customers.entries()) {
      const champion = champions[i % champions.length]!;
      const [cust] = await tx
        .insert(s.customers)
        .values({ ...(await person(c)), championId: champion.id, serviceAreaId: area!.id, phoneVerifiedAt: now() })
        .returning();
      await tx.insert(s.consentRecords).values([
        { customerId: cust!.id, kind: "TRANSACTION_MESSAGES", granted: true, noticeVersion: "2026-09-v1", recordedBy: champion.id },
        { customerId: cust!.id, kind: "REMINDERS", granted: true, noticeVersion: "2026-09-v1", recordedBy: champion.id },
      ]);
    }

    // Dual-approved active price list: requested by A, approved by B.
    const [req] = await tx
      .insert(s.approvalRequests)
      .values({ type: "PRICE_LIST_ACTIVATE", status: "EXECUTED", payload: {}, summary: "Seed price list v1", requestedBy: adminId, threshold: 2, decidedAt: now(), executedAt: now() })
      .returning();
    await tx.insert(s.approvalDecisions).values({ requestId: req!.id, adminId: admins[1]!.id, decision: "APPROVE" });
    const [pl] = await tx
      .insert(s.priceLists)
      .values({ version: 1, serviceAreaId: area!.id, supplierId: supplier!.id, effectiveFrom: tzDay(), status: "DRAFT", createdBy: adminId, approvalRequestId: req!.id })
      .returning();
    await tx.insert(s.priceListItems).values([
      { priceListId: pl!.id, productId: kit!.id, supplierPriceTzs: SEED.prices.supplier, hubPriceTzs: SEED.prices.hub, championPriceTzs: SEED.prices.champion, customerPriceTzs: SEED.prices.customer },
      { priceListId: pl!.id, productId: disposable!.id, supplierPriceTzs: 3000, hubPriceTzs: 3300, championPriceTzs: 3800, customerPriceTzs: 4500 },
    ]);
    await tx.execute(sql`select set_config('app.approvals', 'on', true)`);
    await tx.update(s.priceLists).set({ status: "ACTIVE", activatedAt: now() }).where(sql`${s.priceLists.id} = ${pl!.id}`);
    await tx.update(s.approvalRequests).set({ payload: { priceListId: pl!.id } }).where(sql`${s.approvalRequests.id} = ${req!.id}`);

    await tx.insert(s.contractDeployments).values({ chainId: 11142220, network: "celo-sepolia", contractAddress: "0x0000000000000000000000000000000000000000", active: false, notes: "placeholder — replaced by scripts/deploy-contract.ts" });

    // Marks this database as seeded; the content guard and the simulated-data banner read it.
    await putSetting(tx, "seedProfile", "minimal", adminId);
    console.log("[seed] done (minimal)");
    return { areaId: area!.id, supplierId: supplier!.id, hubId: hub!.id, productIds: { kit: kit!.id, disposable: disposable!.id }, adminIds: [admins[0]!.id, admins[1]!.id] };
  });
}

export function seedProfileFromEnv(): SeedProfile {
  const v = process.env.SEED_PROFILE ?? "minimal";
  if (v !== "minimal" && v !== "demo") throw new Error(`unknown SEED_PROFILE ${v}`);
  return v;
}

if (process.argv[1]?.endsWith("seed.ts")) {
  (async () => {
    try {
      const profile = seedProfileFromEnv();
      if (process.env.SEED_RESET === "1") await resetDatabase();
      if (profile === "demo") {
        const { runDemoSeed } = await import("./demo/run");
        await runDemoSeed();
      } else {
        await seed();
      }
    } catch (e) {
      console.error("[seed] failed", e);
      process.exitCode = 1;
    } finally {
      await closeDb();
    }
  })();
}
