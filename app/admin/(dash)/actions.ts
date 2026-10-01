"use server";

import { redirect } from "next/navigation";
import { act, bool, str } from "@/lib/actions";
import { adminActorFromCookies } from "@/lib/auth/current";
import type { Actor } from "@/lib/policy";
import { adminCreatePickup } from "@/lib/services/orders";
import { adminLockUser, adminReenrollUser, adminSuspendUser, createUser } from "@/lib/services/users";
import { draftPriceList } from "@/lib/services/pricing";
import { decideApproval, requestApproval, uploadEvidence } from "@/lib/services/approvals";
import { proposeResolution } from "@/lib/services/exceptions";
import { createDataRequest, handleDataRequest, resolveReconFlag } from "@/lib/services/admin";
import { runDailyReconciliation } from "@/lib/services/reconciliation";
import { importStatement } from "@/lib/services/statements";
import { runAnchor, confirmSubmittedAnchors } from "@/lib/ledger/anchor";
import { approveEducationPack } from "@/lib/services/ai-gateway";
import { createSupplier, requestSupplierActivation, setSupplierProduct, updateSupplier, type SupplierInputT } from "@/lib/services/suppliers";
import { createOrganisation, requestOrganisationActivation, updateOrganisation, type OrganisationInputT } from "@/lib/services/organisations";
import { requestAreaSales, updateAreaRains, updateHubRoad } from "@/lib/services/areas";
import { DIRECT_KINDS } from "@/lib/domain/sales";
import { ROAD_TYPES, type OrderKind, type RoadType } from "@/lib/domain/types";
import { idempotent, DomainError } from "@/lib/services/core";

async function admin(): Promise<Actor> {
  const a = await adminActorFromCookies();
  if (!a || a.role !== "SUPER_ADMIN" || !a.mfa) redirect("/admin/login");
  return a;
}

async function once<T extends object | null>(actor: Actor, fd: FormData, action: string, fn: () => Promise<T>): Promise<T> {
  const key = str(fd, "idem");
  if (!key) throw new DomainError("missing_idempotency_key");
  return (await idempotent(actor.userId, key, action, fn)).result;
}

export async function createUserAction(fd: FormData): Promise<void> {
  const actor = await admin();
  await act(
    "/admin/stakeholders/new",
    () =>
      once(actor, fd, "createUser", () =>
        createUser(actor, {
          role: str(fd, "role") as never,
          displayName: str(fd, "displayName"),
          phone: str(fd, "phone"),
          serviceAreaId: str(fd, "serviceAreaId") || undefined,
          hubId: str(fd, "hubId") || undefined,
          supplierId: str(fd, "supplierId") || undefined,
          payoutProvider: (str(fd, "payoutProvider") || undefined) as never,
          payeeAccount: str(fd, "payeeAccount") || undefined,
          preferredLocale: (str(fd, "preferredLocale") || undefined) as never,
        }),
      ),
    (r) => (r.adminEnrollLink ? `/admin/stakeholders/${r.userId}?link=${encodeURIComponent(r.adminEnrollLink)}` : `/admin/stakeholders/${r.userId}`),
    "created",
  );
}

export async function reenrollUserAction(fd: FormData): Promise<void> {
  const actor = await admin();
  const id = str(fd, "userId");
  await act(`/admin/stakeholders/${id}`, () => once(actor, fd, "reenroll", () => adminReenrollUser(actor, id)), (r) => (r.adminEnrollLink ? `/admin/stakeholders/${id}?link=${encodeURIComponent(r.adminEnrollLink)}` : `/admin/stakeholders/${id}`), "reenrolled");
}

export async function lockUserAction(fd: FormData): Promise<void> {
  const actor = await admin();
  const id = str(fd, "userId");
  await act(`/admin/stakeholders/${id}`, () => once(actor, fd, "lockUser", async () => (await adminLockUser(actor, id, str(fd, "reason") || "admin_lock"), null)), `/admin/stakeholders/${id}`);
}

export async function suspendUserAction(fd: FormData): Promise<void> {
  const actor = await admin();
  const id = str(fd, "userId");
  await act(`/admin/stakeholders/${id}`, () => once(actor, fd, "suspendUser", async () => (await adminSuspendUser(actor, id, bool(fd, "suspend")), null)), `/admin/stakeholders/${id}`);
}

export async function createPickupAction(fd: FormData): Promise<void> {
  const actor = await admin();
  // The form offers (supplier, product) pairs the supplier actually supplies (Prompt B §8.3); older forms send the two ids apart.
  const pair = str(fd, "pair");
  const [supplierId = "", productId = ""] = pair.includes("|") ? pair.split("|") : [str(fd, "supplierId"), str(fd, "productId")];
  await act(
    "/admin/orders/new",
    () =>
      once(actor, fd, "createPickup", () =>
        adminCreatePickup(actor, { supplierId, productId, hubId: str(fd, "hubId") || undefined, buyerUserId: str(fd, "buyerUserId") || str(fd, "riderId") || undefined, quantity: Number(str(fd, "quantity")), pickupDate: str(fd, "pickupDate") }),
      ),
    "/admin/orders",
    "created",
  );
}

// ---------- suppliers (Prompt B §8) ----------

function readSupplier(fd: FormData): SupplierInputT {
  const lead = str(fd, "leadTimeDays");
  return {
    businessName: str(fd, "businessName"),
    serviceAreaId: str(fd, "serviceAreaId"),
    contactName: str(fd, "contactName") || undefined,
    contactPhone: str(fd, "contactPhone") || undefined,
    leadTimeDays: lead ? Number(lead) : undefined,
    paymentTermsNote: str(fd, "paymentTermsNote") || undefined,
    notes: str(fd, "notes") || undefined,
  };
}

export async function createSupplierAction(fd: FormData): Promise<void> {
  const actor = await admin();
  await act("/admin/suppliers", () => once(actor, fd, "createSupplier", () => createSupplier(actor, readSupplier(fd))), (r) => `/admin/suppliers/${r.supplierId}`, "created");
}

export async function updateSupplierAction(fd: FormData): Promise<void> {
  const actor = await admin();
  const id = str(fd, "supplierId");
  await act(`/admin/suppliers/${id}`, () => once(actor, fd, "updateSupplier", async () => (await updateSupplier(actor, id, readSupplier(fd)), null)), `/admin/suppliers/${id}`, "updated");
}

export async function setSupplierProductAction(fd: FormData): Promise<void> {
  const actor = await admin();
  const id = str(fd, "supplierId");
  await act(
    `/admin/suppliers/${id}`,
    () => once(actor, fd, "setSupplierProduct", async () => (await setSupplierProduct(actor, id, str(fd, "productId"), bool(fd, "offered"), str(fd, "supplierSku") || undefined), null)),
    `/admin/suppliers/${id}`,
    "productSaved",
  );
}

export async function requestSupplierActivationAction(fd: FormData): Promise<void> {
  const actor = await admin();
  const id = str(fd, "supplierId");
  await act(`/admin/suppliers/${id}`, () => once(actor, fd, "requestSupplierActivation", () => requestSupplierActivation(actor, id, bool(fd, "active"))), `/admin/suppliers/${id}`, "activationRequested");
}

export async function draftPriceListAction(fd: FormData): Promise<void> {
  const actor = await admin();
  const productIds = fd.getAll("productId").map(String);
  const items = productIds.map((productId, i) => ({
    productId,
    supplierPriceTzs: Number(fd.getAll("supplierPriceTzs")[i]),
    hubPriceTzs: Number(fd.getAll("hubPriceTzs")[i]),
    championPriceTzs: Number(fd.getAll("championPriceTzs")[i]),
    customerPriceTzs: Number(fd.getAll("customerPriceTzs")[i]),
    organisationPriceTzs: String(fd.getAll("organisationPriceTzs")[i] ?? "").trim() === "" ? undefined : Number(fd.getAll("organisationPriceTzs")[i]),
  }));
  await act(
    "/admin/prices/new",
    () => once(actor, fd, "draftPriceList", () => draftPriceList(actor, { serviceAreaId: str(fd, "serviceAreaId"), supplierId: str(fd, "supplierId"), effectiveFrom: str(fd, "effectiveFrom"), items })),
    "/admin/prices",
    "submitted",
  );
}

export async function decideApprovalAction(fd: FormData): Promise<void> {
  const actor = await admin();
  await act("/admin/approvals", () => once(actor, fd, "decideApproval", () => decideApproval(actor, str(fd, "requestId"), str(fd, "decision") as "APPROVE" | "REJECT", str(fd, "comment") || undefined)), "/admin/approvals", "decided");
}

export async function proposeResolutionAction(fd: FormData): Promise<void> {
  const actor = await admin();
  const id = str(fd, "exceptionId");
  await act(`/admin/exceptions`, () => once(actor, fd, "proposeResolution", () => proposeResolution(actor, id, str(fd, "outcome") as never, str(fd, "note"))), "/admin/exceptions", "proposed");
}

export async function donorFundingAction(fd: FormData): Promise<void> {
  const actor = await admin();
  const back = `/admin/orders/${str(fd, "orderId")}/donor`;
  await act(
    back,
    () =>
      once(actor, fd, "donorFunding", async () => {
        const file = fd.get("evidence");
        if (!(file instanceof File) || file.size === 0) throw new DomainError("donor_evidence_required");
        const ev = await uploadEvidence(actor, { filename: file.name, contentType: file.type as never, data: Buffer.from(await file.arrayBuffer()) });
        return requestApproval(actor, "DONOR_FUNDING", { orderId: str(fd, "orderId"), donorRef: str(fd, "donorRef"), amountTzs: Number(str(fd, "amountTzs")), evidenceId: ev.evidenceId }, `Donor funding ${str(fd, "donorRef")}`);
      }),
    "/admin/approvals",
    "submitted",
  );
}

export async function settingChangeAction(fd: FormData): Promise<void> {
  const actor = await admin();
  const raw = str(fd, "value");
  const value = raw === "true" ? true : raw === "false" ? false : /^-?\d+$/.test(raw) ? Number(raw) : raw;
  await act("/admin/settings", () => once(actor, fd, "settingChange", () => requestApproval(actor, "SETTING_CHANGE", { key: str(fd, "key"), value }, `Set ${str(fd, "key")} = ${raw}`)), "/admin/approvals", "submitted");
}

export async function productAvailabilityAction(fd: FormData): Promise<void> {
  const actor = await admin();
  await act(
    "/admin/settings",
    () =>
      once(actor, fd, "productAvailability", () =>
        requestApproval(
          actor,
          "PRODUCT_AVAILABILITY",
          { productId: str(fd, "productId"), serviceAreaId: str(fd, "serviceAreaId"), available: bool(fd, "available"), washConditionsConfirmed: bool(fd, "washConditionsConfirmed") },
          `Product availability change`,
        ),
      ),
    "/admin/approvals",
    "submitted",
  );
}

export async function largeExportRequestAction(fd: FormData): Promise<void> {
  const actor = await admin();
  await act("/admin/exports", () => once(actor, fd, "largeExport", () => requestApproval(actor, "LARGE_EXPORT", { dataset: str(fd, "dataset"), rows: Number(str(fd, "rows")) }, `Large export: ${str(fd, "dataset")}`)), "/admin/approvals", "submitted");
}

export async function runReconciliationAction(): Promise<void> {
  await admin();
  await act("/admin/reconciliation", () => runDailyReconciliation(), "/admin/reconciliation", "ran");
}

export async function resolveFlagAction(fd: FormData): Promise<void> {
  const actor = await admin();
  await act("/admin/reconciliation", () => resolveReconFlag(actor, str(fd, "flagId")), "/admin/reconciliation");
}

export async function importStatementAction(fd: FormData): Promise<void> {
  const actor = await admin();
  await act(
    "/admin/statements",
    async () => {
      const file = fd.get("file");
      if (!(file instanceof File) || file.size === 0) throw new DomainError("statement_empty");
      return importStatement(actor, str(fd, "provider") || "mock", file.name, await file.text());
    },
    (r) => `/admin/statements/${r.importId}`,
  );
}

export async function anchorNowAction(): Promise<void> {
  await admin();
  await act(
    "/admin/ledger",
    async () => {
      await confirmSubmittedAnchors();
      return runAnchor();
    },
    "/admin/ledger",
    "anchored",
  );
}

export async function dataRequestCreateAction(fd: FormData): Promise<void> {
  const actor = await admin();
  await act(
    "/admin/data-requests",
    () => createDataRequest(actor, { kind: str(fd, "kind") as never, subjectType: str(fd, "subjectType") as never, subjectId: str(fd, "subjectId"), details: str(fd, "details") }),
    "/admin/data-requests",
    "created",
  );
}

export async function dataRequestHandleAction(fd: FormData): Promise<void> {
  const actor = await admin();
  await act("/admin/data-requests", () => handleDataRequest(actor, str(fd, "requestId"), str(fd, "outcome") as never, str(fd, "note")), "/admin/data-requests");
}

/** Approves the current content/education pack for the assistant (the educationPackApproved setting still needs its dual-approved change). */
export async function approveEducationPackAction(fd: FormData): Promise<void> {
  const actor = await admin();
  await act("/admin/settings", () => once(actor, fd, "approveEducationPack", async () => (await approveEducationPack(actor), null)), "/admin/settings", "packApproved");
}

// ---------- organisations and sale paths (prompt §8.8) ----------

function readOrganisation(fd: FormData): OrganisationInputT {
  return { name: str(fd, "name"), kind: str(fd, "kind") as OrganisationInputT["kind"], serviceAreaId: str(fd, "serviceAreaId"), contactName: str(fd, "contactName") || undefined, contactPhone: str(fd, "contactPhone"), womenOwned: bool(fd, "womenOwned"), notes: str(fd, "notes") || undefined };
}

export async function createOrganisationAction(fd: FormData): Promise<void> {
  const actor = await admin();
  await act("/admin/organisations", () => once(actor, fd, "createOrganisation", () => createOrganisation(actor, readOrganisation(fd))), (r) => `/admin/organisations/${r.organisationId}`, "created");
}

export async function updateOrganisationAction(fd: FormData): Promise<void> {
  const actor = await admin();
  const id = str(fd, "organisationId");
  await act(`/admin/organisations/${id}`, () => once(actor, fd, "updateOrganisation", async () => (await updateOrganisation(actor, id, readOrganisation(fd)), null)), `/admin/organisations/${id}`, "updated");
}

export async function requestOrganisationActivationAction(fd: FormData): Promise<void> {
  const actor = await admin();
  const id = str(fd, "organisationId");
  await act(`/admin/organisations/${id}`, () => once(actor, fd, "requestOrganisationActivation", () => requestOrganisationActivation(actor, id, bool(fd, "active"))), `/admin/organisations/${id}`, "activationRequested");
}

export async function requestAreaSalesAction(fd: FormData): Promise<void> {
  const actor = await admin();
  const areaId = str(fd, "serviceAreaId");
  const kinds = DIRECT_KINDS.filter((k) => bool(fd, `path_${k}`)) as OrderKind[];
  await act("/admin/areas", () => once(actor, fd, "requestAreaSales", () => requestAreaSales(actor, areaId, kinds)), "/admin/areas", "requested");
}

/** The road to one hub (Prompt I §2.1): blank distance or road means "not recorded yet". */
export async function updateHubRoadAction(fd: FormData): Promise<void> {
  const actor = await admin();
  const hubId = str(fd, "hubId");
  const km = str(fd, "distanceKm");
  const road = str(fd, "road");
  const input = {
    distanceKm: km === "" ? null : Number(km),
    road: (ROAD_TYPES as readonly string[]).includes(road) ? (road as RoadType) : null,
    slowInRains: bool(fd, "slowInRains"),
  };
  await act("/admin/areas", () => once(actor, fd, "updateHubRoad", () => updateHubRoad(actor, hubId, input).then(() => ({}))), "/admin/areas", "roadSaved");
}

/** The rainy months of one area, from twelve checkboxes. */
export async function updateAreaRainsAction(fd: FormData): Promise<void> {
  const actor = await admin();
  const areaId = str(fd, "serviceAreaId");
  const months = Array.from({ length: 12 }, (_, i) => i + 1).filter((m) => bool(fd, `month_${m}`));
  await act("/admin/areas", () => once(actor, fd, "updateAreaRains", () => updateAreaRains(actor, areaId, months).then(() => ({}))), "/admin/areas", "rainsSaved");
}

