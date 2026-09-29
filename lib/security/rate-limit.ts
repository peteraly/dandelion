/**
 * Fixed-window rate limiting stored in Postgres (no extra infrastructure;
 * works across serverless instances). Pilot-scale traffic only.
 */
import { sql } from "drizzle-orm";
import { getDb, type DbOrTx } from "@/lib/db/client";

export interface RateLimitResult {
  allowed: boolean;
  count: number;
  limit: number;
}

export async function hitRateLimit(key: string, limit: number, windowSeconds: number, db: DbOrTx = getDb()): Promise<RateLimitResult> {
  const rows = await db.execute<{ count: number }>(sql`
    insert into rate_limits (key, window_start, count) values (${key}, now(), 1)
    on conflict (key) do update set
      count = case when rate_limits.window_start < now() - make_interval(secs => ${windowSeconds}) then 1 else rate_limits.count + 1 end,
      window_start = case when rate_limits.window_start < now() - make_interval(secs => ${windowSeconds}) then now() else rate_limits.window_start end
    returning count
  `);
  const count = Number(rows.rows[0]?.count ?? 1);
  return { allowed: count <= limit, count, limit };
}
