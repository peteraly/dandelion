/**
 * Customers (handbook §8D enrollment rule): name or preferred name, verified
 * phone, chosen product category, consent — and nothing else. Customers never
 * log in. Phone verification by SMS OTP (§7 security controls).
 */
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import { encryptString, decryptString } from "@/lib/crypto/envelope";
import { phoneBlindIndex } from "@/lib/crypto/blind-index";
import { TzPhoneSchema } from "@/lib/phone";
import { authorize, type Actor } from "@/lib/policy";
import { issueOtp, consumeOtp } from "@/lib/auth/otp";
import { getSmsProvider } from "@/lib/sms";
import { tr } from "@/lib/i18n/server-translator";
import { DomainError, withTx, isUniqueViolation } from "./core";

export const PRIVACY_NOTICE_VERSION = "2026-09-v1";

export const CreateCustomerSchema = z
  .object({
    displayName: z.string().trim().min(1).max(60),
    phone: TzPhoneSchema,
    consentMessages: z.literal(true, { error: "consent_required" }),
    consentReminders: z.boolean(),
  })
  .strict();

export async function createCustomer(actor: Actor, raw: z.input<typeof CreateCustomerSchema>, deviceId: string | null, ip: string | null): Promise<{ customerId: string; challengeId: string }> {
  authorize(actor, "customer.create");
  const input = CreateCustomerSchema.parse(raw);
  const champion = await getDb().query.users.findFirst({ where: eq(s.users.id, actor.userId) });
  try {
    return await withTx(async (tx) => {
      const [c] = await tx
        .insert(s.customers)
        .values({
          championId: actor.userId,
          displayName: input.displayName,
          phoneEnc: await encryptString(input.phone),
          phoneIndex: phoneBlindIndex(input.phone),
          serviceAreaId: champion?.serviceAreaId ?? null,
        })
        .returning();
      await tx.insert(s.consentRecords).values([
        { customerId: c!.id, kind: "TRANSACTION_MESSAGES", granted: true, noticeVersion: PRIVACY_NOTICE_VERSION, recordedBy: actor.userId },
        { customerId: c!.id, kind: "REMINDERS", granted: input.consentReminders, noticeVersion: PRIVACY_NOTICE_VERSION, recordedBy: actor.userId },
      ]);
      const { challengeId, code } = await issueOtp({ purpose: "CUSTOMER_VERIFY", phoneIndex: c!.phoneIndex, subjectId: c!.id, deviceId, userId: actor.userId, ip }, tx);
      await getSmsProvider().send(input.phone, tr("sw", "sms.otp", { code }), "OTP", tx);
      return { customerId: c!.id, challengeId };
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw new DomainError("customer_phone_in_use");
    throw e;
  }
}

export async function resendCustomerOtp(actor: Actor, customerId: string, deviceId: string | null, ip: string | null): Promise<{ challengeId: string }> {
  const c = await getDb().query.customers.findFirst({ where: eq(s.customers.id, customerId) });
  if (!c) throw new DomainError("not_found");
  authorize(actor, "customer.view", { type: "customer", customer: { championId: c.championId } });
  if (c.phoneVerifiedAt) throw new DomainError("already_verified");
  return withTx(async (tx) => {
    const { challengeId, code } = await issueOtp({ purpose: "CUSTOMER_VERIFY", phoneIndex: c.phoneIndex, subjectId: c.id, deviceId, userId: actor.userId, ip }, tx);
    await getSmsProvider().send(await decryptString(c.phoneEnc), tr("sw", "sms.otp", { code }), "OTP", tx);
    return { challengeId };
  });
}

export async function verifyCustomerPhone(actor: Actor, customerId: string, challengeId: string, code: string): Promise<void> {
  const c = await getDb().query.customers.findFirst({ where: eq(s.customers.id, customerId) });
  if (!c) throw new DomainError("not_found");
  authorize(actor, "customer.view", { type: "customer", customer: { championId: c.championId } });
  // Consumed outside any transaction so a wrong code still counts against the attempt limit.
  const ok = await consumeOtp({ challengeId, purpose: "CUSTOMER_VERIFY", subjectId: c.id, code });
  if (!ok) throw new DomainError("otp_invalid");
  await getDb().update(s.customers).set({ phoneVerifiedAt: new Date(), updatedAt: new Date() }).where(eq(s.customers.id, c.id));
}

export async function myCustomers(actor: Actor) {
  authorize(actor, "customer.create");
  return getDb().query.customers.findMany({
    where: and(eq(s.customers.championId, actor.userId), eq(s.customers.status, "ACTIVE")),
    orderBy: desc(s.customers.createdAt),
    limit: 100,
  });
}
