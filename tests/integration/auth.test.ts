import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { getDb } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import { SEED } from "@/scripts/seed";
import { actors, lastSms, securityEvents, userByPhone } from "./helpers";
import {
  adminPassphraseLogin,
  adminReenrollUser,
  adminVerifyTotp,
  completeFieldEnrollment,
  createUser,
  lockWithPhoneAndPin,
  loginWithPin,
  startFieldEnrollment,
} from "@/lib/services/users";
import { loadSession } from "@/lib/auth/session";
import { totpAt } from "@/lib/auth/totp";
import { PolicyError } from "@/lib/policy";
import { DomainError } from "@/lib/services/core";

const NEW_PHONE = "+255700000077";

function linkToken(body: string): string {
  const m = body.match(/\/enroll\/([A-Za-z0-9_-]+)/);
  if (!m) throw new Error("no enroll link");
  return m[1]!;
}
function otpFrom(body: string): string {
  return body.match(/\b(\d{6})\b/)![1]!;
}

describe("users and enrollment", () => {
  it("§3.8: only admins create users", async () => {
    const { hub } = { hub: (await getDb().query.hubs.findFirst())! };
    await expect(createUser(await actors.champion(), { role: "FIELD_CHAMPION", displayName: "Nope (TEST)", phone: NEW_PHONE, hubId: hub.id, payeeAccount: "TILL-X" })).rejects.toThrow(PolicyError);
    const noMfa = { ...(await actors.adminA()), mfa: false };
    await expect(createUser(noMfa, { role: "FIELD_CHAMPION", displayName: "Nope (TEST)", phone: NEW_PHONE, hubId: hub.id, payeeAccount: "TILL-X" })).rejects.toThrow(PolicyError);
  });

  it("enrollment: admin token + phone match + SMS OTP + PIN, under a minute of steps", async () => {
    const admin = await actors.adminA();
    const hub = (await getDb().query.hubs.findFirst())!;
    const { userId } = await createUser(admin, { role: "FIELD_CHAMPION", displayName: "Champion Four (TEST)", phone: NEW_PHONE, hubId: hub.id, payeeAccount: "TILL-CHA-004" });
    const sms = await lastSms("ENROLL_LINK");
    expect(sms?.body).toContain("/enroll/");
    const token = linkToken(sms!.body);
    await expect(startFieldEnrollment(token, "+255700000078", "dev1", null)).rejects.toThrow(/enroll_phone_mismatch/);
    const { challengeId } = await startFieldEnrollment(token, NEW_PHONE, "dev1", null);
    const code = otpFrom((await lastSms("OTP"))!.body);
    await expect(completeFieldEnrollment(token, challengeId, "000000", "2580", "dev1")).rejects.toThrow(/otp_invalid/);
    // a wrong code counts against the OTP attempt limit even though the enrollment failed
    expect((await getDb().query.otpChallenges.findFirst({ where: eq(s.otpChallenges.id, challengeId) }))!.attempts).toBe(1);
    await expect(completeFieldEnrollment(token, challengeId, code, "1111", "dev1")).rejects.toThrow(/pin_too_simple/);
    const session = await completeFieldEnrollment(token, challengeId, code, "7391", "dev1");
    const loaded = await loadSession(session.sessionToken);
    expect(loaded?.user.id).toBe(userId);
    expect(loaded?.kind).toBe("FIELD");
    const u = await userByPhone(NEW_PHONE);
    expect(u.status).toBe("ACTIVE");
    expect(u.pinHash).toMatch(/^\$argon2id\$/);
    expect(u.pinHash).not.toContain("7391");
    // token is single-use
    await expect(startFieldEnrollment(token, NEW_PHONE, "dev1", null)).rejects.toThrow(/enroll_link_invalid/);
  });

  it("PIN login, lockout after 3 failures, hard lock after 5", async () => {
    const ok = await loginWithPin(NEW_PHONE, "7391", "dev1", null);
    expect(ok.ok).toBe(true);
    for (let i = 0; i < 3; i++) await loginWithPin(NEW_PHONE, "0000", "dev1", null);
    const locked = await loginWithPin(NEW_PHONE, "7391", "dev1", null);
    expect(locked).toEqual({ ok: false, error: "temporarily_locked" });
    expect((await securityEvents("PIN_TEMP_LOCKOUT")).length).toBe(1);
    // clear the temporary lock and keep failing → hard lock
    await getDb().update(s.users).set({ lockedUntil: null }).where(eq(s.users.phoneIndex, (await userByPhone(NEW_PHONE)).phoneIndex));
    await loginWithPin(NEW_PHONE, "0000", "dev1", null);
    const r = await loginWithPin(NEW_PHONE, "0000", "dev1", null);
    expect(r).toEqual({ ok: false, error: "account_locked" });
    expect((await userByPhone(NEW_PHONE)).status).toBe("LOCKED");
    // even the right PIN no longer works
    expect((await loginWithPin(NEW_PHONE, "7391", "dev1", null)).ok).toBe(false);
  });

  it("§3.15: an OTP alone can never reset a PIN; only an admin re-enrollment can", async () => {
    // No public function accepts (phone, otp, newPin). Enrollment needs an admin-issued token.
    await expect(startFieldEnrollment("not-a-token", NEW_PHONE, "dev2", null)).rejects.toThrow(/enroll_link_invalid/);
    const u = await userByPhone(NEW_PHONE);
    await expect(adminReenrollUser(await actors.champion(), u.id)).rejects.toThrow(PolicyError);
    await adminReenrollUser(await actors.adminB(), u.id);
    const after = await userByPhone(NEW_PHONE);
    expect(after.status).toBe("INVITED");
    expect(after.pinHash).toBeNull();
    const token = linkToken((await lastSms("ENROLL_LINK"))!.body);
    const { challengeId } = await startFieldEnrollment(token, NEW_PHONE, "dev2", null);
    expect((await securityEvents("OTP_NEW_DEVICE")).length).toBeGreaterThan(0);
    const code = otpFrom((await lastSms("OTP"))!.body);
    const session = await completeFieldEnrollment(token, challengeId, code, "8462", "dev2");
    expect((await loadSession(session.sessionToken))?.user.status).toBe("ACTIVE");
    expect((await securityEvents("PIN_RESET_BY_ADMIN")).length).toBe(1);
  });

  it("lost phone: lock from any device with phone + PIN; sessions revoked", async () => {
    const login = await loginWithPin(NEW_PHONE, "8462", "dev2", null);
    expect(login.ok).toBe(true);
    const token = login.ok ? login.sessionToken : "";
    expect(await lockWithPhoneAndPin(NEW_PHONE, "8462", null)).toBe(true);
    expect((await userByPhone(NEW_PHONE)).status).toBe("LOCKED");
    expect(await loadSession(token)).toBeNull();
  });

  it("sessions expire after 15 idle minutes", async () => {
    const login = await loginWithPin(SEED.riders[1]!.phone, SEED.riders[1]!.pin, "devR", null);
    expect(login.ok).toBe(true);
    const token = login.ok ? login.sessionToken : "";
    expect(await loadSession(token)).not.toBeNull();
    await getDb().execute(sql`update sessions set last_seen_at = now() - interval '16 minutes'`);
    expect(await loadSession(token)).toBeNull();
  });
});

describe("admin login (§3.16)", () => {
  it("passphrase alone gives no admin rights; TOTP completes; SMS is never a factor", async () => {
    const r = await adminPassphraseLogin(SEED.adminA.phone, SEED.adminA.passphrase, "adm1", null);
    expect(r.ok).toBe(true);
    const token = r.ok ? r.sessionToken : "";
    const session = await loadSession(token);
    expect(session?.kind).toBe("ADMIN");
    expect(session?.mfaVerified).toBe(false);
    const admin = await userByPhone(SEED.adminA.phone);
    expect(await adminVerifyTotp(admin.id, "000000", null)).toBe(false);
    expect((await securityEvents("ADMIN_2FA_FAILED")).length).toBe(1);
    const code = totpAt(SEED.adminA.totp, new Date());
    expect(await adminVerifyTotp(admin.id, code, null)).toBe(true);
    // the same code cannot be replayed
    expect(await adminVerifyTotp(admin.id, code, null)).toBe(false);
    const wrongPass = await adminPassphraseLogin(SEED.adminA.phone, "wrong-passphrase-here", "adm1", null);
    expect(wrongPass.ok).toBe(false);
    // a field user cannot use the admin login
    expect((await adminPassphraseLogin(SEED.riders[0]!.phone, "whatever-passphrase", "x", null)).ok).toBe(false);
  });

  it("a DomainError has an i18n code", () => {
    expect(new DomainError("otp_invalid").code).toBe("otp_invalid");
  });
});
