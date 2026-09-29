/**
 * RFC 6238 TOTP (SHA-1, 30 s, 6 digits) — the admin second-factor fallback
 * when a passkey is unavailable. SMS is never an admin factor.
 */
import { createHmac, randomBytes } from "node:crypto";

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s: string): Buffer {
  const clean = s.replace(/=+$/, "").replace(/\s/g, "").toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = B32.indexOf(ch);
    if (idx < 0) throw new Error("invalid base32");
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

export function hotp(secret: Buffer, counter: number, digits = 6): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const h = createHmac("sha1", secret).update(msg).digest();
  const offset = h[h.length - 1]! & 0x0f;
  const bin = ((h[offset]! & 0x7f) << 24) | (h[offset + 1]! << 16) | (h[offset + 2]! << 8) | h[offset + 3]!;
  return String(bin % 10 ** digits).padStart(digits, "0");
}

export function totpAt(secretB32: string, time: Date, step = 30, digits = 6): string {
  return hotp(base32Decode(secretB32), Math.floor(time.getTime() / 1000 / step), digits);
}

/**
 * Verify with ±1 step of clock drift. Returns the matched time step so the
 * caller can reject reuse of the same code (store it as totpLastStep).
 */
export function verifyTotp(secretB32: string, code: string, now: Date, lastUsedStep: number | null): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const key = base32Decode(secretB32);
  const current = Math.floor(now.getTime() / 1000 / 30);
  for (const s of [current - 1, current, current + 1]) {
    if (lastUsedStep !== null && s <= lastUsedStep) continue;
    if (hotp(key, s) === code) return s;
  }
  return null;
}

export function otpauthUri(secretB32: string, label: string, issuer = "Dandelion Pilot"): string {
  return `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(label)}?secret=${secretB32}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}
