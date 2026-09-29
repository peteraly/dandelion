import { TIMEZONE } from "@/lib/env";

const dayFmt = new Intl.DateTimeFormat("en-CA", { timeZone: TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit" });

/** Calendar day in Africa/Dar_es_Salaam, as YYYY-MM-DD. */
export function tzDay(d: Date = new Date()): string {
  return dayFmt.format(d);
}

/** First day of the month (Africa/Dar_es_Salaam) containing d, as a UTC instant. */
export function tzMonthStart(d: Date = new Date()): Date {
  const [y, m] = tzDay(d).split("-").map(Number) as [number, number];
  // Dar es Salaam is UTC+3 with no DST.
  return new Date(Date.UTC(y, m - 1, 1, -3, 0, 0));
}

/** Start of the ISO week (Monday 00:00 Africa/Dar_es_Salaam) containing d. */
export function tzWeekStart(d: Date = new Date()): Date {
  const [y, m, day] = tzDay(d).split("-").map(Number) as [number, number, number];
  const local = new Date(Date.UTC(y, m - 1, day));
  const dow = (local.getUTCDay() + 6) % 7; // Monday = 0
  return new Date(Date.UTC(y, m - 1, day - dow, -3, 0, 0));
}

export function formatDateTime(d: Date, locale: "sw" | "en"): string {
  return new Intl.DateTimeFormat(locale === "sw" ? "sw-TZ" : "en-GB", {
    timeZone: TIMEZONE,
    dateStyle: "medium",
    timeStyle: "short",
  }).format(d);
}

export function formatDay(d: Date | string, locale: "sw" | "en"): string {
  const date = typeof d === "string" ? new Date(`${d}T12:00:00+03:00`) : d;
  return new Intl.DateTimeFormat(locale === "sw" ? "sw-TZ" : "en-GB", { timeZone: TIMEZONE, dateStyle: "medium" }).format(date);
}
