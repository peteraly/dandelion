/**
 * The only place AI features touch the database — and only to READ names for
 * scrubbing, check limits, and LOG. AI output is a draft; deterministic code
 * elsewhere acts on it after a human confirms.
 *
 * Every call: AI_ENABLED gate → per-user rate limit → monthly spend cap →
 * model call (lib/ai) → ai_interaction_log row (prompt version, output,
 * accepted = null until the human decides).
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { and, eq, gte, sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import { aiEnabled, aiModel, optionalSecret } from "@/lib/env";
import type { Actor } from "@/lib/policy";
import { authorize } from "@/lib/policy";
import { hitRateLimit } from "@/lib/security/rate-limit";
import { tzMonthStart } from "@/lib/util/time";
import { AnthropicLlm, FakeLlm, type LlmCaller } from "@/lib/ai/llm";
import type { AiOutcome } from "@/lib/ai/problem-intake";
import { proposeExceptionWith, type ExceptionProposal } from "@/lib/ai/problem-intake";
import { explainBriefWith, draftWeeklyReviewWith, type BriefExplanation, type WeeklyCounts } from "@/lib/ai/brief";
import { draftMessageWith, type Draft, type DraftInput } from "@/lib/ai/messages";
import { explainAnomalyWith, type AnomalyInput } from "@/lib/ai/anomalies";
import { answerEducationWith, type EducationAnswer, type EducationPack } from "@/lib/ai/education";
import { DomainError, getSetting } from "./core";

// Approximate list prices in micro-USD per 1k tokens; verify against current Anthropic pricing before go-live.
const PRICE_IN = Number(process.env.AI_PRICE_IN_MICRO_USD_PER_1K ?? 3000);
const PRICE_OUT = Number(process.env.AI_PRICE_OUT_MICRO_USD_PER_1K ?? 15000);

let injected: LlmCaller | null = null;
/** Tests inject a FakeLlm; production builds the Anthropic caller. */
export function setLlmForTests(llm: LlmCaller | null): void {
  injected = llm;
}

function llm(): LlmCaller {
  if (injected) return injected;
  const key = optionalSecret("ANTHROPIC_API_KEY");
  if (!key) return new FakeLlm(""); // AI "on" without a key degrades to no output rather than crashing
  return new AnthropicLlm(aiModel(), key);
}

async function knownNames(): Promise<string[]> {
  const db = getDb();
  const users = await db.select({ n: s.users.displayName }).from(s.users);
  const customers = await db.select({ n: s.customers.displayName }).from(s.customers);
  return [...users, ...customers].map((r) => r.n);
}

async function gate(actor: Actor, feature: string): Promise<void> {
  if (!aiEnabled()) throw new DomainError("ai_disabled");
  const rl = await hitRateLimit(`ai:${actor.userId}`, 30, 3600);
  if (!rl.allowed) throw new DomainError("ai_rate_limited");
  const budgetCents = await getSetting("aiMonthlyBudgetCents");
  const [spent] = await getDb()
    .select({ micro: sql<number>`coalesce(sum(${s.aiInteractionLog.costMicroUsd}), 0)::bigint` })
    .from(s.aiInteractionLog)
    .where(gte(s.aiInteractionLog.createdAt, tzMonthStart()));
  if (Number(spent?.micro ?? 0) / 10_000 >= budgetCents) throw new DomainError("ai_budget_exhausted");
  void feature;
}

async function log<T>(actor: Actor, feature: string, out: AiOutcome<T>): Promise<string> {
  const cost = Math.round((out.inputTokens * PRICE_IN + out.outputTokens * PRICE_OUT) / 1000);
  const [row] = await getDb()
    .insert(s.aiInteractionLog)
    .values({
      feature,
      promptVersion: out.promptVersion,
      model: llm().model,
      userId: actor.userId,
      scrubbedInput: out.scrubbedInput.slice(0, 4000),
      output: (out.result === null ? `REJECTED(${out.rejectedBecause.join(",")}): ` : "") + out.rawOutput.slice(0, 4000),
      inputTokens: out.inputTokens,
      outputTokens: out.outputTokens,
      costMicroUsd: cost,
    })
    .returning({ id: s.aiInteractionLog.id });
  return row!.id;
}

/** The human's decision on a draft. */
export async function recordDecision(interactionId: string, accepted: boolean): Promise<void> {
  await getDb().update(s.aiInteractionLog).set({ accepted, decidedAt: new Date() }).where(eq(s.aiInteractionLog.id, interactionId));
}

export async function aiProposeException(actor: Actor, text: string): Promise<{ id: string; proposal: ExceptionProposal | null }> {
  authorize(actor, "exception.report");
  await gate(actor, "problem_intake");
  const out = await proposeExceptionWith(llm(), text, await knownNames());
  return { id: await log(actor, "problem_intake", out), proposal: out.result };
}

export async function aiExplainBrief(actor: Actor, items: Parameters<typeof explainBriefWith>[1]): Promise<{ id: string; explanation: BriefExplanation | null }> {
  authorize(actor, "admin.dashboard");
  await gate(actor, "brief");
  const out = await explainBriefWith(llm(), items, await knownNames());
  return { id: await log(actor, "brief", out), explanation: out.result };
}

export async function aiWeeklyReview(actor: Actor, counts: WeeklyCounts): Promise<{ id: string; draft: string | null }> {
  authorize(actor, "admin.dashboard");
  await gate(actor, "weekly_review");
  const out = await draftWeeklyReviewWith(llm(), counts);
  return { id: await log(actor, "weekly_review", out), draft: out.result };
}

export async function aiDraftMessage(actor: Actor, input: DraftInput): Promise<{ id: string; draft: Draft | null; rejected: string[] }> {
  authorize(actor, "admin.dashboard");
  await gate(actor, "message_draft");
  const out = await draftMessageWith(llm(), input, await knownNames());
  return { id: await log(actor, "message_draft", out), draft: out.result, rejected: out.rejectedBecause };
}

export async function aiExplainAnomaly(actor: Actor, a: AnomalyInput): Promise<{ id: string; explanation: string | null }> {
  authorize(actor, "admin.dashboard");
  await gate(actor, "anomaly");
  const out = await explainAnomalyWith(llm(), a);
  return { id: await log(actor, "anomaly", out), explanation: out.result };
}

// ---------- education pack ----------

export function loadEducationPack(): { pack: EducationPack; sha256: string } {
  const raw = readFileSync(join(process.cwd(), "content/education/pack.json"), "utf8");
  return { pack: JSON.parse(raw) as EducationPack, sha256: createHash("sha256").update(raw).digest("hex") };
}

/** The assistant is enabled only when an admin approved exactly this pack version. */
export async function educationPackApproved(): Promise<boolean> {
  const { sha256 } = loadEducationPack();
  const row = await getDb().query.educationContent.findFirst({ where: eq(s.educationContent.packSha256, sha256) });
  return !!row && (await getSetting("educationPackApproved"));
}

export async function approveEducationPack(actor: Actor): Promise<void> {
  authorize(actor, "admin.dashboard");
  const { sha256 } = loadEducationPack();
  await getDb().insert(s.educationContent).values({ packSha256: sha256, approvedBy: actor.userId }).onConflictDoNothing();
}

export async function aiEducation(actor: Actor, question: string, locale: "sw" | "en"): Promise<{ id: string | null; answer: EducationAnswer }> {
  if (actor.role !== "FIELD_CHAMPION") throw new DomainError("forbidden");
  if (!(await educationPackApproved())) return { id: null, answer: { kind: "not_covered" } };
  await gate(actor, "education");
  const out = await answerEducationWith(llm(), loadEducationPack().pack, question, locale, await knownNames());
  return { id: await log(actor, "education", out), answer: out.result ?? { kind: "refer" } };
}

export async function aiUsageThisMonth(): Promise<{ calls: number; costCents: number; accepted: number; rejected: number }> {
  const [r] = await getDb()
    .select({
      calls: sql<number>`count(*)::int`,
      micro: sql<number>`coalesce(sum(${s.aiInteractionLog.costMicroUsd}), 0)::bigint`,
      accepted: sql<number>`count(*) filter (where ${s.aiInteractionLog.accepted} = true)::int`,
      rejected: sql<number>`count(*) filter (where ${s.aiInteractionLog.output} like 'REJECTED%')::int`,
    })
    .from(s.aiInteractionLog)
    .where(and(gte(s.aiInteractionLog.createdAt, tzMonthStart())));
  return { calls: Number(r?.calls ?? 0), costCents: Math.round(Number(r?.micro ?? 0) / 10_000), accepted: Number(r?.accepted ?? 0), rejected: Number(r?.rejected ?? 0) };
}
