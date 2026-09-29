import { describe, expect, it } from "vitest";
import { base32Decode, base32Encode, generateTotpSecret, hotp, totpAt, verifyTotp } from "@/lib/auth/totp";
import { afterFailedPin, loginGate, HARD_LOCK_AFTER, TEMP_LOCK_AFTER } from "@/lib/auth/lockout";
import { hashPin, verifyPin, hashCode, codeMatches } from "@/lib/auth/secrets";
import { ipAllowed } from "@/lib/security/request";

describe("TOTP", () => {
  it("RFC 6238 test vector (SHA-1, secret 12345678901234567890)", () => {
    const secret = Buffer.from("12345678901234567890", "ascii");
    // T=59 → counter 1 → 287082 (RFC 6238 Appendix B, 8-digit 94287082)
    expect(hotp(secret, 1, 8)).toBe("94287082");
    expect(hotp(secret, 1, 6)).toBe("287082");
  });
  it("base32 round-trips and secrets are 160-bit", () => {
    const s = generateTotpSecret();
    expect(base32Decode(s).length).toBe(20);
    expect(base32Encode(base32Decode(s))).toBe(s);
  });
  it("verifies within ±1 step and refuses reuse", () => {
    const s = generateTotpSecret();
    const now = new Date(1_800_000_000_000);
    const code = totpAt(s, now);
    const step = verifyTotp(s, code, now, null);
    expect(step).not.toBeNull();
    expect(verifyTotp(s, code, now, step)).toBeNull();
    expect(verifyTotp(s, totpAt(s, new Date(now.getTime() - 30_000)), now, null)).not.toBeNull();
    expect(verifyTotp(s, totpAt(s, new Date(now.getTime() - 120_000)), now, null)).toBeNull();
    expect(verifyTotp(s, "abc", now, null)).toBeNull();
  });
});

describe("PIN lockout policy (handbook §7)", () => {
  it("temporary 30-minute lock after 3 failures, hard lock after 5", () => {
    const now = new Date();
    expect(afterFailedPin(0, now)).toMatchObject({ failedCount: 1, lockedUntil: null, hardLocked: false });
    const third = afterFailedPin(TEMP_LOCK_AFTER - 1, now);
    expect(third.lockedUntil?.getTime()).toBe(now.getTime() + 30 * 60_000);
    expect(afterFailedPin(HARD_LOCK_AFTER - 1, now).hardLocked).toBe(true);
  });
  it("gate", () => {
    const now = new Date();
    expect(loginGate("ACTIVE", null, now)).toEqual({ allowed: true });
    expect(loginGate("LOCKED", null, now)).toEqual({ allowed: false, reason: "locked" });
    expect(loginGate("ACTIVE", new Date(now.getTime() + 1000), now).allowed).toBe(false);
    expect(loginGate("ACTIVE", new Date(now.getTime() - 1000), now).allowed).toBe(true);
  });
});

describe("PIN hashing (§3.15)", () => {
  it("argon2id with pepper; never reversible; wrong PIN fails", async () => {
    const { hash, pepperVersion } = await hashPin("4826");
    expect(hash.startsWith("$argon2id$")).toBe(true);
    expect(hash).not.toContain("4826");
    expect(await verifyPin(hash, pepperVersion, "4826")).toBe(true);
    expect(await verifyPin(hash, pepperVersion, "4827")).toBe(false);
    expect(await verifyPin(hash, pepperVersion, "482")).toBe(false);
    await expect(hashPin("12345")).rejects.toThrow();
  });
  it("one-time codes hash deterministically per purpose", () => {
    const h = hashCode("otp:ENROLL", "123456");
    expect(codeMatches("otp:ENROLL", "123456", h)).toBe(true);
    expect(codeMatches("otp:HANDOVER", "123456", h)).toBe(false);
  });
});

describe("IP allowlist", () => {
  it("empty allows all; CIDR and exact match", () => {
    expect(ipAllowed("1.2.3.4", [])).toBe(true);
    expect(ipAllowed("10.1.2.3", ["10.0.0.0/8"])).toBe(true);
    expect(ipAllowed("11.1.2.3", ["10.0.0.0/8"])).toBe(false);
    expect(ipAllowed("196.1.2.3", ["196.1.2.3"])).toBe(true);
    expect(ipAllowed("not-an-ip", ["0.0.0.0/0"])).toBe(false);
  });
});
