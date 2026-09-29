/**
 * Database client.
 *
 * - On Neon (host ends in neon.tech) we use Neon's serverless driver over
 *   WebSockets, which supports interactive transactions. DATABASE_URL must be
 *   the POOLED (-pooler) connection string. Never a direct connection.
 * - Elsewhere (local dev, CI) we use node-postgres.
 *
 * Both expose the same Drizzle query API; we type the handle as the
 * node-postgres variant.
 */
import { Pool as NeonPool, neonConfig } from "@neondatabase/serverless";
import { drizzle as drizzleNeon } from "drizzle-orm/neon-serverless";
import { drizzle as drizzlePg, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool as PgPool } from "pg";
import * as schema from "./schema";
import { appEnv } from "@/lib/env";

export type Db = NodePgDatabase<typeof schema>;
/** A transaction handle has the same query surface as Db. */
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export type DbOrTx = Db | Tx;

const DEV_URL = "postgres://postgres:postgres@localhost:5432/dandelion_dev";

export function databaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (url) return url;
  if (appEnv() === "development") return DEV_URL;
  throw new Error("DATABASE_URL is required");
}

export function isNeonUrl(url: string): boolean {
  try {
    return new URL(url).hostname.endsWith(".neon.tech");
  } catch {
    return false;
  }
}

type GlobalWithDb = typeof globalThis & { __dandelionDb?: { db: Db; close: () => Promise<void> } };
const g = globalThis as GlobalWithDb;

function create(): { db: Db; close: () => Promise<void> } {
  const url = databaseUrl();
  if (isNeonUrl(url)) {
    if (!new URL(url).hostname.includes("-pooler")) {
      console.warn("[db] DATABASE_URL is not a pooled (-pooler) Neon URL; use the pooled string in functions.");
    }
    if (typeof WebSocket !== "undefined") neonConfig.webSocketConstructor = WebSocket;
    const pool = new NeonPool({ connectionString: url, max: 5 });
    const db = drizzleNeon({ client: pool, schema }) as unknown as Db;
    return { db, close: () => pool.end() };
  }
  const pool = new PgPool({ connectionString: url, max: 10 });
  const db = drizzlePg({ client: pool, schema });
  return { db, close: () => pool.end() };
}

export function getDb(): Db {
  if (!g.__dandelionDb) g.__dandelionDb = create();
  return g.__dandelionDb.db;
}

export async function closeDb(): Promise<void> {
  if (g.__dandelionDb) {
    const { close } = g.__dandelionDb;
    g.__dandelionDb = undefined;
    await close();
  }
}

export { schema };
