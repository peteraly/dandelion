"use server";

import { redirect } from "next/navigation";
import { act, bool, checks, str } from "@/lib/actions";
import { fieldActorFromCookies, clientIp, deviceId } from "@/lib/auth/current";
import { revokeAllSessions } from "@/lib/auth/session";
import { idempotent, DomainError } from "@/lib/services/core";
import * as orders from "@/lib/services/orders";
import { reportProblem } from "@/lib/services/exceptions";
import { createCustomer, resendCustomerOtp, verifyCustomerPhone } from "@/lib/services/customers";
import { syncOfflineNotes } from "@/lib/services/notes";
import { lockUser } from "@/lib/services/users";
import { recordDecision } from "@/lib/services/ai-gateway";
import { requestWithdrawal } from "@/lib/services/wallets";
import { acceptCustomerRequest } from "@/lib/services/shop";
import type { Actor } from "@/lib/policy";
import { PolicyError } from "@/lib/policy";

async function me(): Promise<Actor> {
  // The field session only: a browser may also hold an admin session (founders testing both; the open demo's role switch).
  const a = await fieldActorFromCookies();
  if (!a || a.role === "SUPER_ADMIN") redirect("/login?expired=1");
  return a;
}

/** Mutations carry a per-render idempotency key so a double tap or a retried 3G request applies once. */
async function once<T extends object | null>(actor: Actor, fd: FormData, action: string, fn: () => Promise<T>): Promise<T> {
  const key = str(fd, "idem");
  if (!key) throw new DomainError("missing_idempotency_key");
  const { result } = await idempotent(actor.userId, key, action, async () => fn());
  return result;
}

const orderPath = (id: string) => `/orders/${id}`;

export async function confirmBatchReadyAction(fd: FormData): Promise<void> {
  const actor = await me();
  const id = str(fd, "orderId");
  await act(orderPath(id), () => once(actor, fd, "confirmBatchReady", async () => (await orders.confirmBatchReady(actor, id, str(fd, "sealId")), null)), orderPath(id));
}

export async function acceptPickupAction(fd: FormData): Promise<void> {
  const actor = await me();
  const id = str(fd, "orderId");
  await act(orderPath(id), () => once(actor, fd, "acceptPickup", async () => (await orders.acceptPickup(actor, id), null)), orderPath(id));
}

export async function claimPaidAction(fd: FormData): Promise<void> {
  const actor = await me();
  const id = str(fd, "orderId");
  await act(orderPath(id), () => once(actor, fd, "claimPaid", () => orders.claimPaid(actor, id)), orderPath(id), "checking");
}

export async function confirmReleaseAction(fd: FormData): Promise<void> {
  const actor = await me();
  const id = str(fd, "orderId");
  await act(orderPath(id), () => once(actor, fd, "confirmRelease", async () => (await orders.confirmRelease(actor, id), null)), orderPath(id));
}

export async function confirmReceiptAction(fd: FormData): Promise<void> {
  const actor = await me();
  const id = str(fd, "orderId");
  await act(
    orderPath(id),
    () => once(actor, fd, "confirmReceipt", async () => (await orders.confirmReceipt(actor, id, { quantityOk: bool(fd, "quantityOk"), sealOk: bool(fd, "sealOk") }), null)),
    orderPath(id),
  );
}

export async function startInspectionAction(fd: FormData): Promise<void> {
  const actor = await me();
  const id = str(fd, "orderId");
  await act(orderPath(id), () => once(actor, fd, "startInspection", async () => (await orders.startInspection(actor, id, str(fd, "code")), null)), orderPath(id));
}

const INSPECTION_KEYS = ["correctRider", "correctProduct", "correctCount", "correctBatch", "sealIntact", "goodCondition", "noWaterDamage"] as const;

export async function passInspectionAction(fd: FormData): Promise<void> {
  const actor = await me();
  const id = str(fd, "orderId");
  await act(orderPath(id), () => once(actor, fd, "passInspection", async () => (await orders.passInspection(actor, id, checks(fd, INSPECTION_KEYS)), null)), orderPath(id));
}

export async function prepareTransferAction(fd: FormData): Promise<void> {
  const actor = await me();
  const id = str(fd, "orderId");
  await act(orderPath(id), () => once(actor, fd, "prepareTransfer", async () => (await orders.prepareTransfer(actor, id), null)), orderPath(id));
}

export async function declineRequestAction(fd: FormData): Promise<void> {
  const actor = await me();
  const id = str(fd, "orderId");
  await act(orderPath(id), () => once(actor, fd, "declineRequest", async () => (await orders.declineStockRequest(actor, id), null)), "/home");
}

export async function requestStockAction(fd: FormData): Promise<void> {
  const actor = await me();
  await act(
    "/stock/request",
    () => once(actor, fd, "requestStock", () => orders.requestStock(actor, { productId: str(fd, "productId"), quantity: Number(str(fd, "quantity")) })),
    (r) => orderPath(r.orderId),
  );
}

export async function expectPaymentAction(fd: FormData): Promise<void> {
  const actor = await me();
  const id = str(fd, "orderId");
  await act(orderPath(id), () => once(actor, fd, "expectPayment", () => orders.expectCustomerPayment(actor, id)), orderPath(id), "checking");
}

export async function startHandoverAction(fd: FormData): Promise<void> {
  const actor = await me();
  const id = str(fd, "orderId");
  await act(orderPath(id), () => once(actor, fd, "startHandover", async () => (await orders.startHandover(actor, id), null)), orderPath(id));
}

export async function resendHandoverCodeAction(fd: FormData): Promise<void> {
  const actor = await me();
  const id = str(fd, "orderId");
  await act(orderPath(id), () => once(actor, fd, "resendHandoverCode", async () => (await orders.resendHandoverCode(actor, id), null)), orderPath(id), "codeSent");
}

const EDUCATION_KEYS = ["wash", "dry", "store", "whenNotToUse", "whenToSeekCare", "safeUse", "disposal"] as const;

export async function completeHandoverAction(fd: FormData): Promise<void> {
  const actor = await me();
  const id = str(fd, "orderId");
  const edu = Object.fromEntries(Object.entries(checks(fd, EDUCATION_KEYS)).filter(([, v]) => v));
  await act(orderPath(id), () => once(actor, fd, "completeHandover", () => orders.completeHandover(actor, id, str(fd, "code"), edu)), orderPath(id), "receiptSent");
}

export async function closePlanAction(fd: FormData): Promise<void> {
  const actor = await me();
  const id = str(fd, "orderId");
  await act(orderPath(id), () => once(actor, fd, "closePlan", async () => (await orders.closePlan(actor, id), null)), "/home");
}

export async function refundReviewAction(fd: FormData): Promise<void> {
  const actor = await me();
  const id = str(fd, "orderId");
  await act(orderPath(id), () => once(actor, fd, "refundReview", () => orders.requestRefundReview(actor, id, str(fd, "reason"))), orderPath(id), "refundOpened");
}

export async function reportProblemAction(fd: FormData): Promise<void> {
  const actor = await me();
  const orderId = str(fd, "orderId") || undefined;
  const batchId = str(fd, "batchId") || undefined;
  const aiInteractionId = str(fd, "aiInteractionId");
  const back = orderId ? `/problem?orderId=${orderId}` : "/problem";
  await act(
    back,
    () =>
      once(actor, fd, "reportProblem", async () => {
        const r = await reportProblem(actor, { type: str(fd, "type") as never, orderId, batchId, note: str(fd, "note") || undefined });
        // The human confirmed (or edited) the AI proposal by submitting: record the decision on the draft.
        if (aiInteractionId) await recordDecision(aiInteractionId, true).catch(() => undefined);
        return r;
      }),
    (r) => `/problem/done?ref=${r.exceptionRef}&locked=${r.lockedBatch ? 1 : 0}`,
  );
}

export async function createCustomerAction(fd: FormData): Promise<void> {
  const actor = await me();
  await act(
    "/customers/new",
    () =>
      once(actor, fd, "createCustomer", async () =>
        createCustomer(
          actor,
          { displayName: str(fd, "displayName"), phone: str(fd, "phone"), consentMessages: bool(fd, "consentMessages") as true, consentReminders: bool(fd, "consentReminders") },
          await deviceId(),
          await clientIp(),
        ),
      ),
    (r) => `/customers/${r.customerId}?challenge=${r.challengeId}`,
    "codeSentToCustomer",
  );
}

export async function verifyCustomerAction(fd: FormData): Promise<void> {
  const actor = await me();
  const id = str(fd, "customerId");
  await act(`/customers/${id}?challenge=${str(fd, "challengeId")}`, () => verifyCustomerPhone(actor, id, str(fd, "challengeId"), str(fd, "code")), `/customers/${id}`);
}

export async function resendCustomerOtpAction(fd: FormData): Promise<void> {
  const actor = await me();
  const id = str(fd, "customerId");
  await act(`/customers/${id}`, async () => resendCustomerOtp(actor, id, await deviceId(), await clientIp()), (r) => `/customers/${id}?challenge=${r.challengeId}`, "codeSentToCustomer");
}

export async function startPlanAction(fd: FormData): Promise<void> {
  const actor = await me();
  const id = str(fd, "customerId");
  await act(`/customers/${id}`, () => once(actor, fd, "startPlan", () => orders.startPlan(actor, id, str(fd, "productId"))), (r) => orderPath(r.orderId));
}

export async function syncNotesAction(notes: unknown[]): Promise<{ synced: number } | { error: string }> {
  try {
    const actor = await me();
    return await syncOfflineNotes(actor, notes);
  } catch (e) {
    return { error: e instanceof PolicyError ? "forbidden" : "unknown" };
  }
}

/** Lock my own account from inside the app (no PIN needed: the session proves identity). */
export async function lockSelfAction(): Promise<void> {
  const actor = await me();
  await lockUser(actor.userId, "self_lock", null, await clientIp());
  await revokeAllSessions(actor.userId);
  redirect("/lock?ok=locked");
}

// ---------- organisation sales (prompt §8.8.4) ----------

export async function createOrgSaleAction(fd: FormData): Promise<void> {
  const actor = await me();
  await act(
    "/org-sales/new",
    () => once(actor, fd, "createOrgSale", () => orders.createOrgSale(actor, { organisationId: str(fd, "organisationId"), productId: str(fd, "productId"), quantity: Number(str(fd, "quantity")) })),
    (r) => orderPath(r.orderId),
    "created",
  );
}

export async function deliverOrgAction(fd: FormData): Promise<void> {
  const actor = await me();
  const id = str(fd, "orderId");
  await act(orderPath(id), () => once(actor, fd, "deliverOrg", () => orders.deliverOrgSale(actor, id)), orderPath(id), "delivered");
}

export async function cancelOrgSaleAction(fd: FormData): Promise<void> {
  const actor = await me();
  const id = str(fd, "orderId");
  await act(orderPath(id), () => once(actor, fd, "cancelOrgSale", async () => (await orders.cancelOrgSale(actor, id), null)), orderPath(id));
}


/** A member asks to withdraw from their balance (Prompt L §2.2); admins approve and send. */
export async function requestWithdrawalAction(fd: FormData): Promise<void> {
  const actor = await me();
  await act("/wallet", () => once(actor, fd, "requestWithdrawal", async () => (await requestWithdrawal(actor, { amountTzs: Number(str(fd, "amountTzs")) }), null)), "/wallet", "withdrawalRequested");
}

/** A delivery partner takes a customer's shop request; it becomes their plan with her (Prompt L §3). */
export async function acceptShopRequestAction(fd: FormData): Promise<void> {
  const actor = await me();
  await act("/home", () => once(actor, fd, "acceptShopRequest", () => acceptCustomerRequest(actor, str(fd, "requestId"))), (r) => orderPath(r.orderId), "requestAccepted");
}
