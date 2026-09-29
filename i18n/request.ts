import { getRequestConfig } from "next-intl/server";
import { cookies } from "next/headers";
import { isLocale } from "@/lib/i18n/server-translator";
import { TIMEZONE } from "@/lib/env";

export const LOCALE_COOKIE = "locale";

/**
 * Locale comes from a cookie (set by the SW/EN toggle or from the user's
 * preferred locale at login). Swahili is the default for field roles;
 * public pages start in Swahili too.
 */
export default getRequestConfig(async () => {
  const jar = await cookies();
  const raw = jar.get(LOCALE_COOKIE)?.value;
  const locale = isLocale(raw) ? raw : "sw";
  return {
    locale,
    timeZone: TIMEZONE,
    messages: (await import(`../messages/${locale}.json`)).default,
  };
});
