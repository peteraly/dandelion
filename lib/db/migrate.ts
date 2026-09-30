import path from "node:path";
import { sql } from "drizzle-orm";
import { migrate as migratePg } from "drizzle-orm/node-postgres/migrator";
import { migrate as migrateNeon } from "drizzle-orm/neon-serverless/migrator";
import { databaseUrl, getDb, isNeonUrl } from "./client";

/**
 * A public schema wiped by hand ("drop schema public cascade") leaves Drizzle's
 * journal (schema `drizzle`) behind: the migrator then believes every
 * migration is applied, creates nothing, and the seed fails on an empty
 * database. When the journal exists but the app's tables do not, forget the
 * journal so the migrations run again. A database holding the app's tables is
 * never touched.
 */
export async function forgetJournalIfSchemaMissing(): Promise<boolean> {
  const db = getDb();
  const r = await db.execute<{ journal: boolean; users: boolean }>(sql`
    select to_regclass('drizzle.__drizzle_migrations') is not null as journal, to_regclass('public.users') is not null as users`);
  const row = r.rows[0];
  if (row?.journal && !row.users) {
    console.warn("[migrate] migration journal found but the app's tables are missing (public schema wiped); re-applying every migration");
    await db.execute(sql`drop schema drizzle cascade`);
    return true;
  }
  return false;
}

/** Apply forward-only migrations from ./drizzle. */
export async function runMigrations(): Promise<void> {
  const migrationsFolder = path.join(process.cwd(), "drizzle");
  await forgetJournalIfSchemaMissing();
  const db = getDb();
  if (isNeonUrl(databaseUrl())) {
    await migrateNeon(db as never, { migrationsFolder });
  } else {
    await migratePg(db, { migrationsFolder });
  }
}
