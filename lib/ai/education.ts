/**
 * Champion education assistant (build prompt §7.5). Answers only from the
 * approved content pack, cites the section, refuses to diagnose, and routes
 * "customer feels unwell" to the referral card. Disabled until an admin has
 * approved the pack (checked by the caller against the pack hash).
 */
import { wrapUntrusted, type LlmCaller } from "./llm";
import { guardMedical } from "./guards";
import { scrub } from "./scrub";
import { educationSystem, PROMPT_VERSIONS } from "./prompts";
import type { AiOutcome } from "./problem-intake";

export interface EducationSection {
  id: string;
  title: { en: string; sw: string };
  body: { en: string; sw: string };
  source: string;
}

export interface EducationPack {
  version: string;
  status: "DRAFT" | "APPROVED";
  sections: EducationSection[];
}

export type EducationAnswer = { kind: "answer"; text: string; sources: string[] } | { kind: "refer" } | { kind: "not_covered" };

const UNWELL = /\b(unwell|sick|ill|pain|hurts?|bleeding (a lot|heavily)|fever|rash|itch|infection|dizzy|faint|vomit|mgonjwa|anaumwa|maumivu|homa|kizunguzungu|kutapika|anavuja damu|muwasho)\b/i;

export function packToPromptText(pack: EducationPack, locale: "sw" | "en"): string {
  return pack.sections.map((s) => `[${s.id}] ${s.title[locale]}: ${s.body[locale]} (source: ${s.source})`).join("\n");
}

export async function answerEducationWith(llm: LlmCaller, pack: EducationPack, question: string, locale: "sw" | "en", knownNames: readonly string[]): Promise<AiOutcome<EducationAnswer>> {
  const scrubbed = scrub(question.slice(0, 400), knownNames).text;
  // Symptom talk never reaches the model: deterministic referral first.
  if (UNWELL.test(scrubbed)) {
    return { promptVersion: PROMPT_VERSIONS.education, scrubbedInput: scrubbed, rawOutput: "", inputTokens: 0, outputTokens: 0, result: { kind: "refer" }, rejectedBecause: [] };
  }
  const r = await llm.call({ system: educationSystem(packToPromptText(pack, locale)), prompt: `Question:\n${wrapUntrusted("question", scrubbed)}`, maxOutputTokens: 400 });
  const text = r.text.trim();
  const rejected: string[] = [];
  let result: EducationAnswer | null;
  if (/REFER_TO_HEALTH_FACILITY/.test(text)) result = { kind: "refer" };
  else {
    const medical = guardMedical(text);
    if (!medical.ok) {
      rejected.push(...medical.reasons);
      result = { kind: "refer" }; // fail safe: anything medical becomes a referral
    } else {
      const sources = [...text.matchAll(/\[source:\s*([a-z0-9._-]+)\]/gi)].map((m) => m[1]!).filter((id) => pack.sections.some((s) => s.id === id));
      if (sources.length === 0) result = { kind: "not_covered" };
      else result = { kind: "answer", text: scrub(text, knownNames).text, sources };
    }
  }
  return { promptVersion: PROMPT_VERSIONS.education, scrubbedInput: scrubbed, rawOutput: r.text, inputTokens: r.inputTokens, outputTokens: r.outputTokens, result, rejectedBecause: rejected };
}
