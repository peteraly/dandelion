/**
 * Seed data for development, preview and tests (build prompt §9; Prompt B §2).
 * Obviously fake names and numbers only.
 *
 * Safety (Prompt B §2.8, ADR-026) lives in lib/seed-identities.ts (who) and
 * lib/seed-guards.ts (where):
 *  - refuses in production and against a host that looks like production;
 *  - refuses a database that holds anyone without "(TEST)" unless a seed
 *    marker explains it;
 *  - admin passphrases/TOTP secrets and the field PIN come from the
 *    environment; development has fixed defaults, everything else must set
 *    SEED_ADMIN_PASSPHRASE_A/B, SEED_ADMIN_TOTP_A/B and SEED_FIELD_PIN.
 *
 * Usage: npm run db:seed                       (minimal profile; idempotent)
 *        SEED_RESET=1 npm run db:seed          (wipes and reseeds; dev/test only)
 *        SEED_PROFILE=demo npm run db:seed     (Prompt B living dataset; empty database only)
 */
import { eq, sql } from "drizzle-orm";
import { now } from "@/lib/clock";
import { closeDb, getDb } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import { encryptString } from "@/lib/crypto/envelope";
import { phoneBlindIndex } from "@/lib/crypto/blind-index";
import { hashPin, hashPassphrase, currentPepperVersion } from "@/lib/auth/secrets";
import { runMigrations } from "@/lib/db/migrate";
import { tzDay } from "@/lib/util/time";
import { putSetting } from "@/lib/services/core";
import { SEED, SEED_NOTES, requireSeedCredentials, type MinimalSeedResult } from "@/lib/seed-identities";
import { assertSafeTargetDatabase, wipeDatabase } from "@/lib/seed-guards";
import { appEnv, simulatorEnabled } from "@/lib/env";

export { FAKE_PHONE_RE, SEED, buildSeed, normaliseTotpSecret, requireSeedCredentials, type SeedIdentities, type MinimalSeedResult } from "@/lib/seed-identities";
export { assertEmptyDatabase, assertSafeTargetDatabase, refuseIfProduction } from "@/lib/seed-guards";

export type SeedProfile = "minimal" | "demo";

/** Wipe (guarded) and re-create the schema. */
export async function resetDatabase(): Promise<void> {
  await wipeDatabase();
  await runMigrations();
}

async function person(p: { phone: string; name: string }) {
  return { displayName: p.name, phoneEnc: await encryptString(p.phone), phoneIndex: phoneBlindIndex(p.phone) };
}

/** The minimal profile: one area, one supplier, one hub, the fixed people, an active price list. */
export async function seed(): Promise<MinimalSeedResult | null> {
  await assertSafeTargetDatabase();
  const db = getDb();
  const existing = await db.query.serviceAreas.findFirst();
  if (existing) {
    // Upgrade a database seeded before the marker existed, so the guard and the banner can rely on it.
    const marker = await db.query.settings.findFirst({ where: eq(s.settings.key, "seedProfile") });
    if (!marker) await putSetting(db, "seedProfile", "minimal", null);
    console.log("[seed] already seeded; nothing to do");
    return null;
  }
  requireSeedCredentials();
  return db.transaction(async (tx) => {
    const [area] = await tx.insert(s.serviceAreas).values({ code: "TEST-AREA", name: "Test Village (TEST)", region: "Test Region" }).returning();
    const [supplier] = await tx
      .insert(s.suppliers)
      .values({ businessName: SEED.supplier.name, serviceAreaId: area!.id, active: true, contactName: "Supplier contact (TEST)", leadTimeDays: 2, paymentTermsNote: "Paid per pickup by mobile money before release (test data)" })
      .returning();
    const [hub] = await tx.insert(s.hubs).values({ name: "Test Hub (TEST)", serviceAreaId: area!.id, minStockUnits: 10, active: true }).returning();
    // Public meeting points for shop orders (Prompt L §3); the shop opens once the area allows delivery partners to sell to customers.
    await tx.insert(s.meetingPoints).values([
      { serviceAreaId: area!.id, name: "Market gate (TEST)" },
      { serviceAreaId: area!.id, name: "Dispensary gate (TEST)" },
    ]);
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
    await tx.insert(s.supplierProducts).values([
      { supplierId: supplier!.id, productId: kit!.id, supplierSku: "KIT-STD" },
      { supplierId: supplier!.id, productId: disposable!.id, supplierSku: "DISP-10" },
    ]);
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
    // Dandelion's collection account for the test dataset (Prompt L §2.1); production sets its own through two admins.
    await putSetting(tx, "platformPayeeAccount", "TILL-DANDELION-001", adminId);
    console.log("[seed] done (minimal)");
    return { areaId: area!.id, supplierId: supplier!.id, hubId: hub!.id, productIds: { kit: kit!.id, disposable: disposable!.id }, adminIds: [admins[0]!.id, admins[1]!.id] };
  });
}

/**
 * SEED_PROFILE when set; otherwise a preview with the simulator on gets the full demo district (every page filled,
 * deliveries on the road), and everything else the minimal profile.
 */
export function seedProfileFromEnv(): SeedProfile {
  const v = process.env.SEED_PROFILE || (appEnv() === "preview" && simulatorEnabled() ? "demo" : "minimal");
  if (v !== "minimal" && v !== "demo") throw new Error(`unknown SEED_PROFILE ${v}`);
  return v;
}

/** Which profile filled this database, if our seed did ("minimal", "demo"), else null. */
export async function currentSeedProfile(): Promise<string | null> {
  const db = getDb();
  const t = await db.execute<{ n: number }>(sql`select count(*)::int as n from information_schema.tables where table_schema = 'public' and table_name = 'settings'`);
  if (!Number(t.rows[0]?.n ?? 0)) return null;
  const r = await db.execute<{ v: string | null }>(sql`select value #>> '{}' as v from settings where key = 'seedProfile'`);
  return r.rows[0]?.v ?? null;
}

/**
 * The demo profile on a build: nothing to do when the demo district is already there (every redeploy); a database
 * our own seed filled with the minimal profile — fictional people only — is wiped and moves up to the demo district.
 * wipeDatabase keeps its guards: never production, never a database that looks real. What the demo needs is checked
 * before anything is wiped, and a demo that fails half-way puts the minimal dataset back, so a preview is never left
 * empty; the reason is kept in settings.demoSeedError and shown on the admin home.
 */
export async function seedDemoProfile(): Promise<void> {
  const current = await currentSeedProfile();
  if (current === "demo") {
    // A district built before the shop existed gets its meeting points (Prompt L §3); nothing else changes.
    const { ensureDemoPlaces } = await import("@/lib/demo/shop");
    const added = await ensureDemoPlaces();
    console.log(added ? `[seed] the demo district is in place; added ${added} meeting points for the shop` : "[seed] the demo district is already in place; nothing to do");
    return;
  }
  requireSeedCredentials();
  if (!simulatorEnabled()) throw new Error("SEED_PROFILE=demo needs SIMULATOR_ENABLED=true (payments go through the mock provider's simulator)");
  try {
    if (current === "minimal") {
      console.log("[seed] replacing the minimal dataset with the demo district");
      await resetDatabase();
    }
    const { runDemoSeed } = await import("./demo/run");
    await runDemoSeed();
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    console.error(`[seed] the demo district could not be built (${reason}); putting the minimal dataset back so the preview keeps working`);
    await resetDatabase();
    await seed();
    await putSetting(getDb(), "demoSeedError", `${now().toISOString().slice(0, 16).replace("T", " ")} UTC — ${reason}`.slice(0, 400), null);
  }
}

if (process.argv[1]?.endsWith("seed.ts")) {
  (async () => {
    try {
      const profile = seedProfileFromEnv();
      if (process.env.SEED_RESET === "1") await resetDatabase();
      if (profile === "demo") {
        await seedDemoProfile();
      } else {
        await seed();
      }
      // A preview that had to derive a sign-in secret says so on the admin home (lib/seed-identities.ts).
      if (SEED_NOTES.length) {
        const note = `${SEED_NOTES.join(" and ")} ${SEED_NOTES.length > 1 ? "are" : "is"} not in base32 (letters A–Z and digits 2–7), so the admin sign-in codes on this preview come from a secret derived from ${SEED_NOTES.length > 1 ? "them" : "it"}. Use the no-sign-in demo, or set a base32 value in Vercel and redeploy`;
        console.warn(`[seed] note: ${note}`);
        await putSetting(getDb(), "seedNotice", note, null);
      }
    } catch (e) {
      console.error("[seed] failed", e);
      process.exitCode = 1;
    } finally {
      await closeDb();
    }
  })();
}
