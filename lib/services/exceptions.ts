/**
 * Problems and exceptions (handbook §12). Reporting a stock problem locks the
 * batch (INSPECTION_ISSUE / DAMAGED_OR_QUARANTINED); nothing moves until a
 * dual-approved resolution (§3.4). Resolution is executed only by the
 * approvals executor.
 */
import { now } from "@/lib/clock";
import { and, desc, eq, ne } from "drizzle-orm";
import { z } from "zod";
import { getDb, type Tx } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import { EXCEPTION_TYPES, LOCKING_PROBLEMS, REPORTABLE_PROBLEMS } from "@/lib/domain/types";
import type { DualApprovalProof } from "@/lib/domain/approval";
import { isLocked } from "@/lib/domain/custody";
import { authorize, type Actor } from "@/lib/policy";
import { humanCode } from "@/lib/crypto/random";
import { DomainError, logAdminAction, logSecurityEvent, recordLedgerEvent, withTx, APPROVALS } from "./core";
import { applyCustody, lockBatch } from "./custody";
import { applyOrder, lockOrder, orderResource, asService } from "./orders";
import type { ExceptionResolvePayload } from "./approvals";

export const ReportProblemSchema = z
  .object({
    type: z.enum(REPORTABLE_PROBLEMS),
    orderId: z.string().uuid().optional(),
    batchId: z.string().uuid().optional(),
    note: z.string().trim().max(500).optional(),
  })
  .strict();
export type ReportProblemInput = z.input<typeof ReportProblemSchema>;

export async function reportProblem(actor: Actor, raw: ReportProblemInput): Promise<{ exceptionRef: string; lockedBatch: boolean }> {
  const input = ReportProblemSchema.parse(raw);
  return withTx(async (tx) => {
    let order = input.orderId ? await lockOrder(tx, input.orderId) : null;
    let batch = input.batchId ? await lockBatch(tx, input.batchId) : null;
    if (order && !batch && order.batchId) batch = await lockBatch(tx, order.batchId);
    if (order) authorize(actor, "exception.report", { type: "order", order: await orderResource(tx, order) });
    else if (batch) authorize(actor, "exception.report", { type: "batch", batch: { custodianUserId: batch.custodianUserId, hubId: batch.hubId, supplierId: batch.supplierId } });
    else authorize(actor, "exception.report");

    const lockTo = LOCKING_PROBLEMS[input.type];
    let lockedBatch = false;
    if (lockTo && batch && !isLocked(batch.custodyState)) {
      const event = lockTo === "INSPECTION_ISSUE" ? "INSPECTION_FAILED" : "QUARANTINE";
      // INSPECTION_FAILED is only valid during inspection; otherwise quarantine.
      const ev = event === "INSPECTION_FAILED" && batch.custodyState !== "AT_HUB_INSPECTION" ? "QUARANTINE" : event;
      batch = await applyCustody(tx, batch, ev, asService(actor), {}, { orderId: order?.id ?? null });
      lockedBatch = true;
      if (order && order.kind === "RIDER_TO_HUB" && order.state === "INSPECTING") {
        order = await applyOrder(tx, order, "INSPECTION_FAILED", asService(actor), {});
      }
    }
    const ref = `EX-${humanCode(6)}`;
    await tx.insert(s.exceptions).values({
      ref,
      type: input.type,
      orderId: order?.id ?? null,
      batchId: batch?.id ?? null,
      reportedBy: actor.userId,
      note: input.note ?? null,
      lockedBatch,
    });
    await recordLedgerEvent(tx, { type: "EXCEPTION_RAISED", subjectRef: batch?.code ?? order?.ref ?? ref, batchId: batch?.id ?? null, orderId: order?.id ?? null, role: actor.role });
    if (input.type === "SUSPECTED_THEFT") {
      await logSecurityEvent(tx, `PROBLEM_${input.type}`, "ALERT", { userId: actor.userId, details: { ref } });
    }
    return { exceptionRef: ref, lockedBatch };
  });
}

/** Admin proposes a resolution → an approval request (executed by a second admin). */
export async function proposeResolution(actor: Actor, exceptionId: string, outcome: "RESUME" | "RETURN" | "CLOSE", note: string): Promise<{ requestId: string }> {
  authorize(actor, "admin.approval.request");
  return withTx(async (tx) => {
    const ex = await tx.query.exceptions.findFirst({ where: eq(s.exceptions.id, exceptionId) });
    if (!ex || ex.status !== "OPEN") throw new DomainError("exception_not_open");
    if (ex.batchId && outcome === "CLOSE") {
      const batch = await tx.query.batches.findFirst({ where: eq(s.batches.id, ex.batchId) });
      if (batch && isLocked(batch.custodyState)) throw new DomainError("locked_batch_needs_resume_or_return");
    }
    const { createApprovalRequest } = await import("./approvals");
    const req = await createApprovalRequest(tx, actor, "EXCEPTION_RESOLVE", { exceptionId, outcome, note }, `Resolve ${ex.ref} (${ex.type}): ${outcome}`);
    await tx.update(s.exceptions).set({ status: "RESOLUTION_PENDING" }).where(eq(s.exceptions.id, exceptionId));
    return { requestId: req.id };
  });
}

/** Approvals executor only. */
export async function executeExceptionResolution(tx: Tx, p: z.infer<typeof ExceptionResolvePayload>, proof: DualApprovalProof, approverId: string): Promise<void> {
  const ex = await tx.query.exceptions.findFirst({ where: eq(s.exceptions.id, p.exceptionId) });
  if (!ex || ex.status === "RESOLVED") throw new DomainError("exception_not_open");
  if (ex.batchId) {
    const batch = await lockBatch(tx, ex.batchId);
    if (isLocked(batch.custodyState)) {
      // Other open exceptions on the same batch keep it locked.
      const others = await tx.query.exceptions.findFirst({
        where: and(eq(s.exceptions.batchId, batch.id), ne(s.exceptions.id, ex.id), ne(s.exceptions.status, "RESOLVED"), eq(s.exceptions.lockedBatch, true)),
      });
      if (!others) {
        const event = p.outcome === "RETURN" ? "RESOLVE_RETURN" : "RESOLVE_RESUME";
        await applyCustody(tx, batch, event, APPROVALS, { approval: proof, lockedFromState: batch.lockedFromState ?? undefined }, { orderId: ex.orderId });
      }
      if (ex.orderId) {
        const order = await lockOrder(tx, ex.orderId);
        if (order.state === "ON_HOLD") await applyOrder(tx, order, p.outcome === "RETURN" ? "RETURN" : "RESUME", APPROVALS, { approval: proof });
      }
    }
  }
  await tx.update(s.exceptions).set({ status: "RESOLVED", resolution: `${p.outcome}: ${p.note}`, resolvedAt: now() }).where(eq(s.exceptions.id, ex.id));
  await recordLedgerEvent(tx, { type: "EXCEPTION_RESOLVED", subjectRef: ex.ref, batchId: ex.batchId, orderId: ex.orderId, role: "SUPER_ADMIN" });
  await logAdminAction(tx, approverId, "exception.resolved", { type: "exception", id: ex.id }, { outcome: p.outcome });
}

export async function openExceptions(actor: Actor) {
  authorize(actor, "admin.exception.view");
  return getDb().query.exceptions.findMany({ where: ne(s.exceptions.status, "RESOLVED"), orderBy: desc(s.exceptions.createdAt), limit: 200 });
}

export const EXCEPTION_TYPE_LIST = EXCEPTION_TYPES;
