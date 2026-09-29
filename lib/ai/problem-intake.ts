/**
 * AI problem intake (build prompt §7.1). Free text → a proposed structured
 * exception. The user confirms with one tap; deterministic code creates it.
 * No write path here.
 */
import { z } from "zod";
import { REPORTABLE_PROBLEMS, type ReportableProblem } from "@/lib/domain/types";
import { extractJson, wrapUntrusted, type LlmCaller } from "./llm";
import { scrub } from "./scrub";
import { guardStateChange } from "./guards";
import { problemIntakeSystem, PROMPT_VERSIONS } from "./prompts";

export interface ExceptionProposal {
  type: ReportableProblem;
  confidence: number;
  note: string;
}

export interface AiOutcome<T> {
  promptVersion: string;
  scrubbedInput: string;
  rawOutput: string;
  inputTokens: number;
  outputTokens: number;
  result: T | null;
  rejectedBecause: string[];
}

const Proposal = z.object({ type: z.enum(REPORTABLE_PROBLEMS), confidence: z.number().min(0).max(1), note: z.string().max(200) });

export async function proposeExceptionWith(llm: LlmCaller, text: string, knownNames: readonly string[]): Promise<AiOutcome<ExceptionProposal>> {
  const scrubbed = scrub(text.slice(0, 500), knownNames).text;
  const r = await llm.call({ system: problemIntakeSystem, prompt: `Report:\n${wrapUntrusted("report", scrubbed)}`, maxOutputTokens: 200 });
  const parsed = Proposal.safeParse(extractJson(r.text));
  const rejected: string[] = [];
  if (!parsed.success) rejected.push("unparseable");
  const stateGuard = parsed.success ? guardStateChange(parsed.data.note) : { ok: true, reasons: [] };
  if (!stateGuard.ok) rejected.push(...stateGuard.reasons);
  const note = parsed.success ? scrub(parsed.data.note, knownNames).text : "";
  return {
    promptVersion: PROMPT_VERSIONS.problemIntake,
    scrubbedInput: scrubbed,
    rawOutput: r.text,
    inputTokens: r.inputTokens,
    outputTokens: r.outputTokens,
    result: parsed.success && rejected.length === 0 ? { ...parsed.data, note } : null,
    rejectedBecause: rejected,
  };
}
