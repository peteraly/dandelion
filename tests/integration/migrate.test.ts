/**
 * A public schema dropped by hand, with Drizzle's journal left behind, must
 * not leave the next build with an empty database (found on the preview,
 * 2026-09-30): the migration step forgets the stale journal and re-applies
 * everything; a populated database is never touched.
 */
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { getDb } from "@/lib/db/client";
import { forgetJournalIfSchemaMissing, runMigrations } from "@/lib/db/migrate";

async function hasUsersTable(): Promise<boolean> {
  const r = await getDb().execute<{ ok: boolean }>(sql`select to_regclass('public.users') is not null as ok`);
  return !!r.rows[0]?.ok;
}

describe("migrations after a hand-wiped schema", () => {
  it("leaves a populated database alone", async () => {
    expect(await hasUsersTable()).toBe(true);
    expect(await forgetJournalIfSchemaMissing()).toBe(false);
  });

  it("re-applies every migration when only the public schema was dropped", async () => {
    await getDb().execute(sql`drop schema public cascade`);
    await getDb().execute(sql`create schema public`);
    expect(await hasUsersTable()).toBe(false);
    await runMigrations();
    expect(await hasUsersTable()).toBe(true);
    const r = await getDb().execute<{ n: number }>(sql`select count(*)::int as n from drizzle.__drizzle_migrations`);
    expect(r.rows[0]!.n).toBeGreaterThanOrEqual(5);
  });
});
