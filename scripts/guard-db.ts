/**
 * Pre-migration guard for non-production builds (Prompt B §2.8): refuses to
 * touch a database that looks real — anyone without "(TEST)" in their name,
 * or ledger events no seed run explains — so a preview whose DATABASE_URL
 * points at production can neither migrate nor seed it. Tolerates an empty
 * database. Called by scripts/predeploy.ts; safe to run by hand.
 */
import { closeDb, databaseUrl } from "@/lib/db/client";
import { assertSafeTargetDatabase } from "./seed";

(async () => {
  const host = new URL(databaseUrl()).hostname;
  try {
    await assertSafeTargetDatabase();
    console.log(`[guard-db] ok — ${host} is empty or holds test data only`);
  } catch (e) {
    console.error(`[guard-db] refused for ${host}:`, e instanceof Error ? e.message : e);
    process.exitCode = 1;
  } finally {
    await closeDb();
  }
})();
