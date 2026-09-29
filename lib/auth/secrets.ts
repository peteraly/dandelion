/**
 * Hashing of PINs, admin passphrases, and one-time codes (invariant §3.15).
 *
 * PINs and passphrases: argon2id with a server-side pepper (argon2 "secret").
 * Never encrypted, never stored in plain text. The pepper is versioned so it
 * can be rotated: new hashes use the current version; verification uses the
 * version stored next to the hash (see README "Rotate secrets").
 */
import { hash, verify } from "@node-rs/argon2";
import { createHmac } from "node:crypto";
import { secret, optionalSecret } from "@/lib/env";
import { safeEqual } from "@/lib/crypto/random";

const ARGON2ID = 2; // Algorithm.Argon2id (const enum in the typings)
// OWASP-recommended argon2id profile (m=19 MiB, t=2, p=1).
const PARAMS = { algorithm: ARGON2ID, memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

export function currentPepperVersion(): number {
  return Number.parseInt(process.env.PIN_PEPPER_VERSION ?? "1", 10);
}

function pepperFor(version: number): Buffer {
  if (version === currentPepperVersion()) return Buffer.from(secret("PIN_PEPPER", "dev-only-pin-pepper"), "utf8");
  const prev = optionalSecret("PIN_PEPPER_PREVIOUS");
  if (prev && version === currentPepperVersion() - 1) return Buffer.from(prev, "utf8");
  throw new Error(`No pepper configured for version ${version}`);
}

export const PinSchemaRegex = /^\d{4}$/;

export async function hashPin(pin: string): Promise<{ hash: string; pepperVersion: number }> {
  if (!PinSchemaRegex.test(pin)) throw new Error("PIN must be 4 digits");
  const v = currentPepperVersion();
  return { hash: await hash(pin, { ...PARAMS, secret: pepperFor(v) }), pepperVersion: v };
}

export async function verifyPin(stored: string, pepperVersion: number, pin: string): Promise<boolean> {
  if (!PinSchemaRegex.test(pin)) return false;
  try {
    return await verify(stored, pin, { secret: pepperFor(pepperVersion) });
  } catch {
    return false;
  }
}

export async function hashPassphrase(pass: string): Promise<string> {
  return hash(pass, { ...PARAMS, secret: pepperFor(currentPepperVersion()) });
}

export async function verifyPassphrase(stored: string, pass: string, pepperVersion = currentPepperVersion()): Promise<boolean> {
  try {
    return await verify(stored, pass, { secret: pepperFor(pepperVersion) });
  } catch {
    return false;
  }
}

/** One-time codes (SMS OTP, delivery & handover codes) are short-lived; HMAC is enough. */
export function hashCode(purpose: string, code: string): string {
  const key = secret("OTP_HMAC_KEY", "dev-only-otp-hmac-key");
  return createHmac("sha256", key).update(`${purpose}:${code}`).digest("base64url");
}

export function codeMatches(purpose: string, code: string, storedHash: string): boolean {
  return safeEqual(hashCode(purpose, code), storedHash);
}
