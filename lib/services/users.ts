/**
 * Users: admin-only creation (§3.8), enrollment by admin token + SMS OTP +
 * PIN (§4.6), PIN login with lockout (§7), self-lock, and admin-only
 * re-enrollment (§3.15). Admins enroll with a passphrase + TOTP, never SMS.
 */
import { now, nowMs } from "@/lib/clock";
import { assertOpenDemoPhone } from "@/lib/security/open-demo";
import { and, eq, isNull, gt } from "drizzle-orm";
import { z } from "zod";
import { getDb, type Tx } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import { encryptString, decryptString } from "@/lib/crypto/envelope";
import { phoneBlindIndex } from "@/lib/crypto/blind-index";
import { randomToken, sha256Hex } from "@/lib/crypto/random";
import { TzPhoneSchema } from "@/lib/phone";
import { appOrigin, helpContacts } from "@/lib/env";
import { FIELD_ROLES, LOGIN_ROLES, type Role } from "@/lib/domain/types";
import { authorize, type Actor } from "@/lib/policy";
import { hashPin, verifyPin, hashPassphrase, verifyPassphrase, currentPepperVersion } from "@/lib/auth/secrets";
import { afterFailedPin, loginGate } from "@/lib/auth/lockout";
import { issueOtp, consumeOtp } from "@/lib/auth/otp";
import { createSession, revokeAllSessions } from "@/lib/auth/session";
import { generateTotpSecret, verifyTotp } from "@/lib/auth/totp";
import { getSmsProvider } from "@/lib/sms";
import { tr, type Locale } from "@/lib/i18n/server-translator";
import { DomainError, logAdminAction, logSecurityEvent, recordLedgerEvent, withTx, isUniqueViolation } from "./core";

export const ENROLL_TOKEN_TTL_MS = 72 * 60 * 60_000;

export const CreateUserSchema = z
  .object({
    role: z.enum(LOGIN_ROLES),
    displayName: z.string().trim().min(2).max(80),
    phone: TzPhoneSchema,
    serviceAreaId: z.string().uuid().optional(),
    hubId: z.string().uuid().optional(),
    supplierId: z.string().uuid().optional(),
    payoutProvider: z.enum(["MPESA", "AIRTEL", "MIXX", "HALOPESA"]).optional(),
    payeeAccount: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9-]{4,32}$/)
      .optional(),
    preferredLocale: z.enum(["sw", "en"]).optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.role === "HUB_MANAGER" && !v.hubId) ctx.addIssue({ code: "custom", path: ["hubId"], message: "hub_required" });
    if (v.role === "SUPPLIER" && !v.supplierId) ctx.addIssue({ code: "custom", path: ["supplierId"], message: "supplier_required" });
    if (v.role !== "SUPER_ADMIN" && !v.payeeAccount) {
      // Every field role sells to the next one, so each needs a payee account
      // for mobile-money collections (the routing itself is gate G1).
      ctx.addIssue({ code: "custom", path: ["payeeAccount"], message: "payee_required" });
    }
  });
export type CreateUserInput = z.input<typeof CreateUserSchema>;

function isFieldRole(r: Role): boolean {
  return (FIELD_ROLES as readonly string[]).includes(r);
}

export function enrollLink(token: string, role: Role): string {
  return `${appOrigin()}${role === "SUPER_ADMIN" ? "/admin/enroll/" : "/enroll/"}${token}`;
}

async function issueEnrollmentToken(tx: Tx, userId: string, purpose: "ENROLL" | "REENROLL", createdBy: string): Promise<string> {
  const token = randomToken();
  // Invalidate older unused tokens for this user.
  await tx
    .update(s.enrollmentTokens)
    .set({ usedAt: now() })
    .where(and(eq(s.enrollmentTokens.userId, userId), isNull(s.enrollmentTokens.usedAt)));
  await tx.insert(s.enrollmentTokens).values({
    userId,
    tokenHash: sha256Hex(token),
    purpose,
    createdBy,
    expiresAt: new Date(nowMs() + ENROLL_TOKEN_TTL_MS),
  });
  return token;
}

async function sendEnrollSms(tx: Tx, user: { displayName: string; role: Role; preferredLocale: Locale }, phone: string, token: string) {
  const body = tr(user.preferredLocale, "sms.activation", {
    name: user.displayName,
    role: tr(user.preferredLocale, `roles.${user.role}`),
    link: enrollLink(token, user.role),
    help: helpContacts().phone,
  });
  await getSmsProvider().send(phone, body, "ENROLL_LINK", tx);
}

/**
 * Only admins create users. Field users get an SMS enrollment link.
 * Admin users get a link returned to the creating admin to hand over in
 * person (SMS is never an admin factor).
 */
export async function createUser(actor: Actor, raw: CreateUserInput): Promise<{ userId: string; adminEnrollLink?: string }> {
  authorize(actor, "admin.user.create");
  const input = CreateUserSchema.parse(raw);
  assertOpenDemoPhone(actor, input.phone);
  const locale: Locale = input.preferredLocale ?? (input.role === "SUPER_ADMIN" ? "en" : "sw");
  try {
    return await withTx(async (tx) => {
      const [user] = await tx
        .insert(s.users)
        .values({
          role: input.role,
          status: "INVITED",
          displayName: input.displayName,
          phoneEnc: await encryptString(input.phone),
          phoneIndex: phoneBlindIndex(input.phone),
          serviceAreaId: input.serviceAreaId ?? null,
          hubId: input.hubId ?? null,
          supplierId: input.supplierId ?? null,
          payoutProvider: input.payoutProvider ?? null,
          payeeAccount: input.payeeAccount ?? null,
          preferredLocale: locale,
          createdBy: actor.userId,
        })
        .returning();
      const token = await issueEnrollmentToken(tx, user!.id, "ENROLL", actor.userId);
      await logAdminAction(tx, actor.userId, "user.create", { type: "user", id: user!.id }, { role: input.role });
      if (isFieldRole(input.role)) {
        await sendEnrollSms(tx, { displayName: input.displayName, role: input.role, preferredLocale: locale }, input.phone, token);
        return { userId: user!.id };
      }
      return { userId: user!.id, adminEnrollLink: enrollLink(token, input.role) };
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw new DomainError("phone_or_payee_in_use");
    throw e;
  }
}

async function findValidToken(token: string) {
  const row = await getDb().query.enrollmentTokens.findFirst({
    where: and(eq(s.enrollmentTokens.tokenHash, sha256Hex(token)), isNull(s.enrollmentTokens.usedAt), gt(s.enrollmentTokens.expiresAt, now())),
  });
  if (!row) return null;
  const user = await getDb().query.users.findFirst({ where: eq(s.users.id, row.userId) });
  if (!user || user.status === "REMOVED" || user.status === "SUSPENDED") return null;
  return { tokenRow: row, user };
}

export async function describeEnrollment(token: string): Promise<{ role: Role; displayName: string; locale: Locale } | null> {
  const found = await findValidToken(token);
  return found ? { role: found.user.role, displayName: found.user.displayName, locale: found.user.preferredLocale } : null;
}

/** Step 1 (field users): the person types their phone; it must match what the admin registered. */
export async function startFieldEnrollment(token: string, phoneRaw: string, deviceId: string | null, ip: string | null): Promise<{ challengeId: string }> {
  const found = await findValidToken(token);
  if (!found || !isFieldRole(found.user.role)) throw new DomainError("enroll_link_invalid");
  const phone = TzPhoneSchema.safeParse(phoneRaw);
  if (!phone.success || phoneBlindIndex(phone.data) !== found.user.phoneIndex) {
    await logSecurityEvent(getDb(), "ENROLL_PHONE_MISMATCH", "WARN", { userId: found.user.id, ip });
    throw new DomainError("enroll_phone_mismatch");
  }
  return withTx(async (tx) => {
    const { challengeId, code } = await issueOtp(
      { purpose: "ENROLL", phoneIndex: found.user.phoneIndex, subjectId: found.tokenRow.id, deviceId, userId: found.user.id, ip },
      tx,
    );
    await getSmsProvider().send(phone.data, tr(found.user.preferredLocale, "sms.otp", { code }), "OTP", tx);
    return { challengeId };
  });
}

/** Step 2 (field users): OTP + new PIN. Needs BOTH the admin token and the OTP. */
export async function completeFieldEnrollment(
  token: string,
  challengeId: string,
  code: string,
  pin: string,
  deviceId: string | null,
): Promise<{ sessionToken: string; expiresAt: Date; locale: Locale }> {
  const found = await findValidToken(token);
  if (!found || !isFieldRole(found.user.role)) throw new DomainError("enroll_link_invalid");
  if (!/^\d{4}$/.test(pin)) throw new DomainError("pin_format");
  if (/^(\d)\1{3}$/.test(pin) || pin === "1234" || pin === "4321") throw new DomainError("pin_too_simple");
  // Consumed outside the transaction so a wrong code still counts against the attempt limit.
  const ok = await consumeOtp({ challengeId, purpose: "ENROLL", subjectId: found.tokenRow.id, code });
  if (!ok) throw new DomainError("otp_invalid");
  return withTx(async (tx) => {
    const { hash, pepperVersion } = await hashPin(pin);
    const firstActivation = found.user.enrolledAt === null;
    await tx
      .update(s.users)
      .set({ pinHash: hash, pinPepperVersion: pepperVersion, status: "ACTIVE", failedPinCount: 0, lockedUntil: null, lockReason: null, enrolledAt: now(), updatedAt: now() })
      .where(eq(s.users.id, found.user.id));
    await tx.update(s.enrollmentTokens).set({ usedAt: now() }).where(eq(s.enrollmentTokens.id, found.tokenRow.id));
    if (firstActivation) {
      await recordLedgerEvent(tx, { type: "STAKEHOLDER_ACTIVATED", subjectRef: `U-${sha256Hex(found.user.id).slice(0, 10)}`, role: found.user.role });
    }
    const session = await createSession(found.user.id, "FIELD", { deviceId }, tx);
    return { sessionToken: session.token, expiresAt: session.expiresAt, locale: found.user.preferredLocale };
  });
}

/** Admin enrollment: passphrase + TOTP secret, confirmed by a first TOTP code. */
export async function beginAdminEnrollment(token: string): Promise<{ totpSecret: string; displayName: string }> {
  const found = await findValidToken(token);
  if (!found || found.user.role !== "SUPER_ADMIN") throw new DomainError("enroll_link_invalid");
  const secret = generateTotpSecret();
  await getDb()
    .update(s.users)
    .set({ totpSecretEnc: await encryptString(secret), totpLastStep: null })
    .where(eq(s.users.id, found.user.id));
  return { totpSecret: secret, displayName: found.user.displayName };
}

export async function completeAdminEnrollment(token: string, passphrase: string, totpCode: string): Promise<void> {
  const found = await findValidToken(token);
  if (!found || found.user.role !== "SUPER_ADMIN" || !found.user.totpSecretEnc) throw new DomainError("enroll_link_invalid");
  if (passphrase.length < 12 || passphrase.length > 200) throw new DomainError("passphrase_too_short");
  const secret = await decryptString(found.user.totpSecretEnc);
  const step = verifyTotp(secret, totpCode, now(), null);
  if (step === null) throw new DomainError("totp_invalid");
  await withTx(async (tx) => {
    await tx
      .update(s.users)
      .set({
        passphraseHash: await hashPassphrase(passphrase),
        pinPepperVersion: currentPepperVersion(),
        totpLastStep: step,
        status: "ACTIVE",
        enrolledAt: now(),
        failedPinCount: 0,
        lockedUntil: null,
      })
      .where(eq(s.users.id, found.user.id));
    await tx.update(s.enrollmentTokens).set({ usedAt: now() }).where(eq(s.enrollmentTokens.id, found.tokenRow.id));
    await logAdminAction(tx, found.user.id, "admin.enrolled", { type: "user", id: found.user.id });
  });
}

type LoginResult = { ok: true; sessionToken: string; expiresAt: Date; locale: Locale } | { ok: false; error: string };

async function recordPinFailure(user: typeof s.users.$inferSelect, ip: string | null): Promise<string> {
  const out = afterFailedPin(user.failedPinCount, now());
  await getDb()
    .update(s.users)
    .set({
      failedPinCount: out.failedCount,
      lockedUntil: out.lockedUntil,
      status: out.hardLocked ? "LOCKED" : user.status,
      lockReason: out.hardLocked ? "pin_failures" : user.lockReason,
    })
    .where(eq(s.users.id, user.id));
  await logSecurityEvent(getDb(), "PIN_FAILED", "WARN", { userId: user.id, ip, details: { count: out.failedCount } });
  if (out.hardLocked) {
    await revokeAllSessions(user.id);
    await logSecurityEvent(getDb(), "ACCOUNT_LOCKED", "ALERT", { userId: user.id, ip, details: { reason: "pin_failures" } });
    return "account_locked";
  }
  if (out.lockedUntil) {
    await logSecurityEvent(getDb(), "PIN_TEMP_LOCKOUT", "ALERT", { userId: user.id, ip });
    return "temporarily_locked";
  }
  return "login_failed";
}

/** Field login: phone + 4-digit PIN. Generic error to avoid account enumeration. */
export async function loginWithPin(phoneRaw: string, pin: string, deviceId: string | null, ip: string | null): Promise<LoginResult> {
  const phone = TzPhoneSchema.safeParse(phoneRaw);
  if (!phone.success) return { ok: false, error: "login_failed" };
  const user = await getDb().query.users.findFirst({ where: eq(s.users.phoneIndex, phoneBlindIndex(phone.data)) });
  if (!user || !isFieldRole(user.role) || !user.pinHash || user.pinPepperVersion === null) return { ok: false, error: "login_failed" };
  const gate = loginGate(user.status, user.lockedUntil, now());
  if (!gate.allowed) {
    await logSecurityEvent(getDb(), "LOGIN_WHILE_LOCKED", "WARN", { userId: user.id, ip });
    return { ok: false, error: gate.reason === "locked" ? "account_locked" : "temporarily_locked" };
  }
  if (user.status !== "ACTIVE") return { ok: false, error: "login_failed" };
  if (!(await verifyPin(user.pinHash, user.pinPepperVersion, pin))) {
    return { ok: false, error: await recordPinFailure(user, ip) };
  }
  await getDb().update(s.users).set({ failedPinCount: 0, lockedUntil: null }).where(eq(s.users.id, user.id));
  const session = await createSession(user.id, "FIELD", { deviceId });
  return { ok: true, sessionToken: session.token, expiresAt: session.expiresAt, locale: user.preferredLocale };
}

/** "Lock my account" — from any device, proving identity with phone + PIN. */
export async function lockWithPhoneAndPin(phoneRaw: string, pin: string, ip: string | null): Promise<boolean> {
  const phone = TzPhoneSchema.safeParse(phoneRaw);
  if (!phone.success) return false;
  const user = await getDb().query.users.findFirst({ where: eq(s.users.phoneIndex, phoneBlindIndex(phone.data)) });
  if (!user || !isFieldRole(user.role) || !user.pinHash || user.pinPepperVersion === null) return false;
  if (!(await verifyPin(user.pinHash, user.pinPepperVersion, pin))) {
    if (user.status === "ACTIVE") await recordPinFailure(user, ip);
    return false;
  }
  await lockUser(user.id, "self_lock", null, ip);
  return true;
}

export async function lockUser(userId: string, reason: string, adminId: string | null, ip: string | null = null): Promise<void> {
  await withTx(async (tx) => {
    await tx.update(s.users).set({ status: "LOCKED", lockReason: reason, updatedAt: now() }).where(eq(s.users.id, userId));
    await revokeAllSessions(userId, tx);
    await logSecurityEvent(tx, "ACCOUNT_LOCKED", "ALERT", { userId, ip, details: { reason, by: adminId ? "admin" : "self" } });
    if (adminId) await logAdminAction(tx, adminId, "user.lock", { type: "user", id: userId }, { reason });
  });
}

export async function adminLockUser(actor: Actor, userId: string, reason: string): Promise<void> {
  authorize(actor, "admin.user.lock");
  if (userId === actor.userId) throw new DomainError("cannot_lock_self_admin");
  await lockUser(userId, reason.slice(0, 200) || "admin_lock", actor.userId);
}

export async function adminSuspendUser(actor: Actor, userId: string, suspend: boolean): Promise<void> {
  authorize(actor, "admin.user.suspend");
  if (userId === actor.userId) throw new DomainError("cannot_lock_self_admin");
  await withTx(async (tx) => {
    await tx.update(s.users).set({ status: suspend ? "SUSPENDED" : "LOCKED", updatedAt: now() }).where(eq(s.users.id, userId));
    await revokeAllSessions(userId, tx);
    await logAdminAction(tx, actor.userId, suspend ? "user.suspend" : "user.unsuspend", { type: "user", id: userId });
  });
}

/**
 * PIN reset / re-enrollment (§3.15). Only an admin can start it; it clears
 * the PIN, revokes sessions, and sends a fresh enrollment link. The user
 * still needs the SMS OTP, but the OTP alone can never reset a PIN.
 */
export async function adminReenrollUser(actor: Actor, userId: string): Promise<{ adminEnrollLink?: string }> {
  authorize(actor, "admin.user.reenroll");
  return withTx(async (tx) => {
    const user = await tx.query.users.findFirst({ where: eq(s.users.id, userId) });
    if (!user || user.status === "REMOVED") throw new DomainError("not_found");
    if (user.id === actor.userId) throw new DomainError("cannot_reenroll_self");
    await tx
      .update(s.users)
      .set({ status: "INVITED", pinHash: null, pinPepperVersion: null, passphraseHash: null, totpSecretEnc: null, failedPinCount: 0, lockedUntil: null, lockReason: null, updatedAt: now() })
      .where(eq(s.users.id, userId));
    if (user.role === "SUPER_ADMIN") await tx.delete(s.webauthnCredentials).where(eq(s.webauthnCredentials.userId, userId));
    await revokeAllSessions(userId, tx);
    const token = await issueEnrollmentToken(tx, userId, "REENROLL", actor.userId);
    await logAdminAction(tx, actor.userId, "user.reenroll", { type: "user", id: userId });
    await logSecurityEvent(tx, "PIN_RESET_BY_ADMIN", "WARN", { userId, details: { admin: actor.userId } });
    if (isFieldRole(user.role)) {
      await sendEnrollSms(tx, user, await decryptString(user.phoneEnc), token);
      return {};
    }
    return { adminEnrollLink: enrollLink(token, user.role) };
  });
}

// ---------- admin login ----------

export async function adminPassphraseLogin(phoneRaw: string, passphrase: string, deviceId: string | null, ip: string | null): Promise<LoginResult> {
  const phone = TzPhoneSchema.safeParse(phoneRaw);
  if (!phone.success) return { ok: false, error: "login_failed" };
  const user = await getDb().query.users.findFirst({ where: eq(s.users.phoneIndex, phoneBlindIndex(phone.data)) });
  if (!user || user.role !== "SUPER_ADMIN" || !user.passphraseHash) return { ok: false, error: "login_failed" };
  const gate = loginGate(user.status, user.lockedUntil, now());
  if (!gate.allowed) return { ok: false, error: gate.reason === "locked" ? "account_locked" : "temporarily_locked" };
  if (user.status !== "ACTIVE") return { ok: false, error: "login_failed" };
  if (!(await verifyPassphrase(user.passphraseHash, passphrase, user.pinPepperVersion ?? currentPepperVersion()))) {
    return { ok: false, error: await recordPinFailure(user, ip) };
  }
  // Session exists but carries no admin rights until the second factor passes.
  const session = await createSession(user.id, "ADMIN", { deviceId, mfaVerified: false });
  return { ok: true, sessionToken: session.token, expiresAt: session.expiresAt, locale: user.preferredLocale };
}

export async function adminVerifyTotp(userId: string, code: string, ip: string | null): Promise<boolean> {
  const user = await getDb().query.users.findFirst({ where: eq(s.users.id, userId) });
  if (!user || user.role !== "SUPER_ADMIN" || !user.totpSecretEnc) return false;
  const step = verifyTotp(await decryptString(user.totpSecretEnc), code, now(), user.totpLastStep);
  if (step === null) {
    await logSecurityEvent(getDb(), "ADMIN_2FA_FAILED", "ALERT", { userId, ip, details: { factor: "totp" } });
    await recordPinFailure(user, ip);
    return false;
  }
  await getDb().update(s.users).set({ totpLastStep: step, failedPinCount: 0, lockedUntil: null }).where(eq(s.users.id, userId));
  return true;
}

export async function getUserPhone(userId: string): Promise<string | null> {
  const u = await getDb().query.users.findFirst({ where: eq(s.users.id, userId) });
  return u ? decryptString(u.phoneEnc) : null;
}
