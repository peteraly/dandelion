/**
 * PII scrubber (build prompt §7). Removes Tanzanian phone numbers in every
 * common format and any known person name before text leaves the system.
 * Names are supplied by the caller (display names from the users and
 * customers tables); the scrubber never reads the database.
 */

// +255 / 255 / 0, then 6x or 7x, then 8 more digits; spaces, dashes and dots allowed between groups.
const TZ_PHONE = /(?:\+?\s?255|0)[\s.-]*[67]\d(?:[\s.-]*\d){7}\b/g;
// Anything that still looks like a long digit run (partial numbers, account refs typed by mistake).
const LONG_DIGITS = /\b\d[\d\s.-]{7,}\d\b/g;

export interface ScrubResult {
  text: string;
  phonesRemoved: number;
  namesRemoved: number;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function scrub(input: string, names: readonly string[]): ScrubResult {
  let phonesRemoved = 0;
  let namesRemoved = 0;
  let text = input.replace(TZ_PHONE, () => {
    phonesRemoved++;
    return "[phone]";
  });
  text = text.replace(LONG_DIGITS, (m) => {
    // keep amounts like "11400" (≤ 6 digits without separators) — those are not phone numbers
    if (/^\d{1,6}$/.test(m)) return m;
    phonesRemoved++;
    return "[number]";
  });
  // Longest names first so "Juma Hassan" is removed before "Juma".
  const tokens = [...new Set(names.flatMap((n) => [n, ...n.split(/\s+/)]).map((n) => n.trim()).filter((n) => n.length >= 3))].sort((a, b) => b.length - a.length);
  for (const token of tokens) {
    // Skip generic words that happen to be in a display name (e.g. "(TEST)", "Customer").
    if (/^(test|customer|admin|hub|rider|champion|supplier|manager|one|two|three|four|five|a|b|c|d|e)$/i.test(token.replace(/[()]/g, ""))) continue;
    const re = new RegExp(`\\b${escapeRe(token)}\\b`, "gi");
    text = text.replace(re, () => {
      namesRemoved++;
      return "[name]";
    });
  }
  return { text, phonesRemoved, namesRemoved };
}

/** True if anything phone-like survived (used by the eval and as a last gate before sending). */
export function containsPhone(text: string): boolean {
  return new RegExp(TZ_PHONE.source).test(text);
}
