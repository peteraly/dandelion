/**
 * Money is integer Tanzanian shillings, always. No floats, no decimals.
 */
import { z } from "zod";

declare const TzsBrand: unique symbol;
export type Tzs = number & { readonly [TzsBrand]: true };

/** Upper bound well inside int4 and far above any pilot amount. */
export const MAX_TZS = 1_000_000_000;

export function tzs(n: number): Tzs {
  if (!Number.isSafeInteger(n) || n < 0 || n > MAX_TZS) {
    throw new RangeError(`Invalid TZS amount: ${n}`);
  }
  return n as Tzs;
}

export const TzsSchema = z
  .number()
  .int()
  .nonnegative()
  .max(MAX_TZS)
  .transform((n) => n as Tzs);

/** For form input: digits only, parsed to an integer. */
export const TzsFormSchema = z
  .string()
  .trim()
  .regex(/^\d{1,10}$/, "amount_digits_only")
  .transform((s) => Number.parseInt(s, 10))
  .pipe(TzsSchema);

export function addTzs(a: Tzs, b: Tzs): Tzs {
  return tzs(a + b);
}

/** Subtraction that refuses to go negative (no negative balances, ever). */
export function subTzs(a: Tzs, b: Tzs): Tzs {
  if (b > a) throw new RangeError("Negative balance is not allowed");
  return tzs(a - b);
}

export function mulTzs(unit: Tzs, qty: number): Tzs {
  if (!Number.isSafeInteger(qty) || qty < 0) throw new RangeError("Invalid quantity");
  return tzs(unit * qty);
}

export function formatTzs(n: number, locale: "sw" | "en" = "en"): string {
  const s = new Intl.NumberFormat(locale === "sw" ? "sw-TZ" : "en-TZ", {
    maximumFractionDigits: 0,
  }).format(n);
  return `${s} TZS`;
}
