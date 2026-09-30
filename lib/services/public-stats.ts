/**
 * Public aggregate statistics: weekly only, counts under 10 suppressed
 * (returned as null → "fewer than 10").
 */
import { and, eq, gte, inArray, sql } from "drizzle-orm";
import { PLAN_KINDS } from "@/lib/domain/sales";
import { getDb } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import { tzWeekStart } from "@/lib/util/time";

const suppress = (n: number): number | null => (n < 10 ? null : n);

export async function publicWeeklyStats(): Promise<{ handovers: number | null; activeChampions: number | null; weekStart: string }> {
  const db = getDb();
  const weekStart = tzWeekStart();
  const [h] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(s.orders)
    .where(and(inArray(s.orders.kind, [...PLAN_KINDS]), eq(s.orders.state, "COMPLETED"), gte(s.orders.completedAt, weekStart)));
  const [c] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(s.users)
    .where(and(eq(s.users.role, "FIELD_CHAMPION"), eq(s.users.status, "ACTIVE")));
  return { handovers: suppress(Number(h?.n ?? 0)), activeChampions: suppress(Number(c?.n ?? 0)), weekStart: weekStart.toISOString().slice(0, 10) };
}
