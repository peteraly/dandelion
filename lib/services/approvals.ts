/**
 * Dual approvals (§3.14, §3.6, §4.7). A request is a signature from the
 * requester; `threshold` distinct admins in total approve; the requester can
 * never decide on their own request. Once approved, `execute` performs the
 * change inside a transaction marked app.approvals=on, and the request can
 * never be re-executed.
 */
import { now } from "@/lib/clock";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb, type Tx } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import { canDecide, evaluateApproval, type DualApprovalProof } from "@/lib/domain/approval";
import type { ApprovalType, OrderKind } from "@/lib/domain/types";
import { DIRECT_KINDS, isPlanKind } from "@/lib/domain/sales";
import { authorize, type Actor } from "@/lib/policy";
import { TzsSchema } from "@/lib/money";
import { sha256Hex } from "@/lib/crypto/random";
import { tzMonthStart } from "@/lib/util/time";
import { actAsApprovals, DomainError, getSetting, logAdminAction, logSecurityEvent, putSetting, recordLedgerEvent, withTx, SETTING_DEFAULTS, type SettingKey } from "./core";
import { activatePriceList } from "./pricing";
import { applyDonorFunding } from "./orders";
import { executeExceptionResolution } from "./exceptions";

export type ApprovalRequest = typeof s.approvalRequests.$inferSelect;

export const DonorFundingPayload = z
  .object({
    orderId: z.string().uuid(),
    donorRef: z.string().trim().min(2).max(120),
    amountTzs: TzsSchema.refine((n) => n > 0, "amount_positive"),
    evidenceId: z.string().uuid(),
  })
  .strict();

export const ExceptionResolvePayload = z
  .object({
    exceptionId: z.string().uuid(),
    outcome: z.enum(["RESUME", "RETURN", "CLOSE"]),
    note: z.string().trim().min(3).max(500),
  })
  .strict();

export const ProductAvailabilityPayload = z
  .object({ productId: z.string().uuid(), serviceAreaId: z.string().uuid(), available: z.boolean(), washConditionsConfirmed: z.boolean() })
  .strict();

export const SettingChangePayload = z.object({ key: z.string(), value: z.union([z.number().int(), z.boolean(), z.string()]) }).strict();

export const LargeExportPayload = z.object({ dataset: z.string().max(40), rows: z.number().int().nonnegative() }).strict();

/** Activate or deactivate a stakeholder organisation — a supplier (ADR-029) or a buyer organisation (prompt §8.8.4). Money flows to and from them; two admins decide who is one. */
export const StakeholderActivatePayload = z.union([
  z.object({ supplierId: z.string().uuid(), active: z.boolean() }).strict(),
  z.object({ organisationId: z.string().uuid(), active: z.boolean() }).strict(),
]);

/** Which sale paths beyond the ladder an area allows (prompt §8.8.2): it decides who earns, so two admins decide. */
export const AreaSalesPayload = z
  .object({ serviceAreaId: z.string().uuid(), allowedSales: z.array(z.enum(DIRECT_KINDS as [OrderKind, ...OrderKind[]])).max(DIRECT_KINDS.length) })
  .strict();

const PAYLOADS: Record<ApprovalType, z.ZodTypeAny> = {
  PRICE_LIST_ACTIVATE: z.object({ priceListId: z.string().uuid() }).strict(),
  EXCEPTION_RESOLVE: ExceptionResolvePayload,
  DONOR_FUNDING: DonorFundingPayload,
  LARGE_EXPORT: LargeExportPayload,
  SETTING_CHANGE: SettingChangePayload,
  PRODUCT_AVAILABILITY: ProductAvailabilityPayload,
  STAKEHOLDER_ACTIVATE: StakeholderActivatePayload,
  AREA_SALES_CHANGE: AreaSalesPayload,
};

/** Create a request inside an existing transaction (used by services). */
export async function createApprovalRequest(tx: Tx, actor: Actor, type: ApprovalType, payload: unknown, summary: string): Promise<ApprovalRequest> {
  authorize(actor, "admin.approval.request");
  const parsed = PAYLOADS[type].parse(payload);
  if (type === "DONOR_FUNDING") await validateDonorRequest(tx, parsed as z.infer<typeof DonorFundingPayload>);
  const threshold = await getSetting("approvalThreshold", tx);
  const [req] = await tx
    .insert(s.approvalRequests)
    .values({ type, payload: parsed as object, summary: summary.slice(0, 200), requestedBy: actor.userId, threshold, highlighted: type === "DONOR_FUNDING" })
    .returning();
  await logAdminAction(tx, actor.userId, "approval.request", { type: "approval", id: req!.id }, { type, summary }, type === "DONOR_FUNDING");
  return req!;
}

export async function requestApproval(actor: Actor, type: ApprovalType, payload: unknown, summary: string): Promise<{ requestId: string }> {
  const req = await withTx((tx) => createApprovalRequest(tx, actor, type, payload, summary));
  return { requestId: req.id };
}

/** Donor funding (§3.6): evidence attached, refers to donor+amount+order, within the monthly cap. */
async function validateDonorRequest(tx: Tx, p: z.infer<typeof DonorFundingPayload>): Promise<void> {
  const evidence = await tx.query.approvalEvidence.findFirst({ where: eq(s.approvalEvidence.id, p.evidenceId) });
  if (!evidence) throw new DomainError("donor_evidence_required");
  // Evidence rows are append-only; a file may back exactly one request.
  const bound = await tx.query.approvalRequests.findFirst({
    where: and(eq(s.approvalRequests.type, "DONOR_FUNDING"), sql`${s.approvalRequests.payload}->>'evidenceId' = ${p.evidenceId}`),
  });
  if (bound) throw new DomainError("donor_evidence_required");
  const order = await tx.query.orders.findFirst({ where: eq(s.orders.id, p.orderId) });
  if (!order || !isPlanKind(order.kind) || order.state !== "PLAN_ACTIVE") throw new DomainError("donor_order_invalid");
  const { paidTotals } = await import("./payments");
  const t = await paidTotals(tx, order);
  if (p.amountTzs > t.remainingTzs) throw new DomainError("donor_amount_exceeds_remaining");
  await assertDonorCap(tx, p.amountTzs);
}

async function assertDonorCap(tx: Tx, amountTzs: number): Promise<void> {
  const cap = await getSetting("donorMonthlyCapTzs", tx);
  const monthStart = tzMonthStart();
  const [approved] = await tx
    .select({ sum: sql<number>`coalesce(sum(${s.donorFundings.amountTzs}), 0)::int` })
    .from(s.donorFundings)
    .where(gte(s.donorFundings.approvedAt, monthStart));
  const pendingRows = await tx
    .select({ payload: s.approvalRequests.payload })
    .from(s.approvalRequests)
    .where(and(eq(s.approvalRequests.type, "DONOR_FUNDING"), eq(s.approvalRequests.status, "PENDING"), gte(s.approvalRequests.createdAt, monthStart)));
  const pendingSum = pendingRows.reduce((acc, r) => acc + Number((r.payload as { amountTzs?: number }).amountTzs ?? 0), 0);
  if (Number(approved?.sum ?? 0) + pendingSum + amountTzs > cap) throw new DomainError("donor_cap_exceeded");
}

export const EvidenceSchema = z.object({
  filename: z.string().trim().min(1).max(120),
  contentType: z.enum(["application/pdf", "image/jpeg", "image/png"]),
  data: z.instanceof(Buffer).refine((b) => b.length > 0 && b.length <= 5 * 1024 * 1024, "evidence_size"),
});

export async function uploadEvidence(actor: Actor, raw: z.input<typeof EvidenceSchema>): Promise<{ evidenceId: string; sha256: string }> {
  authorize(actor, "admin.approval.request");
  const e = EvidenceSchema.parse(raw);
  const sha256 = sha256Hex(e.data);
  const [row] = await getDb()
    .insert(s.approvalEvidence)
    .values({ filename: e.filename, contentType: e.contentType, sizeBytes: e.data.length, sha256, data: e.data, uploadedBy: actor.userId })
    .returning({ id: s.approvalEvidence.id });
  return { evidenceId: row!.id, sha256 };
}

/** Record a decision. If the request reaches its threshold it is executed immediately. */
export async function decideApproval(actor: Actor, requestId: string, decision: "APPROVE" | "REJECT", comment?: string): Promise<{ status: string }> {
  authorize(actor, "admin.approval.decide");
  return withTx(async (tx) => {
    const rows = await tx.select().from(s.approvalRequests).where(eq(s.approvalRequests.id, requestId)).for("update");
    const req = rows[0];
    if (!req) throw new DomainError("not_found");
    if (req.status !== "PENDING") throw new DomainError("approval_not_pending");
    const existing = await tx.query.approvalDecisions.findMany({ where: eq(s.approvalDecisions.requestId, requestId) });
    const refused = canDecide(req.requestedBy, actor.userId, existing);
    if (refused) {
      // Logged outside the transaction: the throw below rolls the transaction back.
      await logSecurityEvent(getDb(), refused === "self_approval" ? "SELF_APPROVAL_ATTEMPT" : "DUPLICATE_APPROVAL_ATTEMPT", "WARN", { userId: actor.userId, details: { requestId } });
      throw new DomainError(refused);
    }
    await tx.insert(s.approvalDecisions).values({ requestId, adminId: actor.userId, decision, comment: comment?.slice(0, 500) ?? null });
    const ev = evaluateApproval({ requesterId: req.requestedBy, threshold: req.threshold, decisions: [...existing, { adminId: actor.userId, decision }] });
    await logAdminAction(tx, actor.userId, decision === "APPROVE" ? "approval.approve" : "approval.reject", { type: "approval", id: requestId }, { type: req.type }, req.highlighted);
    if (ev.status === "REJECTED") {
      await tx.update(s.approvalRequests).set({ status: "REJECTED", decidedAt: now() }).where(eq(s.approvalRequests.id, requestId));
      await onRejected(tx, req);
      return { status: "REJECTED" };
    }
    if (ev.status !== "APPROVED") return { status: "PENDING" };
    await tx.update(s.approvalRequests).set({ status: "APPROVED", decidedAt: now() }).where(eq(s.approvalRequests.id, requestId));
    const proof: DualApprovalProof = { requesterId: req.requestedBy, approverIds: ev.approverIds, threshold: req.threshold };
    try {
      await actAsApprovals(tx);
      await execute(tx, req, proof, actor.userId);
      await tx.update(s.approvalRequests).set({ status: "EXECUTED", executedAt: now() }).where(eq(s.approvalRequests.id, requestId));
      return { status: "EXECUTED" };
    } catch (e) {
      // Execution failure must not lose the approval record: rethrow so the whole decision rolls back.
      throw e;
    }
  });
}

async function onRejected(tx: Tx, req: ApprovalRequest): Promise<void> {
  if (req.type === "PRICE_LIST_ACTIVATE") {
    const { priceListId } = req.payload as { priceListId: string };
    await tx.update(s.priceLists).set({ status: "REJECTED" }).where(eq(s.priceLists.id, priceListId));
  }
  if (req.type === "EXCEPTION_RESOLVE") {
    const { exceptionId } = req.payload as { exceptionId: string };
    await tx.update(s.exceptions).set({ status: "OPEN" }).where(eq(s.exceptions.id, exceptionId));
  }
}

async function execute(tx: Tx, req: ApprovalRequest, proof: DualApprovalProof, approverId: string): Promise<void> {
  switch (req.type) {
    case "PRICE_LIST_ACTIVATE": {
      const { priceListId } = req.payload as { priceListId: string };
      await activatePriceList(tx, priceListId);
      return;
    }
    case "DONOR_FUNDING": {
      const p = DonorFundingPayload.parse(req.payload);
      const evidence = await tx.query.approvalEvidence.findFirst({ where: eq(s.approvalEvidence.id, p.evidenceId) });
      if (!evidence) throw new DomainError("donor_evidence_required");
      await assertDonorCapAtExecution(tx, p.amountTzs);
      await tx.insert(s.donorFundings).values({ orderId: p.orderId, donorRef: p.donorRef, amountTzs: p.amountTzs, approvalRequestId: req.id, evidenceSha256: evidence.sha256 });
      await applyDonorFunding(tx, p.orderId, proof);
      const order = await tx.query.orders.findFirst({ where: eq(s.orders.id, p.orderId), columns: { ref: true } });
      await recordLedgerEvent(tx, { type: "DONOR_FUNDING_APPROVED", subjectRef: order?.ref ?? p.orderId, orderId: p.orderId, amountTzs: p.amountTzs, role: "SUPER_ADMIN" });
      await logAdminAction(tx, approverId, "donor_funding.approved", { type: "order", id: p.orderId }, { donorRef: p.donorRef, amountTzs: p.amountTzs, requestId: req.id }, true);
      await logSecurityEvent(tx, "DONOR_FUNDING_APPROVED", "INFO", { userId: approverId, details: { orderId: p.orderId, amountTzs: p.amountTzs } });
      return;
    }
    case "EXCEPTION_RESOLVE": {
      const p = ExceptionResolvePayload.parse(req.payload);
      await executeExceptionResolution(tx, p, proof, approverId);
      return;
    }
    case "PRODUCT_AVAILABILITY": {
      const p = ProductAvailabilityPayload.parse(req.payload);
      await tx
        .insert(s.productAreaAvailability)
        .values({ ...p, approvalRequestId: req.id })
        .onConflictDoUpdate({
          target: [s.productAreaAvailability.productId, s.productAreaAvailability.serviceAreaId],
          set: { available: p.available, washConditionsConfirmed: p.washConditionsConfirmed, approvalRequestId: req.id, updatedAt: now() },
        });
      return;
    }
    case "SETTING_CHANGE": {
      const p = SettingChangePayload.parse(req.payload);
      if (!(p.key in SETTING_DEFAULTS)) throw new DomainError("unknown_setting");
      const key = p.key as SettingKey;
      if (typeof SETTING_DEFAULTS[key] !== typeof p.value) throw new DomainError("setting_type_mismatch");
      if (key === "approvalThreshold" && (p.value as number) < 2) throw new DomainError("threshold_too_low");
      await putSetting(tx, key, p.value, approverId);
      return;
    }
    case "LARGE_EXPORT":
      // The export itself is generated by the export route once status is EXECUTED.
      return;
    case "STAKEHOLDER_ACTIVATE": {
      const p = StakeholderActivatePayload.parse(req.payload);
      if ("supplierId" in p) {
        const supplier = await tx.query.suppliers.findFirst({ where: eq(s.suppliers.id, p.supplierId) });
        if (!supplier) throw new DomainError("supplier_not_found");
        await tx.update(s.suppliers).set({ active: p.active, updatedAt: now() }).where(eq(s.suppliers.id, p.supplierId));
        if (p.active) await recordLedgerEvent(tx, { type: "STAKEHOLDER_ACTIVATED", subjectRef: `S-${sha256Hex(p.supplierId).slice(0, 10)}`, role: "SUPPLIER" });
        await logAdminAction(tx, approverId, p.active ? "supplier.activate" : "supplier.deactivate", { type: "supplier", id: p.supplierId }, { requestId: req.id });
        await logSecurityEvent(tx, p.active ? "SUPPLIER_ACTIVATED" : "SUPPLIER_DEACTIVATED", "INFO", { userId: approverId, details: { supplierId: p.supplierId } });
        return;
      }
      const org = await tx.query.organisations.findFirst({ where: eq(s.organisations.id, p.organisationId) });
      if (!org) throw new DomainError("organisation_not_found");
      await tx.update(s.organisations).set({ active: p.active, updatedAt: now() }).where(eq(s.organisations.id, p.organisationId));
      if (p.active) await recordLedgerEvent(tx, { type: "STAKEHOLDER_ACTIVATED", subjectRef: `O-${sha256Hex(p.organisationId).slice(0, 10)}`, role: "ORGANISATION" });
      await logAdminAction(tx, approverId, p.active ? "organisation.activate" : "organisation.deactivate", { type: "organisation", id: p.organisationId }, { requestId: req.id });
      await logSecurityEvent(tx, p.active ? "ORGANISATION_ACTIVATED" : "ORGANISATION_DEACTIVATED", "INFO", { userId: approverId, details: { organisationId: p.organisationId } });
      return;
    }
    case "AREA_SALES_CHANGE": {
      const p = AreaSalesPayload.parse(req.payload);
      const area = await tx.query.serviceAreas.findFirst({ where: eq(s.serviceAreas.id, p.serviceAreaId) });
      if (!area) throw new DomainError("not_found");
      await tx.update(s.serviceAreas).set({ allowedSales: [...new Set(p.allowedSales)] }).where(eq(s.serviceAreas.id, p.serviceAreaId));
      await logAdminAction(tx, approverId, "area.sales.change", { type: "service_area", id: p.serviceAreaId }, { allowedSales: p.allowedSales, requestId: req.id });
      return;
    }
  }
}

async function assertDonorCapAtExecution(tx: Tx, amountTzs: number): Promise<void> {
  const cap = await getSetting("donorMonthlyCapTzs", tx);
  const [approved] = await tx
    .select({ sum: sql<number>`coalesce(sum(${s.donorFundings.amountTzs}), 0)::int` })
    .from(s.donorFundings)
    .where(gte(s.donorFundings.approvedAt, tzMonthStart()));
  if (Number(approved?.sum ?? 0) + amountTzs > cap) throw new DomainError("donor_cap_exceeded");
}

export async function pendingApprovals(actor: Actor) {
  authorize(actor, "admin.dashboard");
  const reqs = await getDb().query.approvalRequests.findMany({ where: eq(s.approvalRequests.status, "PENDING"), orderBy: desc(s.approvalRequests.createdAt), limit: 100 });
  const decisions = reqs.length
    ? await getDb().query.approvalDecisions.findMany({ where: sql`${s.approvalDecisions.requestId} in ${reqs.map((r) => r.id)}` })
    : [];
  return reqs.map((r) => ({ ...r, decisions: decisions.filter((d) => d.requestId === r.id), canDecide: canDecide(r.requestedBy, actor.userId, decisions.filter((d) => d.requestId === r.id)) === null }));
}
