/**
 * AI morning brief and weekly review drafts (build prompt §7.2). Items are
 * selected and ordered by deterministic queries; the model only explains.
 */
import { z } from "zod";
import type { BriefItem } from "@/lib/domain/brief";
import { extractJson, wrapUntrusted, type LlmCaller } from "./llm";
import { scrub } from "./scrub";
import { guardStateChange } from "./guards";
import { briefSystem, weeklyReviewSystem, PROMPT_VERSIONS } from "./prompts";
import type { AiOutcome } from "./problem-intake";

export interface BriefExplanation {
  summary: string;
  explanations: Record<string, string>;
}

const Out = z.object({ summary: z.string().max(1200), explanations: z.record(z.string(), z.string().max(400)) });

export async function explainBriefWith(llm: LlmCaller, items: readonly BriefItem[], knownNames: readonly string[]): Promise<AiOutcome<BriefExplanation>> {
  // Only ids, kinds, triggers and scrubbed one-line details leave the system.
  const lines = items.map((it, i) => `${i + 1}. id=${it.id} kind=${it.kind} ageHours=${it.ageHours} triggers=[${it.triggers.join("; ")}] detail=${wrapUntrusted("detail", scrub(it.detail, knownNames).text)}`);
  const prompt = `Items:\n${lines.join("\n")}`;
  const r = await llm.call({ system: briefSystem, prompt, maxOutputTokens: 900 });
  const parsed = Out.safeParse(extractJson(r.text));
  const rejected: string[] = [];
  if (!parsed.success) rejected.push("unparseable");
  let result: BriefExplanation | null = null;
  if (parsed.success) {
    const ids = new Set(items.map((i) => i.id));
    const explanations: Record<string, string> = {};
    for (const [id, text] of Object.entries(parsed.data.explanations)) {
      if (!ids.has(id)) continue; // the model may not invent items
      if (!guardStateChange(text).ok) continue; // drop any "set it to paid" advice
      explanations[id] = scrub(text, knownNames).text;
    }
    const summaryGuard = guardStateChange(parsed.data.summary);
    if (!summaryGuard.ok) rejected.push(...summaryGuard.reasons);
    else result = { summary: scrub(parsed.data.summary, knownNames).text, explanations };
  }
  return { promptVersion: PROMPT_VERSIONS.brief, scrubbedInput: prompt, rawOutput: r.text, inputTokens: r.inputTokens, outputTokens: r.outputTokens, result, rejectedBecause: rejected };
}

export interface WeeklyCounts {
  unitsFromSuppliers: number;
  unitsAtHubs: number;
  unitsToChampions: number;
  unitsToCustomers: number;
  paymentsConfirmed: number;
  paymentsInReview: number;
  pendingOlderThanLimit: number;
  exceptionsRaised: number;
  completionRatePct: number;
  complaints: number;
  triggersFired: string[];
}

export async function draftWeeklyReviewWith(llm: LlmCaller, counts: WeeklyCounts): Promise<AiOutcome<string>> {
  const prompt = `Weekly aggregate counts (no personal data):\n${JSON.stringify(counts, null, 1)}`;
  const r = await llm.call({ system: weeklyReviewSystem, prompt, maxOutputTokens: 700 });
  const guard = guardStateChange(r.text);
  return {
    promptVersion: PROMPT_VERSIONS.weeklyReview,
    scrubbedInput: prompt,
    rawOutput: r.text,
    inputTokens: r.inputTokens,
    outputTokens: r.outputTokens,
    result: guard.ok ? r.text.trim() : null,
    rejectedBecause: guard.reasons,
  };
}
