import { runMigrations } from "@/lib/db/migrate";
import { closeDb, databaseUrl } from "@/lib/db/client";

async function main() {
  const host = new URL(databaseUrl()).hostname;
  console.log(`[migrate] applying migrations to ${host}`);
  await runMigrations();
  console.log("[migrate] done");
  await closeDb();
}

main().catch(async (e) => {
  console.error("[migrate] failed", e);
  await closeDb();
  process.exit(1);
});
