/**
 * Deterministic output guards. The model drafts; these decide whether a draft
 * may even be shown. They are intentionally blunt.
 */

/** Medical advice / diagnosis patterns (EN + SW). The education assistant must never produce these. */
const MEDICAL = [
  /\b(diagnos|prescri|dosage|dose|mg\b|tablet|ibuprofen|paracetamol|antibiotic|infection is|you have (an?|the)\b|it is (probably|likely) (a|an)\b)/i,
  /\b(ni ugonjwa|una maambukizi|kunywa (dawa|vidonge)|dawa ya|kipimo cha)\b/i,
  /\b(take|swallow|apply)\b.*\b(medicine|pill|drug|cream)\b/i,
];

/** Anything that reads as changing money or state. AI never does this; a draft that suggests it is discarded. */
const STATE_CHANGE = [
  /\b(mark(ed)?|set|record(ed)?|confirm(ed)?)\b.{0,30}\b(as )?(paid|confirmed|complete|delivered|released)\b/i,
  /\b(release|hand over|handover|transfer)\b.{0,30}\b(the )?(stock|product|batch|goods)\b.{0,30}\b(now|immediately|without)\b/i,
  /\b(payment[_ ]?confirmed|paymentconfirmed|update .* status|change .* state|override|bypass)\b/i,
  /\b(weka|rekodi|thibitisha)\b.{0,30}\b(imelipwa|kama imelipwa|imekamilika)\b/i,
];

/** Pressure / debt language forbidden in customer messages (build prompt §7.3, handbook §8D). */
const PRESSURE = [
  /\b(overdue|penalt(y|ies)|late fee|debt|owe|must pay|pay now|final (notice|warning)|legal action|consequences|immediately pay|urgent(ly)? pay|last chance|or else)\b/i,
  /\b(deni|faini|adhabu|lazima ulipe|lipa sasa|onyo la mwisho|hatua za kisheria|ni lazima)\b/i,
];

export interface GuardResult {
  ok: boolean;
  reasons: string[];
}

export function guardMedical(text: string): GuardResult {
  const reasons = MEDICAL.filter((re) => re.test(text)).map(() => "medical_advice");
  return { ok: reasons.length === 0, reasons: [...new Set(reasons)] };
}

export function guardStateChange(text: string): GuardResult {
  const reasons = STATE_CHANGE.filter((re) => re.test(text)).map(() => "state_change_language");
  return { ok: reasons.length === 0, reasons: [...new Set(reasons)] };
}

export function toneCheck(text: string): GuardResult {
  const reasons = PRESSURE.filter((re) => re.test(text)).map(() => "pressure_or_debt_language");
  return { ok: reasons.length === 0, reasons: [...new Set(reasons)] };
}

/**
 * Crude Swahili sanity check: a Swahili draft should contain common Swahili
 * function words and few obviously-English ones. Returns a 0–1 score.
 */
const SW_MARKERS = ["na", "ya", "wa", "kwa", "ni", "za", "la", "kwenye", "hakuna", "tafadhali", "asante", "habari", "malipo", "bidhaa", "mteja", "yako", "wako", "kama"];
const EN_MARKERS = ["the", "and", "your", "payment", "please", "product", "is", "are", "with", "you"];

export function swahiliScore(text: string): number {
  const words = text.toLowerCase().match(/[a-z]+/g) ?? [];
  if (words.length === 0) return 0;
  const sw = words.filter((w) => SW_MARKERS.includes(w)).length;
  const en = words.filter((w) => EN_MARKERS.includes(w)).length;
  return Math.max(0, Math.min(1, (sw - en) / Math.max(3, words.length / 4) + 0.5));
}

export function guardSwahili(text: string): GuardResult {
  const score = swahiliScore(text);
  return { ok: score >= 0.5, reasons: score >= 0.5 ? [] : ["not_swahili"] };
}
