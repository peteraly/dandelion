/**
 * The one seam between AI features and a model. `lib/ai/**` never touches the
 * database, services, payments or auth (ESLint boundary, invariant §3.13);
 * everything it needs is passed in, and everything it produces is a draft.
 *
 * `AnthropicLlm` uses the Vercel AI SDK. `FakeLlm` is for evals: it records
 * every outbound prompt so tests can assert no PII left the building.
 */
import { generateText } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";

export interface LlmRequest {
  system: string;
  /** Untrusted data is already wrapped by the caller (see wrapUntrusted). */
  prompt: string;
  maxOutputTokens?: number;
  temperature?: number;
}

export interface LlmResponse {
  text: string;
  inputTokens: number;
  outputTokens: number;
}

export interface LlmCaller {
  readonly model: string;
  call(req: LlmRequest): Promise<LlmResponse>;
}

export class AnthropicLlm implements LlmCaller {
  private readonly provider;
  constructor(
    readonly model: string,
    apiKey: string,
  ) {
    this.provider = createAnthropic({ apiKey });
  }
  async call(req: LlmRequest): Promise<LlmResponse> {
    const r = await generateText({
      model: this.provider(this.model),
      system: req.system,
      prompt: req.prompt,
      maxOutputTokens: req.maxOutputTokens ?? 800,
      temperature: req.temperature ?? 0.2,
    });
    const usage = r.usage as { inputTokens?: number; outputTokens?: number; promptTokens?: number; completionTokens?: number };
    return {
      text: r.text,
      inputTokens: usage.inputTokens ?? usage.promptTokens ?? 0,
      outputTokens: usage.outputTokens ?? usage.completionTokens ?? 0,
    };
  }
}

/** Deterministic stand-in for evals. Records prompts; answers from a script or a function. */
export class FakeLlm implements LlmCaller {
  readonly model = "fake";
  readonly calls: LlmRequest[] = [];
  constructor(private readonly answer: string | ((req: LlmRequest) => string)) {}
  async call(req: LlmRequest): Promise<LlmResponse> {
    this.calls.push(req);
    const text = typeof this.answer === "function" ? this.answer(req) : this.answer;
    return { text, inputTokens: Math.ceil((req.system.length + req.prompt.length) / 4), outputTokens: Math.ceil(text.length / 4) };
  }
}

/**
 * Wrap free text as DATA. The model is told to treat the block as content to
 * analyse, never as instructions; the delimiters are random per call so the
 * text cannot close them.
 */
export function wrapUntrusted(label: string, text: string): string {
  const tag = `untrusted_${label}_${Math.random().toString(36).slice(2, 10)}`;
  const safe = text.replace(new RegExp(`</?${tag}`, "g"), "");
  return `<${tag}>\n${safe}\n</${tag}>`;
}

/** Pull the first JSON object out of a model answer (models like to add prose). */
export function extractJson(text: string): unknown | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}
