import { randomBytes, createHash, timingSafeEqual } from "node:crypto";

/** 128-bit random, URL-safe (22 chars). Used for public verify refs. */
export function randomRef128(): string {
  return randomBytes(16).toString("base64url");
}

/** 256-bit random, URL-safe token (43 chars). Sessions, receipt tokens, enrollment links. */
export function randomToken(): string {
  return randomBytes(32).toString("base64url");
}

// Crockford-style alphabet without I, L, O, U, 0, 1 to avoid misreads over the phone.
const HUMAN_ALPHABET = "23456789ABCDEFGHJKMNPQRSTVWXYZ";

/** Short human-readable code, e.g. "K7M2QX". Uniqueness is enforced by the DB. */
export function humanCode(length = 6): string {
  const bytes = randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i++) out += HUMAN_ALPHABET[bytes[i]! % HUMAN_ALPHABET.length];
  return out;
}

/** Numeric code for SMS OTP / delivery codes. */
export function numericCode(digits = 6): string {
  // Rejection sampling to avoid modulo bias.
  const max = 10 ** digits;
  const limit = Math.floor(0xffffffff / max) * max;
  for (;;) {
    const n = randomBytes(4).readUInt32BE(0);
    if (n < limit) return String(n % max).padStart(digits, "0");
  }
}

export function sha256Hex(input: string | Buffer): string {
  return createHash("sha256").update(input).digest("hex");
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}
