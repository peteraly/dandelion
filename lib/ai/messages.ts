/**
 * Message drafting from the handbook §18 templates (build prompt §7.3).
 * A human approves every message; the tone check is deterministic.
 */
import { wrapUntrusted, type LlmCaller } from "./llm";
import { scrub } from "./scrub";
import { containsPhone } from "./scrub";
import { guardStateChange, guardSwahili, toneCheck } from "./guards";
import { messageDraftSystem, PROMPT_VERSIONS } from "./prompts";
import type { AiOutcome } from "./problem-intake";

export const MESSAGE_TEMPLATES = ["reminder_gentle", "pickup_info", "plan_progress", "handover_ready", "general_notice"] as const;
export type MessageTemplate = (typeof MESSAGE_TEMPLATES)[number];

/** Base texts adapted from handbook §18 (no blockchain guarantees, no payout claims). */
export const TEMPLATE_TEXT: Record<MessageTemplate, { en: string; sw: string }> = {
  reminder_gentle: {
    // Deliberately avoids the words the tone guard forbids, even in negated form ("no debt"): the guard is blunt on purpose.
    en: "Habari {name}. This is a friendly note about your product plan. Confirmed paid so far: {paid}. Remaining: {remaining}. You may pay in voluntary installments whenever it suits you, only the amount you choose. Nothing is deducted automatically. Reply or call {help} if you have questions.",
    sw: "Habari {name}. Hii ni taarifa ya kirafiki kuhusu mpango wako wa bidhaa. Imethibitishwa kulipwa hadi sasa: {paid}. Iliyobaki: {remaining}. Unaweza kulipa kwa awamu za hiari wakati wowote unaofaa, kiasi unachochagua tu. Hakuna kinachokatwa kiotomatiki. Jibu au piga {help} ukiwa na maswali.",
  },
  pickup_info: {
    en: "Habari {name}. A pickup is planned: {product}, {quantity} units, approved total {amount}. Open the app to review and accept. Do not collect stock until the app shows PAYMENT CONFIRMED.",
    sw: "Habari {name}. Uchukuzi umepangwa: {product}, vipande {quantity}, jumla iliyoidhinishwa {amount}. Fungua programu kukagua na kukubali. Usichukue bidhaa hadi programu ionyeshe MALIPO YAMETHIBITISHWA.",
  },
  plan_progress: {
    en: "Habari {name}. Your product price is {price}. Confirmed paid: {paid}. Remaining: {remaining}. Pay in installments or in full when you choose. The product is handed over after full payment is confirmed.",
    sw: "Habari {name}. Bei ya bidhaa yako ni {price}. Imethibitishwa kulipwa: {paid}. Iliyobaki: {remaining}. Lipa kwa awamu au yote unapochagua. Bidhaa inakabidhiwa baada ya malipo kamili kuthibitishwa.",
  },
  handover_ready: {
    en: "Habari {name}. Your full payment has been confirmed. Meet your Health Champion to receive your product and use instructions. Your receipt follows after handover.",
    sw: "Habari {name}. Malipo yako kamili yamethibitishwa. Kutana na Bingwa wako wa Afya kupokea bidhaa yako na maelekezo ya matumizi. Risiti yako itafuata baada ya makabidhiano.",
  },
  general_notice: {
    en: "Habari {name}. {body} If you need help, contact {help}.",
    sw: "Habari {name}. {body} Ukihitaji msaada, wasiliana na {help}.",
  },
};

export interface DraftInput {
  template: MessageTemplate;
  locale: "sw" | "en";
  /** Placeholder values. `name` is the recipient's display name; it is inserted AFTER the model runs. */
  values: Record<string, string>;
  /** Optional operator guidance, treated as untrusted data. */
  context?: string;
}

/** Deterministic fill — used when AI is off and as the baseline the model adapts. Placeholders in `keep` stay literal; others without a value are dropped. */
export function fillTemplate(input: DraftInput, keep: readonly string[] = []): string {
  let text = TEMPLATE_TEXT[input.template][input.locale];
  for (const [k, v] of Object.entries(input.values)) text = text.replace(new RegExp(`\\{${k}\\}`, "g"), v);
  return text
    .replace(/\{([a-z]+)\}/g, (m, k: string) => (keep.includes(k) ? m : ""))
    .replace(/\s{2,}/g, " ")
    .trim();
}

export interface Draft {
  text: string;
  tone: ReturnType<typeof toneCheck>;
  swahili: ReturnType<typeof guardSwahili> | null;
}

export async function draftMessageWith(llm: LlmCaller, input: DraftInput, knownNames: readonly string[]): Promise<AiOutcome<Draft>> {
  // The recipient's name never goes to the model: the placeholder stays literal and is filled afterwards.
  const { name, ...rest } = input.values;
  const base = fillTemplate({ ...input, values: rest }, ["name"]);
  const prompt = [`Template (keep all facts):\n${wrapUntrusted("template", base)}`, input.context ? `Operator notes:\n${wrapUntrusted("notes", scrub(input.context, knownNames).text)}` : ""].filter(Boolean).join("\n\n");
  const r = await llm.call({ system: messageDraftSystem(input.locale), prompt, maxOutputTokens: 300 });
  let text = r.text.trim().replace(/^"|"$/g, "");
  const rejected: string[] = [];
  // An empty or truncated answer must not pass the guards by saying nothing.
  if (text.length < 20) rejected.push("empty_output");
  if (containsPhone(text)) rejected.push("phone_in_output");
  const state = guardStateChange(text);
  // The template itself may legitimately say "payment has been confirmed" (handover_ready); only flag if the template did not.
  if (!state.ok && guardStateChange(base).ok) rejected.push(...state.reasons);
  const tone = toneCheck(text);
  if (!tone.ok) rejected.push(...tone.reasons);
  const swahili = input.locale === "sw" ? guardSwahili(text) : null;
  if (swahili && !swahili.ok) rejected.push(...swahili.reasons);
  if (text.length > 320) rejected.push("too_long");
  text = text.replace(/\{name\}/g, name ?? "");
  return {
    promptVersion: PROMPT_VERSIONS.messageDraft,
    scrubbedInput: prompt,
    rawOutput: r.text,
    inputTokens: r.inputTokens,
    outputTokens: r.outputTokens,
    result: rejected.length === 0 ? { text, tone, swahili } : null,
    rejectedBecause: rejected,
  };
}
