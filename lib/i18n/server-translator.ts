/**
 * Translator for non-React server code (SMS bodies, receipts).
 */
import { createTranslator } from "next-intl";
import en from "@/messages/en.json";
import sw from "@/messages/sw.json";

export type Locale = "sw" | "en";
export const LOCALES: readonly Locale[] = ["sw", "en"] as const;
export const MESSAGES = { en, sw } as const;

export function isLocale(v: unknown): v is Locale {
  return v === "sw" || v === "en";
}

export function translator(locale: Locale, namespace?: string) {
  // The message catalogues share one shape (checked by tests/unit/i18n.test.ts).
  return createTranslator({ locale, messages: MESSAGES[locale] as typeof en, namespace: namespace as never });
}

/** Simple string lookup with ICU arguments. */
export function tr(locale: Locale, key: string, values?: Record<string, string | number>): string {
  const t = createTranslator({ locale, messages: MESSAGES[locale] as typeof en });
  return (t as unknown as (k: string, v?: Record<string, string | number>) => string)(key, values);
}
