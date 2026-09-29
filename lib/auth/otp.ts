/**
 * SMS one-time codes: phone confirmation at enrollment, customer phone
 * verification, and customer handover confirmation. An OTP alone NEVER
 * resets a PIN (§3.15): enrollment also needs an admin-issued token.
 *
 * Security events: every OTP request is logged; bursts and new devices alert.
 */
import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";
import { getDb, type DbOrTx } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import { numericCode } from "@/lib/crypto/random";
import { codeMatches, hashCode } from "./secrets";
import { logSecurityEvent, DomainError } from "@/lib/services/core";

export const OTP_TTL_MS = 5 * 60_000;
export const OTP_MAX_ATTEMPTS = 5;
export const OTP_MAX_PER_WINDOW = 3;
export const OTP_WINDOW_MS = 15 * 60_000;

export type OtpPurpose = "ENROLL" | "CUSTOMER_VERIFY" | "HANDOVER";

export async function issueOtp(
  opts: { purpose: OtpPurpose; phoneIndex: string; subjectId: string | null; deviceId: string | null; userId?: string | null; ip?: string | null },
  db: DbOrTx = getDb(),
): Promise<{ challengeId: string; code: string }> {
  const since = new Date(Date.now() - OTP_WINDOW_MS);
  const recent = await db
    .select({ n: sql<number>`count(*)::int`, devices: sql<string[]>`array_agg(distinct device_id)` })
    .from(s.otpChallenges)
    .where(and(eq(s.otpChallenges.phoneIndex, opts.phoneIndex), gt(s.otpChallenges.createdAt, since)));
  const n = recent[0]?.n ?? 0;
  if (n >= OTP_MAX_PER_WINDOW) {
    // Logged outside any caller transaction: the throw below would roll it back.
    await logSecurityEvent(getDb(), "OTP_BURST", "ALERT", { userId: opts.userId, subjectIndex: opts.phoneIndex, ip: opts.ip, details: { purpose: opts.purpose, count: n + 1 } });
    throw new DomainError("otp_rate_limited");
  }
  // New-device alert: an enrollment OTP from a device never seen for this phone.
  if (opts.purpose === "ENROLL" && opts.deviceId) {
    const seen = await db.query.otpChallenges.findFirst({
      where: and(eq(s.otpChallenges.phoneIndex, opts.phoneIndex), eq(s.otpChallenges.deviceId, opts.deviceId)),
    });
    const anyPrior = await db.query.otpChallenges.findFirst({ where: eq(s.otpChallenges.phoneIndex, opts.phoneIndex) });
    if (!seen && anyPrior) {
      await logSecurityEvent(db, "OTP_NEW_DEVICE", "ALERT", { userId: opts.userId, subjectIndex: opts.phoneIndex, ip: opts.ip, details: { purpose: opts.purpose } });
    }
  }
  const code = numericCode(6);
  const [row] = await db
    .insert(s.otpChallenges)
    .values({
      purpose: opts.purpose,
      phoneIndex: opts.phoneIndex,
      subjectId: opts.subjectId,
      codeHash: hashCode(`otp:${opts.purpose}`, code),
      deviceId: opts.deviceId,
      expiresAt: new Date(Date.now() + OTP_TTL_MS),
    })
    .returning({ id: s.otpChallenges.id });
  await logSecurityEvent(db, "OTP_REQUESTED", "INFO", { userId: opts.userId, subjectIndex: opts.phoneIndex, ip: opts.ip, details: { purpose: opts.purpose } });
  return { challengeId: row!.id, code };
}

/** Verify and consume. Returns false on any failure (wrong, expired, used, too many tries). */
export async function consumeOtp(
  opts: { challengeId: string; purpose: OtpPurpose; subjectId: string | null; code: string },
  db: DbOrTx = getDb(),
): Promise<boolean> {
  const ch = await db.query.otpChallenges.findFirst({
    where: and(eq(s.otpChallenges.id, opts.challengeId), eq(s.otpChallenges.purpose, opts.purpose), isNull(s.otpChallenges.consumedAt)),
  });
  if (!ch || ch.expiresAt < new Date() || ch.attempts >= OTP_MAX_ATTEMPTS) return false;
  if (opts.subjectId !== null && ch.subjectId !== opts.subjectId) return false;
  if (!/^\d{6}$/.test(opts.code) || !codeMatches(`otp:${opts.purpose}`, opts.code, ch.codeHash)) {
    await db.update(s.otpChallenges).set({ attempts: ch.attempts + 1 }).where(eq(s.otpChallenges.id, ch.id));
    return false;
  }
  const updated = await db
    .update(s.otpChallenges)
    .set({ consumedAt: new Date() })
    .where(and(eq(s.otpChallenges.id, ch.id), isNull(s.otpChallenges.consumedAt)))
    .returning({ id: s.otpChallenges.id });
  return updated.length === 1;
}

export async function latestChallengeFor(subjectId: string, purpose: OtpPurpose, db: DbOrTx = getDb()) {
  return db.query.otpChallenges.findFirst({
    where: and(eq(s.otpChallenges.subjectId, subjectId), eq(s.otpChallenges.purpose, purpose)),
    orderBy: desc(s.otpChallenges.createdAt),
  });
}
