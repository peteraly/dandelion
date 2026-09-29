/**
 * Anomaly explanations (build prompt §7.4). Deterministic rules flag; the
 * model explains for admins. Only the flag kind and non-personal details go out.
 */
import { wrapUntrusted, type LlmCaller } from "./llm";
import { guardStateChange } from "./guards";
import { anomalySystem, PROMPT_VERSIONS } from "./prompts";
import type { AiOutcome } from "./problem-intake";

export interface AnomalyInput {
  kind: string;
  details: Record<string, unknown>;
  orderKind?: string | null;
  orderState?: string | null;
}

export async function explainAnomalyWith(llm: LlmCaller, a: AnomalyInput): Promise<AiOutcome<string>> {
  const prompt = `Flag: ${a.kind}\nOrder kind: ${a.orderKind ?? "n/a"}, state: ${a.orderState ?? "n/a"}\nDetails: ${wrapUntrusted("details", JSON.stringify(a.details))}`;
  const r = await llm.call({ system: anomalySystem, prompt, maxOutputTokens: 300 });
  const guard = guardStateChange(r.text);
  return {
    promptVersion: PROMPT_VERSIONS.anomaly,
    scrubbedInput: prompt,
    rawOutput: r.text,
    inputTokens: r.inputTokens,
    outputTokens: r.outputTokens,
    result: guard.ok ? r.text.trim() : null,
    rejectedBecause: guard.reasons,
  };
}
