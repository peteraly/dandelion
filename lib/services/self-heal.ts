/**
 * Things that clear themselves, so nobody has to (Prompt M, founders 2026-10-01: "nothing done by hand if possible").
 *
 * - A payment someone said they made that never arrived: after `paymentClaimLapseHours` the claim lapses, the payer
 *   gets one SMS, and the order simply waits for payment again. If the money arrives later it is matched as usual,
 *   because the payment request stays open. Nothing reaches an admin.
 * - A phone that joined the shop but never confirmed its code: forgotten after 7 days (name and number erased).
 */
import { and, eq, isNotNull, isNull, lt, notExists, sql } from "drizzle-orm";
import { now, nowMs } from "@/lib/clock";
import { getDb } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import { decryptString } from "@/lib/crypto/envelope";
import { getSmsProvider } from "@/lib/sms";
import { tr, type Locale } from "@/lib/i18n/server-translator";
import { getSetting } from "./core";

const HOUR = 3_600_000;

export async function lapseStaleClaims(): Promise<{ lapsed: number }> {
  const db = getDb();
  const hours = Number(await getSetting("paymentClaimLapseHours"));
  if (hours <= 0) return { lapsed: 0 };
  const stale = await db
    .select({ i: s.paymentIntents, o: s.orders })
    .from(s.paymentIntents)
    .innerJoin(s.orders, eq(s.orders.id, s.paymentIntents.orderId))
    .where(and(eq(s.paymentIntents.status, "PAYMENT_PENDING"), isNotNull(s.paymentIntents.payerClaimedAt), lt(s.paymentIntents.payerClaimedAt, new Date(nowMs() - hours * HOUR))))
    .limit(500);
  let lapsed = 0;
  for (const { i, o } of stale) {
    await db.transaction(async (tx) => {
      const r = await tx
        .update(s.paymentIntents)
        .set({ payerClaimedAt: null, updatedAt: now() })
        .where(and(eq(s.paymentIntents.id, i.id), eq(s.paymentIntents.status, "PAYMENT_PENDING"), isNotNull(s.paymentIntents.payerClaimedAt)));
      if (!r.rowCount) return;
      const payer = await payerContact(tx, i, o);
      if (payer) {
        const body = tr(payer.locale, "sms.claimLapsed", { name: payer.name, ref: o.ref, payee: i.payeeAccount, reference: o.paymentRef });
        await getSmsProvider().send(payer.phone, body, "NOTICE", tx);
      }
      lapsed++;
    });
  }
  return { lapsed };
}

type Db = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];

async function payerContact(tx: Db, i: typeof s.paymentIntents.$inferSelect, o: typeof s.orders.$inferSelect): Promise<{ name: string; phone: string; locale: Locale } | null> {
  if (i.payerCustomerId ?? o.customerId) {
    const c = await tx.query.customers.findFirst({ where: eq(s.customers.id, (i.payerCustomerId ?? o.customerId)!) });
    if (!c || c.status !== "ACTIVE") return null;
    return { name: c.displayName.split(" ")[0] ?? "", phone: await decryptString(c.phoneEnc), locale: "sw" };
  }
  const userId = i.payerUserId ?? o.buyerUserId;
  if (!userId) return null;
  const u = await tx.query.users.findFirst({ where: eq(s.users.id, userId) });
  if (!u || u.status !== "ACTIVE") return null;
  return { name: u.displayName.split(" ")[0] ?? "", phone: await decryptString(u.phoneEnc), locale: u.preferredLocale };
}

/** Shop numbers that never confirmed their code: erased after 7 days, as a deleted customer is (the row stays for references). */
export async function forgetUnconfirmedShopNumbers(): Promise<{ forgotten: number }> {
  const db = getDb();
  const cutoff = new Date(nowMs() - 7 * 24 * HOUR);
  const rows = await db
    .select({ id: s.customers.id })
    .from(s.customers)
    .where(
      and(
        eq(s.customers.selfRegistered, true),
        isNull(s.customers.phoneVerifiedAt),
        eq(s.customers.status, "ACTIVE"),
        lt(s.customers.createdAt, cutoff),
        notExists(db.select({ x: sql`1` }).from(s.customerRequests).where(eq(s.customerRequests.customerId, s.customers.id))),
        notExists(db.select({ x: sql`1` }).from(s.orders).where(eq(s.orders.customerId, s.customers.id))),
      ),
    )
    .limit(1000);
  for (const r of rows) {
    const tomb = `forgotten-${crypto.randomUUID()}`;
    await db.update(s.customers).set({ displayName: "[unconfirmed]", phoneEnc: tomb, phoneIndex: tomb, status: "DELETED", meetingPointId: null, updatedAt: now() }).where(eq(s.customers.id, r.id));
  }
  return { forgotten: rows.length };
}
