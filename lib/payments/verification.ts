/**
 * The verification job — the ONLY code path that confirms a payment (§3.1).
 *
 * For each job:
 *   1. direct status query to the provider (mandatory; a callback body is
 *      never trusted for facts);
 *   2. decide, read-only, what the transaction means for our intents;
 *   3. insert the permanent dedupe row (provider, providerTxRef) carrying
 *      that decision — a second look at the same reference stops here;
 *   4. apply the effects: transition the PaymentIntent through the payment
 *      machine, progress the order/batch, write the LedgerEvent.
 * All of it in one transaction marked app.verifier=on, so the DB trigger
 * allows the status change and a crash mid-way leaves no dedupe row.
 */
import { and, asc, eq, isNull, lt, lte, ne, or, sql } from "drizzle-orm";
import { getDb, type Tx } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import { paymentMachine, amountMatches, type VerificationEvidence } from "@/lib/domain/payments";
import { humanCode } from "@/lib/crypto/random";
import { tzs } from "@/lib/money";
import { providerById } from "./index";
import { ProviderUnavailableError, type ProviderTransaction } from "./provider";
import { actAsVerifier, logSecurityEvent, recordLedgerEvent, withTx, VERIFIER } from "@/lib/services/core";
import { onPaymentConfirmed, onPaymentReview } from "@/lib/services/orders";
import { ensureOpenIntent, paidTotals } from "@/lib/services/payments";
import { PAYABLE_ORDER_STATES } from "@/lib/domain/orders";
import type { ProviderId } from "@/lib/env";

export type JobOutcome =
  | "CONFIRMED"
  | "DUPLICATE"
  | "NOT_FOUND"
  | "PROVIDER_PENDING"
  | "PROVIDER_FAILED"
  | "UNMATCHED"
  | "WRONG_AMOUNT"
  | "OVERPAYMENT"
  | "PAYEE_MISMATCH"
  | "REVERSED"
  | "SIGNATURE_INVALID"
  | "NO_TX"
  | "RETRY";

const MAX_ATTEMPTS = 8;

function backoffMs(attempt: number): number {
  return Math.min(60 * 60_000, 30_000 * 2 ** Math.max(0, attempt - 1));
}

type ClaimedJob = Pick<typeof s.verificationJobs.$inferSelect, "id" | "providerTransactionId" | "paymentIntentId" | "provider" | "providerTxRef" | "attempts">;

/** Claim one due job with SKIP LOCKED so concurrent runners never double-process. */
async function claimJob(tx: Tx, jobId?: string): Promise<ClaimedJob | null> {
  const rows = await tx.execute<Record<string, unknown>>(sql`
    update verification_jobs set status = 'RUNNING', attempts = attempts + 1, updated_at = now()
    where id = (
      select id from verification_jobs
      where status in ('QUEUED','RETRY') and next_run_at <= now() ${jobId ? sql`and id = ${jobId}` : sql``}
      order by created_at asc limit 1 for update skip locked
    )
    returning id, provider_transaction_id as "providerTransactionId", payment_intent_id as "paymentIntentId",
      provider, provider_tx_ref as "providerTxRef", attempts
  `);
  const r = rows.rows[0];
  if (!r) return null;
  return {
    id: r.id as string,
    providerTransactionId: r.providerTransactionId === null ? null : Number(r.providerTransactionId),
    paymentIntentId: (r.paymentIntentId as string | null) ?? null,
    provider: r.provider as string,
    providerTxRef: (r.providerTxRef as string | null) ?? null,
    attempts: Number(r.attempts),
  };
}

async function openReviewException(tx: Tx, type: (typeof s.exceptions.$inferInsert)["type"], intentId: string | null, orderId: string | null, note: string) {
  const dup = intentId
    ? await tx.query.exceptions.findFirst({ where: and(eq(s.exceptions.paymentIntentId, intentId), eq(s.exceptions.type, type), ne(s.exceptions.status, "RESOLVED")) })
    : null;
  if (dup) return;
  await tx.insert(s.exceptions).values({ ref: `EX-${humanCode(6)}`, type, orderId, paymentIntentId: intentId, reportedBySystem: true, note });
  if (orderId) {
    const o = await tx.query.orders.findFirst({ where: eq(s.orders.id, orderId), columns: { ref: true } });
    await recordLedgerEvent(tx, { type: "PAYMENT_REVIEW", subjectRef: o?.ref ?? orderId, orderId, role: "SYSTEM" });
  }
}

/** Insert the permanent dedupe row. Returns false if this providerTxRef was already decided. */
async function recordDedupe(tx: Tx, provider: string, providerTxRef: string, outcome: string, intentId: string | null): Promise<boolean> {
  // ON CONFLICT DO NOTHING keeps the transaction alive on a duplicate (a
  // caught unique-violation would abort the whole transaction in Postgres).
  const inserted = await tx
    .insert(s.providerTxDedupe)
    .values({ provider, providerTxRef, outcome, paymentIntentId: intentId })
    .onConflictDoNothing()
    .returning({ ref: s.providerTxDedupe.providerTxRef });
  return inserted.length === 1;
}

async function moveToReview(tx: Tx, intent: typeof s.paymentIntents.$inferSelect, reason: string, evidence: VerificationEvidence) {
  const res = paymentMachine.transition(intent.status, "FAIL_OR_REVIEW", "SYSTEM_VERIFIER", evidence);
  if (!res.ok) return; // already confirmed or already in review — leave it
  await tx.update(s.paymentIntents).set({ status: res.to, reviewReason: reason, updatedAt: new Date() }).where(eq(s.paymentIntents.id, intent.id));
  const order = await tx.query.orders.findFirst({ where: eq(s.orders.id, intent.orderId) });
  if (order) await onPaymentReview(tx, order);
}

/**
 * Verify one provider transaction against our intents. Runs inside the
 * caller's verifier transaction. `sigOk` is null when the provider has no
 * signatures, false when a callback carried a bad one.
 */
export async function verifyTransaction(
  tx: Tx,
  provider: ProviderId,
  ptx: ProviderTransaction,
  source: "CALLBACK" | "POLL",
  sigOk: boolean | null,
): Promise<JobOutcome> {
  const providerQueried = true;
  // A pending provider transaction is not a decision yet: no dedupe row.
  if (ptx.status === "PENDING") return "PROVIDER_PENDING";
  // A reference that was already decided is never looked at again (and never opens a new intent).
  const already = await tx.query.providerTxDedupe.findFirst({ where: and(eq(s.providerTxDedupe.provider, provider), eq(s.providerTxDedupe.providerTxRef, ptx.providerTxRef)) });
  if (already && ptx.status !== "REVERSED") {
    if (source === "CALLBACK") await logSecurityEvent(tx, "CALLBACK_DUPLICATE", "WARN", { details: { provider, ref: ptx.providerTxRef, source } });
    return "DUPLICATE";
  }

  const order = await tx.query.orders.findFirst({ where: eq(s.orders.paymentRef, ptx.accountReference) });
  const intents = order
    ? await tx.select().from(s.paymentIntents).where(eq(s.paymentIntents.orderId, order.id)).orderBy(asc(s.paymentIntents.createdAt)).for("update")
    : [];
  // Only a PENDING intent can be confirmed. If the order is still payable but has no
  // open intent (e.g. the previous one went to review), open a fresh one now so a
  // legitimate payment is never lost; a review'd intent is never rewritten.
  let pending = intents.find((i) => i.status === "PAYMENT_PENDING");
  if (!pending && order && ptx.status === "SUCCESS" && PAYABLE_ORDER_STATES.includes(order.state)) {
    const totals = await paidTotals(tx, order);
    if (totals.remainingTzs > 0) pending = await ensureOpenIntent(tx, order);
  }

  if (ptx.status === "REVERSED") {
    const confirmed = intents.find((i) => i.providerTxRef === ptx.providerTxRef && i.status === "PAYMENT_CONFIRMED");
    if (confirmed) {
      const res = paymentMachine.transition(confirmed.status, "REVERSED", "SYSTEM_VERIFIER", { providerQueried, providerStatus: "REVERSED" });
      if (res.ok) {
        await tx.update(s.paymentIntents).set({ status: res.to, reviewReason: "PAYMENT_REVERSED", updatedAt: new Date() }).where(eq(s.paymentIntents.id, confirmed.id));
        await openReviewException(tx, "PAYMENT_REVERSED", confirmed.id, confirmed.orderId, `Provider reports reversal of ${ptx.providerTxRef}`);
        await logSecurityEvent(tx, "PAYMENT_REVERSED", "ALERT", { details: { orderId: confirmed.orderId } });
      }
      return "REVERSED";
    }
    if (!(await recordDedupe(tx, provider, ptx.providerTxRef, "REVERSED", null))) return "DUPLICATE";
    return "REVERSED";
  }

  if (ptx.status === "FAILED") {
    if (!(await recordDedupe(tx, provider, ptx.providerTxRef, "PROVIDER_FAILED", pending?.id ?? null))) return "DUPLICATE";
    if (pending && pending.payerClaimedAt) {
      await openReviewException(tx, "UNMATCHED_PAYMENT", pending.id, pending.orderId, `Provider reports FAILED for ${ptx.providerTxRef}`);
    }
    return "PROVIDER_FAILED";
  }

  // ---- SUCCESS: decide first, read-only ----
  let outcome: JobOutcome;
  let evidence: VerificationEvidence | null = null;
  let remaining = 0;
  if (sigOk === false) outcome = "SIGNATURE_INVALID";
  else if (!order || !pending) outcome = "UNMATCHED";
  else {
    const totals = await paidTotals(tx, order);
    remaining = totals.remainingTzs;
    const amount = amountMatches(pending.amountRule, tzs(ptx.amountTzs), tzs(totals.remainingTzs));
    const payeeMatched = ptx.payeeAccount === pending.payeeAccount;
    evidence = {
      source,
      providerQueried,
      providerStatus: "SUCCESS",
      dedupeRecorded: true, // inserted below, before any effect
      amountMatched: amount.ok,
      payeeMatched,
      signatureOk: sigOk === null ? undefined : sigOk,
    };
    if (!payeeMatched) outcome = "PAYEE_MISMATCH";
    else if (!amount.ok) outcome = amount.reason;
    else outcome = paymentMachine.transition(pending.status, "CONFIRM", "SYSTEM_VERIFIER", evidence).ok ? "CONFIRMED" : "UNMATCHED";
  }

  // ---- permanent dedupe, then effects ----
  if (!(await recordDedupe(tx, provider, ptx.providerTxRef, outcome, pending?.id ?? null))) {
    await logSecurityEvent(tx, "CALLBACK_DUPLICATE", "WARN", { details: { provider, ref: ptx.providerTxRef, source } });
    return "DUPLICATE";
  }

  switch (outcome) {
    case "SIGNATURE_INVALID":
      await logSecurityEvent(tx, "CALLBACK_SIGNATURE_INVALID", "ALERT", { details: { provider, ref: ptx.providerTxRef } });
      if (pending) await openReviewException(tx, "UNMATCHED_PAYMENT", pending.id, pending.orderId, `Bad signature on callback ${ptx.providerTxRef}`);
      return outcome;
    case "UNMATCHED":
      await openReviewException(tx, "UNMATCHED_PAYMENT", pending?.id ?? null, order?.id ?? null, `No matching pending intent for account ref ${ptx.accountReference} (tx ${ptx.providerTxRef}, ${ptx.amountTzs} TZS)`);
      return outcome;
    case "PAYEE_MISMATCH":
      await moveToReview(tx, pending!, outcome, evidence!);
      await openReviewException(tx, "PAYEE_MISMATCH", pending!.id, order!.id, `Paid to ${ptx.payeeAccount}, expected ${pending!.payeeAccount} (tx ${ptx.providerTxRef})`);
      return outcome;
    case "WRONG_AMOUNT":
    case "OVERPAYMENT":
      await moveToReview(tx, pending!, outcome, evidence!);
      await openReviewException(tx, outcome, pending!.id, order!.id, `Provider amount ${ptx.amountTzs} TZS vs remaining ${remaining} TZS (tx ${ptx.providerTxRef})`);
      return outcome;
    case "CONFIRMED": {
      const res = paymentMachine.transition(pending!.status, "CONFIRM", "SYSTEM_VERIFIER", evidence!);
      if (!res.ok) throw new Error(`verifier: unexpected refusal ${res.reason}`);
      await tx
        .update(s.paymentIntents)
        .set({ status: res.to, confirmedAmountTzs: ptx.amountTzs, providerTxRef: ptx.providerTxRef, confirmedAt: new Date(), reviewReason: null, updatedAt: new Date() })
        .where(eq(s.paymentIntents.id, pending!.id));
      await recordLedgerEvent(tx, { type: "PAYMENT_CONFIRMED", subjectRef: order!.ref, orderId: order!.id, amountTzs: ptx.amountTzs, role: purposeRole(pending!.purpose) });
      await onPaymentConfirmed(tx, order!, ptx.amountTzs);
      return outcome;
    }
    default:
      return outcome;
  }
}

function purposeRole(p: string): string {
  return { SUPPLIER_SALE: "BOSS_RIDER", HUB_SALE: "HUB_MANAGER", CHAMPION_SALE: "FIELD_CHAMPION", CUSTOMER_SALE: "CUSTOMER" }[p] ?? "UNKNOWN";
}

/** Run one job (by id, or the next due one). Returns the outcome or null if nothing was due. */
export async function runVerificationJob(jobId?: string): Promise<JobOutcome | null> {
  return withTx(async (tx) => {
    await actAsVerifier(tx);
    const job = await claimJob(tx, jobId);
    if (!job) return null;
    const provider = providerById(job.provider as ProviderId);
    const finish = (outcome: JobOutcome, status: "DONE" | "RETRY" | "DEAD" = "DONE", err?: string) =>
      tx
        .update(s.verificationJobs)
        .set({ status, outcome, lastError: err ?? null, nextRunAt: status === "RETRY" ? new Date(Date.now() + backoffMs(job.attempts)) : new Date(), updatedAt: new Date() })
        .where(eq(s.verificationJobs.id, job.id));

    try {
      let sigOk: boolean | null = null;
      let refs: string[] = [];
      const candidates: ProviderTransaction[] = [];

      if (job.providerTransactionId !== null) {
        const raw = await tx.query.providerTransactions.findFirst({ where: eq(s.providerTransactions.id, job.providerTransactionId) });
        if (!raw) {
          await finish("NO_TX");
          return "NO_TX";
        }
        const parsed = provider.parseCallback(raw.payload);
        sigOk = parsed.signatureOk;
        refs = [parsed.providerTxRef];
      } else if (job.providerTxRef) {
        refs = [job.providerTxRef];
      } else if (job.paymentIntentId) {
        const intent = await tx.query.paymentIntents.findFirst({ where: eq(s.paymentIntents.id, job.paymentIntentId) });
        const order = intent ? await tx.query.orders.findFirst({ where: eq(s.orders.id, intent.orderId) }) : null;
        if (!intent || !order) {
          await finish("NO_TX");
          return "NO_TX";
        }
        candidates.push(...(await provider.findByAccountReference(order.paymentRef)));
        if (candidates.length === 0) {
          // Nothing at the provider yet — retry with backoff until the poller gives up.
          await finish("NOT_FOUND", job.attempts >= MAX_ATTEMPTS ? "DEAD" : "RETRY");
          return "NOT_FOUND";
        }
      }

      for (const ref of refs) {
        const ptx = await provider.queryTransaction(ref);
        if (!ptx) {
          await logSecurityEvent(tx, "CALLBACK_SPOOFED", "ALERT", { details: { provider: job.provider, ref } });
          await finish("NOT_FOUND");
          return "NOT_FOUND";
        }
        candidates.push(ptx);
      }

      let last: JobOutcome = "NO_TX";
      for (const ptx of candidates) {
        last = await verifyTransaction(tx, provider.id, ptx, job.providerTransactionId !== null ? "CALLBACK" : "POLL", sigOk);
      }
      if (last === "PROVIDER_PENDING") await finish(last, job.attempts >= MAX_ATTEMPTS ? "DEAD" : "RETRY");
      else await finish(last);
      return last;
    } catch (e) {
      if (e instanceof ProviderUnavailableError) {
        await finish("RETRY", job.attempts >= MAX_ATTEMPTS ? "DEAD" : "RETRY", e.message);
        return "RETRY";
      }
      throw e;
    }
  });
}

/** Drain due jobs (cron poller / after callbacks). */
export async function runDueVerificationJobs(max = 25): Promise<JobOutcome[]> {
  const out: JobOutcome[] = [];
  for (let i = 0; i < max; i++) {
    const r = await runVerificationJob();
    if (r === null) break;
    out.push(r);
  }
  return out;
}

/**
 * Poller: every still-pending intent older than `olderThanMs` gets a poll
 * job if none is queued. This is what rescues a missed callback.
 */
export async function enqueueStalePolls(olderThanMs = 2 * 60_000): Promise<number> {
  const db = getDb();
  const cutoff = new Date(Date.now() - olderThanMs);
  const stale = await db
    .select({ id: s.paymentIntents.id, provider: s.paymentIntents.provider })
    .from(s.paymentIntents)
    .leftJoin(
      s.verificationJobs,
      and(eq(s.verificationJobs.paymentIntentId, s.paymentIntents.id), or(eq(s.verificationJobs.status, "QUEUED"), eq(s.verificationJobs.status, "RETRY"), eq(s.verificationJobs.status, "RUNNING"))),
    )
    .where(and(eq(s.paymentIntents.status, "PAYMENT_PENDING"), lte(s.paymentIntents.createdAt, cutoff), isNull(s.verificationJobs.id)))
    .limit(100);
  for (const i of stale) await db.insert(s.verificationJobs).values({ paymentIntentId: i.id, provider: i.provider });
  // Also revive RUNNING jobs whose runner died (older than 10 minutes).
  await db
    .update(s.verificationJobs)
    .set({ status: "RETRY", nextRunAt: new Date() })
    .where(and(eq(s.verificationJobs.status, "RUNNING"), lt(s.verificationJobs.updatedAt, new Date(Date.now() - 10 * 60_000))));
  return stale.length;
}

export { VERIFIER };
