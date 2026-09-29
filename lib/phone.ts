/**
 * Tanzanian mobile numbers. We normalise to E.164 (+255XXXXXXXXX).
 * Accepts +255 / 255 / 0 prefixes with spaces or dashes.
 */
import { z } from "zod";

const DIGITS = /[\s\-().]/g;

export function normalizeTzPhone(input: string): string | null {
  const raw = input.trim().replace(DIGITS, "");
  let national: string | null = null;
  if (/^\+255\d{9}$/.test(raw)) national = raw.slice(4);
  else if (/^255\d{9}$/.test(raw)) national = raw.slice(3);
  else if (/^0\d{9}$/.test(raw)) national = raw.slice(1);
  if (!national) return null;
  // Mobile ranges start with 6 or 7.
  if (!/^[67]\d{8}$/.test(national)) return null;
  return `+255${national}`;
}

export const TzPhoneSchema = z
  .string()
  .max(32)
  .transform((s, ctx) => {
    const n = normalizeTzPhone(s);
    if (!n) {
      ctx.addIssue({ code: "custom", message: "invalid_phone" });
      return z.NEVER;
    }
    return n;
  });

/** Show only the last 3 digits, e.g. "+255 ••• ••• 012". */
export function maskPhone(e164: string): string {
  return `+255 ••• ••• ${e164.slice(-3)}`;
}
