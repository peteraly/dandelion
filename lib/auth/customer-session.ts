/**
 * Shop sessions for customers who signed in with a code by SMS (Prompt L §3). The cookie holds a random 256-bit
 * token; the database stores only its SHA-256. Phones in a household are often shared, so a shop session ends after
 * a day without use and after a week at most, and "Sign out" is on every shop page.
 */
import { now, nowMs } from "@/lib/clock";
import { and, eq, isNull } from "drizzle-orm";
import { getDb, type DbOrTx } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import { randomToken, sha256Hex } from "@/lib/crypto/random";

export const CUSTOMER_IDLE_MS = 24 * 60 * 60_000;
export const CUSTOMER_MAX_AGE_MS = 7 * 24 * 60 * 60_000;

export async function createCustomerSession(customerId: string, db: DbOrTx = getDb()): Promise<{ token: string; expiresAt: Date }> {
  const token = randomToken();
  const expiresAt = new Date(nowMs() + CUSTOMER_MAX_AGE_MS);
  await db.insert(s.customerSessions).values({ id: sha256Hex(token), customerId, expiresAt });
  return { token, expiresAt };
}

export type ShopCustomer = typeof s.customers.$inferSelect;

export async function loadCustomerSession(token: string | undefined, at = now()): Promise<ShopCustomer | null> {
  if (!token || token.length < 20 || token.length > 100) return null;
  const db = getDb();
  const id = sha256Hex(token);
  const row = await db.query.customerSessions.findFirst({ where: and(eq(s.customerSessions.id, id), isNull(s.customerSessions.revokedAt)) });
  if (!row) return null;
  if (row.expiresAt <= at || at.getTime() - row.lastSeenAt.getTime() > CUSTOMER_IDLE_MS) {
    await db.update(s.customerSessions).set({ revokedAt: at }).where(eq(s.customerSessions.id, id));
    return null;
  }
  const customer = await db.query.customers.findFirst({ where: eq(s.customers.id, row.customerId) });
  if (!customer || customer.status !== "ACTIVE" || !customer.phoneVerifiedAt) return null;
  if (at.getTime() - row.lastSeenAt.getTime() > 60_000) {
    await db.update(s.customerSessions).set({ lastSeenAt: at }).where(eq(s.customerSessions.id, id));
  }
  return customer;
}

export async function revokeCustomerSession(token: string): Promise<void> {
  await getDb().update(s.customerSessions).set({ revokedAt: now() }).where(eq(s.customerSessions.id, sha256Hex(token)));
}

export async function revokeAllCustomerSessions(customerId: string, db: DbOrTx = getDb()): Promise<void> {
  await db.update(s.customerSessions).set({ revokedAt: now() }).where(and(eq(s.customerSessions.customerId, customerId), isNull(s.customerSessions.revokedAt)));
}
