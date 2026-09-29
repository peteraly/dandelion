/**
 * Database guards shared by the seed, the pre-migration check and the demo
 * reset (Prompt B §2.8, ADR-026): never touch production, never touch a
 * database that looks real.
 */
import { sql } from "drizzle-orm";
import { databaseUrl, getDb } from "@/lib/db/client";
import { appEnv } from "@/lib/env";
import { phoneBlindIndex } from "@/lib/crypto/blind-index";
import { SEED } from "@/lib/seed-identities";

export function refuseIfProduction(): void {
  if (appEnv() === "production") throw new Error("seed refuses to run in production");
  const host = new URL(databaseUrl()).hostname;
  const prodHost = process.env.PRODUCTION_DB_HOST;
  if (prodHost && host === prodHost) throw new Error(`seed refuses to run against production host ${host}`);
  if (/prod/i.test(host) || /main/i.test(host)) throw new Error(`seed refuses to run against host ${host} (looks like production)`);
}

/**
 * Content guard: the target must not look like a real database, whatever the
 * connection string says. Every real database has people in it, and every
 * seeded person carries "(TEST)", so one person without the marker is enough
 * to refuse — unless a seed marker explains the database. Tolerates an empty
 * database and a database with no users table yet.
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
    // Databases seeded before the marker existed still carry the seed admin's fixed fake number, which no real
    // database can (no SMS could ever reach it to enrol anyone).
    const legacy = await db.execute<{ n: number }>(sql`select count(*)::int as n from users where phone_index = ${phoneBlindIndex(SEED.adminA.phone)}`);
    if (Number(legacy.rows[0]?.n ?? 0) > 0) return;
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

/** Drop everything (schema and migration history). Callers guard first; the seed re-creates the schema. */
export async function wipeDatabase(): Promise<void> {
  await assertSafeTargetDatabase();
  const db = getDb();
  // Triggers forbid TRUNCATE on append-only tables; drop and recreate the schema instead.
  await db.execute(sql`drop schema public cascade`);
  await db.execute(sql`create schema public`);
  await db.execute(sql`drop schema if exists drizzle cascade`);
}
