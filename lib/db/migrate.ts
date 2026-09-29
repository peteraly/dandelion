import path from "node:path";
import { migrate as migratePg } from "drizzle-orm/node-postgres/migrator";
import { migrate as migrateNeon } from "drizzle-orm/neon-serverless/migrator";
import { databaseUrl, getDb, isNeonUrl } from "./client";

/** Apply forward-only migrations from ./drizzle. */
export async function runMigrations(): Promise<void> {
  const migrationsFolder = path.join(process.cwd(), "drizzle");
  const db = getDb();
  if (isNeonUrl(databaseUrl())) {
    await migrateNeon(db as never, { migrationsFolder });
  } else {
    await migratePg(db, { migrationsFolder });
  }
}
