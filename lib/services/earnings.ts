/**
 * What a stakeholder earned (prompt §8.8.1): payments the provider confirmed
 * to them, minus what they paid their own sellers, in a window. Never
 * "expected" money — pending intents count for nothing.
 */
import { and, eq, gte, sql } from "drizzle-orm";
import type { DbOrTx } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import { tzMonthStart, tzWeekStart } from "@/lib/util/time";

export interface Earnings {
  weekTzs: number;
  monthTzs: number;
  receivedWeekTzs: number;
  paidWeekTzs: number;
  receivedMonthTzs: number;
  paidMonthTzs: number;
}

/** Pure arithmetic: earned = received − paid, per window. */
export function earned(received: number, paid: number): number {
  return received - paid;
}

export async function earningsFor(db: DbOrTx, userId: string): Promise<Earnings> {
  const since = tzMonthStart();
  const weekStart = tzWeekStart();
  const received = await db
    .select({ tzs: s.paymentIntents.confirmedAmountTzs, at: s.paymentIntents.confirmedAt })
    .from(s.paymentIntents)
    .where(and(eq(s.paymentIntents.payeeUserId, userId), eq(s.paymentIntents.status, "PAYMENT_CONFIRMED"), gte(s.paymentIntents.confirmedAt, since)));
  const paid = await db
    .select({ tzs: s.paymentIntents.confirmedAmountTzs, at: s.paymentIntents.confirmedAt })
    .from(s.paymentIntents)
    .innerJoin(s.orders, eq(s.orders.id, s.paymentIntents.orderId))
    .where(and(eq(s.orders.buyerUserId, userId), eq(s.paymentIntents.status, "PAYMENT_CONFIRMED"), gte(s.paymentIntents.confirmedAt, since)));
  const sum = (rows: { tzs: number | null; at: Date | null }[], from: Date) => rows.reduce((a, r) => a + (r.at && r.at >= from ? (r.tzs ?? 0) : 0), 0);
  const rw = sum(received, weekStart);
  const pw = sum(paid, weekStart);
  const rm = sum(received, since);
  const pm = sum(paid, since);
  return { weekTzs: earned(rw, pw), monthTzs: earned(rm, pm), receivedWeekTzs: rw, paidWeekTzs: pw, receivedMonthTzs: rm, paidMonthTzs: pm };
}

/** Confirmed money received per user in a window, for the ecosystem nodes; one query. */
export async function receivedByUserSince(db: DbOrTx, since: Date): Promise<Map<string, number>> {
  const rows = await db
    .select({ userId: s.paymentIntents.payeeUserId, tzs: sql<number>`coalesce(sum(${s.paymentIntents.confirmedAmountTzs}), 0)::int` })
    .from(s.paymentIntents)
    .where(and(eq(s.paymentIntents.status, "PAYMENT_CONFIRMED"), gte(s.paymentIntents.confirmedAt, since)))
    .groupBy(s.paymentIntents.payeeUserId);
  return new Map(rows.map((r) => [r.userId, Number(r.tzs)]));
}

export async function paidByUserSince(db: DbOrTx, since: Date): Promise<Map<string, number>> {
  const rows = await db
    .select({ userId: s.orders.buyerUserId, tzs: sql<number>`coalesce(sum(${s.paymentIntents.confirmedAmountTzs}), 0)::int` })
    .from(s.paymentIntents)
    .innerJoin(s.orders, eq(s.orders.id, s.paymentIntents.orderId))
    .where(and(eq(s.paymentIntents.status, "PAYMENT_CONFIRMED"), gte(s.paymentIntents.confirmedAt, since)))
    .groupBy(s.orders.buyerUserId);
  return new Map(rows.filter((r) => r.userId).map((r) => [r.userId!, Number(r.tzs)]));
}
