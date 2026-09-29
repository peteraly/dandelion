/**
 * Fixed-window rate limiting stored in Postgres (no extra infrastructure;
 * works across serverless instances). Pilot-scale traffic only.
 */
import { sql } from "drizzle-orm";
import { now } from "@/lib/clock";
import { getDb, type DbOrTx } from "@/lib/db/client";

export interface RateLimitResult {
  allowed: boolean;
  count: number;
  limit: number;
}

export async function hitRateLimit(key: string, limit: number, windowSeconds: number, db: DbOrTx = getDb()): Promise<RateLimitResult> {
  // Windows follow the application clock (ADR-024), not the database's, so seeded history stays consistent.
  const at = now();
  const rows = await db.execute<{ count: number }>(sql`
    insert into rate_limits (key, window_start, count) values (${key}, ${at}::timestamptz, 1)
    on conflict (key) do update set
      count = case when rate_limits.window_start < ${at}::timestamptz - make_interval(secs => ${windowSeconds}) then 1 else rate_limits.count + 1 end,
      window_start = case when rate_limits.window_start < ${at}::timestamptz - make_interval(secs => ${windowSeconds}) then ${at}::timestamptz else rate_limits.window_start end
    returning count
  `);
  const count = Number(rows.rows[0]?.count ?? 1);
  return { allowed: count <= limit, count, limit };
}
