/**
 * East Africa Time helpers for the generator. `now()` is a UTC instant; the
 * realism rules (Prompt B §2.4) are written in Africa/Dar_es_Salaam, which is
 * UTC+3 all year, so the conversion is a fixed offset.
 */
export const EAT_OFFSET_MS = 3 * 3_600_000;
export const DAY_MS = 86_400_000;

/** 00:00 EAT of the EAT calendar day containing `d`, as a UTC instant. */
export function eatDayStart(d: Date): Date {
  const shifted = d.getTime() + EAT_OFFSET_MS;
  return new Date(Math.floor(shifted / DAY_MS) * DAY_MS - EAT_OFFSET_MS);
}

/** `hour:minute` EAT on the EAT day that starts at `dayStart`. */
export function atEat(dayStart: Date, hour: number, minute = 0, second = 0): Date {
  return new Date(dayStart.getTime() + hour * 3_600_000 + minute * 60_000 + second * 1000);
}

export function eatHour(d: Date): number {
  return Math.floor(((d.getTime() + EAT_OFFSET_MS) % DAY_MS) / 3_600_000);
}

/** 0 = Sunday … 6 = Saturday, in EAT. */
export function eatWeekday(d: Date): number {
  return new Date(d.getTime() + EAT_OFFSET_MS).getUTCDay();
}

export function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * DAY_MS);
}

/** Nights are quiet: nothing but the nightly reconciliation happens 23:00–06:00 EAT. */
export function isQuietHour(d: Date): boolean {
  const h = eatHour(d);
  return h >= 23 || h < 6;
}

export function isSunday(d: Date): boolean {
  return eatWeekday(d) === 0;
}

export const MINUTE = 60_000;
export const HOUR = 3_600_000;
