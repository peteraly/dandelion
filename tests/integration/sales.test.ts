/**
 * Prompt §8.8 on a real database: paths beyond the ladder are refused until
 * two admins switch them on for the area; delivery partners and supplier staff
 * never sell to a customer (safeguarding, Prompt J §3.5); an organisation buys
 * in bulk and takes custody, a rider keeps stock and sells it to an
 * organisation, and nobody sees an order they are not party to.
 */
import { eq, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { getDb } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import { SEED } from "@/scripts/seed";
import { actors, customerFor, ids, lastSms, order, userByPhone } from "./helpers";
import { acceptPickup, adminCreatePickup, cancelOrgSale, confirmBatchReady, confirmReceipt, confirmRelease, createOrgSale, deliverOrgSale, startPlan } from "@/lib/services/orders";
import { createCustomer, verifyCustomerPhone } from "@/lib/services/customers";
import { createOrganisation, requestOrganisationActivation, organisationDetail, updateOrganisation } from "@/lib/services/organisations";
import { allowedSalesFor, directSalesFor, requestAreaSales } from "@/lib/services/areas";
import { decideApproval } from "@/lib/services/approvals";
import { draftPriceList } from "@/lib/services/pricing";
import { simulate } from "@/lib/payments/simulator";
import { recentOrdersFor } from "@/lib/services/orders";
import { tzDay } from "@/lib/util/time";
import { PolicyError, type Actor } from "@/lib/policy";

const CHECKS = { quantityOk: true, sealOk: true };

async function enrol(seller: Actor, name: string, phone: string): Promise<string> {
  const { customerId, challengeId } = await createCustomer(seller, { displayName: name, phone, consentMessages: true, consentReminders: true }, "test-device", "127.0.0.1");
  const otp = (await lastSms("OTP"))!.body.match(/\b(\d{6})\b/)![1]!;
  await verifyCustomerPhone(seller, customerId, challengeId, otp);
  return customerId;
}

let orgId: string;

describe("sale paths beyond the ladder", () => {
  beforeAll(async () => {
    const { area } = await ids();
    const admin = await actors.adminA();
    orgId = (await createOrganisation(admin, { name: "Tumaini School (TEST)", kind: "SCHOOL", serviceAreaId: area.id, contactName: "Head teacher (TEST)", contactPhone: "+255700009950" })).organisationId;
  });

  it("is ladder-only until two admins switch a path on; the closed customer paths never switch on", async () => {
    const { area } = await ids();
    const supplier = await actors.supplier();
    expect(await allowedSalesFor(getDb(), area.id)).toEqual(["SUPPLIER_TO_RIDER", "RIDER_TO_HUB", "HUB_TO_CHAMPION", "CHAMPION_TO_CUSTOMER"]);
    expect(await directSalesFor(getDb(), supplier, area.id)).toEqual({ toCustomers: false, toOrganisations: false });

    const admin = await actors.adminA();
    // Asking for the closed paths too: they are dropped, the rest go to the second admin.
    const { requestId } = await requestAreaSales(admin, area.id, ["SUPPLIER_TO_CUSTOMER", "SUPPLIER_TO_ORG", "HUB_TO_ORG", "RIDER_TO_CUSTOMER", "RIDER_TO_ORG", "SUPPLIER_TO_CHAMPION"]);
    await expect(decideApproval(admin, requestId, "APPROVE")).rejects.toMatchObject({ code: "self_approval" });
    await expect(requestAreaSales(admin, area.id, [])).rejects.toMatchObject({ code: "area_sales_pending" });
    expect((await decideApproval(await actors.adminB(), requestId, "APPROVE")).status).toBe("EXECUTED");
    const allowed = await allowedSalesFor(getDb(), area.id);
    expect(allowed).toContain("SUPPLIER_TO_ORG");
    expect(allowed).toContain("RIDER_TO_ORG");
    expect(allowed).not.toContain("SUPPLIER_TO_CUSTOMER");
    expect(allowed).not.toContain("RIDER_TO_CUSTOMER");
    expect(allowed).not.toContain("SUPPLIER_TO_HUB");
    expect(await directSalesFor(getDb(), supplier, area.id)).toEqual({ toCustomers: false, toOrganisations: true });
  });

  it("safeguarding: a supplier or a delivery partner can never enrol or sell to a customer, even if an area's record says so", async () => {
    const { area, kit } = await ids();
    const supplier = await actors.supplier();
    const rider = await actors.rider();
    await expect(enrol(supplier, "Factory-gate customer (TEST)", "+255700009951")).rejects.toThrow(PolicyError);
    await expect(enrol(rider, "Village customer (TEST)", "+255700009952")).rejects.toThrow(PolicyError);
    // A local seller's customer is hers alone: nobody else can start a plan for her.
    const customer = await customerFor(SEED.champions[0]!.phone);
    await expect(startPlan(supplier, customer.id, kit.id)).rejects.toThrow(PolicyError);
    await expect(startPlan(rider, customer.id, kit.id)).rejects.toThrow(PolicyError);
    // Even an area record from before the rule, with the closed paths in it, does not reopen them.
    await getDb().update(s.serviceAreas).set({ allowedSales: ["SUPPLIER_TO_CUSTOMER", "RIDER_TO_CUSTOMER", "SUPPLIER_TO_ORG", "HUB_TO_ORG", "RIDER_TO_ORG", "SUPPLIER_TO_CHAMPION"] }).where(eq(s.serviceAreas.id, area.id));
    const allowed = await allowedSalesFor(getDb(), area.id);
    expect(allowed).not.toContain("SUPPLIER_TO_CUSTOMER");
    expect(allowed).not.toContain("RIDER_TO_CUSTOMER");
    expect(await directSalesFor(getDb(), rider, area.id)).toEqual({ toCustomers: false, toOrganisations: true });
  });

  it("organisation: activated by two admins, pays one exact amount at the organisation price, then the seller delivers and the lot ends", async () => {
    const { area, kit, supplier: supplierRow } = await ids();
    const admin = await actors.adminA();
    const supplier = await actors.supplier();
    // No organisation price yet: refused. Draft a list with one, activate it by dual approval.
    await expect(createOrgSale(supplier, { organisationId: orgId, productId: kit.id, quantity: 5 })).rejects.toMatchObject({ code: "organisation_not_active" });
    const act = await requestOrganisationActivation(admin, orgId, true);
    await expect(decideApproval(admin, act.requestId, "APPROVE")).rejects.toMatchObject({ code: "self_approval" });
    expect((await decideApproval(await actors.adminB(), act.requestId, "APPROVE")).status).toBe("EXECUTED");
    await expect(createOrgSale(supplier, { organisationId: orgId, productId: kit.id, quantity: 5 })).rejects.toMatchObject({ code: "no_organisation_price" });
    const draft = await draftPriceList(admin, {
      serviceAreaId: area.id,
      supplierId: supplierRow.id,
      effectiveFrom: tzDay(),
      items: [
        { productId: kit.id, supplierPriceTzs: SEED.prices.supplier, hubPriceTzs: SEED.prices.hub, championPriceTzs: SEED.prices.champion, customerPriceTzs: SEED.prices.customer, organisationPriceTzs: 9500 },
        { productId: (await ids()).disposable.id, supplierPriceTzs: 3000, hubPriceTzs: 3300, championPriceTzs: 3800, customerPriceTzs: 4500, organisationPriceTzs: 4000 },
      ],
    });
    expect((await decideApproval(await actors.adminB(), draft.approvalRequestId, "APPROVE")).status).toBe("EXECUTED");

    const { orderId } = await createOrgSale(supplier, { organisationId: orgId, productId: kit.id, quantity: 5 });
    const o = await order(orderId);
    expect(o.kind).toBe("SUPPLIER_TO_ORG");
    expect(o.state).toBe("AWAITING_PAYMENT");
    expect(o.totalTzs).toBe(9500 * 5);
    expect(o.organisationId).toBe(orgId);
    expect((await lastSms("ORG_SALE"))?.body).toContain(o.paymentRef);
    // Exact payment: a partial one goes to review, the full one confirms.
    const partial = await simulate("wrong_amount", o.ref);
    expect(partial.outcomes).toContain("WRONG_AMOUNT");
    expect((await order(orderId)).state).toBe("AWAITING_PAYMENT");
    await expect(deliverOrgSale(supplier, orderId)).rejects.toMatchObject({ code: "full_payment_not_confirmed" });
    const full = await simulate("success", o.ref);
    expect(full.outcomes).toContain("CONFIRMED");
    expect((await order(orderId)).state).toBe("PAID");
    const { receiptNo } = await deliverOrgSale(supplier, orderId);
    expect(receiptNo).toMatch(/^RC-/);
    const done = await order(orderId);
    expect(done.state).toBe("COMPLETED");
    const lot = (await getDb().query.batches.findFirst({ where: eq(s.batches.id, done.batchId!) }))!;
    expect(lot.custodyState).toBe("DELIVERED_TO_ORG");
    expect(lot.custodianUserId).toBeNull();
    expect(lot.quantity).toBe(5);
    expect((await lastSms("RECEIPT"))?.body).toContain(receiptNo);
    const detail = (await organisationDetail(admin, orgId))!;
    expect(detail.summary.confirmedTzs).toBe(9500 * 5);
    expect(detail.orders[0]?.state).toBe("COMPLETED");
    // Cancel only while nothing is paid.
    const second = await createOrgSale(supplier, { organisationId: orgId, productId: kit.id, quantity: 2 });
    await cancelOrgSale(supplier, second.orderId);
    expect((await order(second.orderId)).state).toBe("CANCELLED");
  });

  it("rider stock: a rider keeps a pickup as own stock and sells it to an organisation, never to a customer", async () => {
    const { supplier: supplierRow, disposable } = await ids();
    const admin = await actors.adminA();
    const supplier = await actors.supplier();
    const riderUser = await userByPhone(SEED.riders[1]!.phone);
    const rider = await actors.rider2();
    // A pickup with no hub behind it: the rider's own stock (needs the rider-to-organisation path — switched on above).
    const { orderId: pickupId } = await adminCreatePickup(admin, { supplierId: supplierRow.id, productId: disposable.id, buyerUserId: riderUser.id, quantity: 6, pickupDate: tzDay() });
    expect((await order(pickupId)).hubId).toBeNull();
    await confirmBatchReady(supplier, pickupId, "SEAL-RS");
    await acceptPickup(rider, pickupId);
    expect((await simulate("success", (await order(pickupId)).ref)).outcomes).toContain("CONFIRMED");
    await confirmRelease(supplier, pickupId);
    await confirmReceipt(rider, pickupId, CHECKS);
    const pickup = await order(pickupId);
    expect(pickup.state).toBe("COMPLETED");
    const lot = (await getDb().query.batches.findFirst({ where: eq(s.batches.id, pickup.batchId!) }))!;
    expect(lot.custodyState).toBe("WITH_RIDER");
    expect(lot.custodianUserId).toBe(riderUser.id);
    // No delivery order was created for a hub.
    const deliveries = await getDb().execute<{ n: string }>(sql`select count(*)::text as n from orders where parent_order_id = ${pickupId}`);
    expect(deliveries.rows[0]!.n).toBe("0");

    // Never to a customer (safeguarding); to an organisation, paid in full first.
    await expect(enrol(rider, "Village customer (TEST)", "+255700009953")).rejects.toThrow(PolicyError);
    const { orderId } = await createOrgSale(rider, { organisationId: orgId, productId: disposable.id, quantity: 2 });
    const o = await order(orderId);
    expect(o.kind).toBe("RIDER_TO_ORG");
    expect(o.totalTzs).toBe(4000 * 2);
    expect((await simulate("success", o.ref)).outcomes).toContain("CONFIRMED");
    await deliverOrgSale(rider, orderId);
    expect((await order(orderId)).state).toBe("COMPLETED");
    expect((await getDb().query.batches.findFirst({ where: eq(s.batches.id, lot.id) }))!.quantity).toBe(4);
    // The rider's list shows both the pickup and the sale; another rider sees neither.
    const mine = await recentOrdersFor(rider);
    expect(mine.some((x) => x.id === orderId)).toBe(true);
    const other = await recentOrdersFor(await actors.rider());
    expect(other.some((x) => x.id === orderId || x.id === pickupId)).toBe(false);
  });

  it("business buyers: a women-owned pharmacy is named as such to the second admin, and the status is locked while active", async () => {
    const { area } = await ids();
    const admin = await actors.adminA();
    const input = { name: "Mama Neema Pharmacy (TEST)", kind: "PHARMACY" as const, serviceAreaId: area.id, contactName: "Owner (TEST)", contactPhone: "+255700009960", womenOwned: true };
    const { organisationId } = await createOrganisation(admin, input);
    const { requestId } = await requestOrganisationActivation(admin, organisationId, true);
    const request = (await getDb().query.approvalRequests.findFirst({ where: eq(s.approvalRequests.id, requestId) }))!;
    expect(request.summary).toContain("pharmacy, women-owned");
    expect((await decideApproval(await actors.adminB(), requestId, "APPROVE")).status).toBe("EXECUTED");
    const detail = (await organisationDetail(admin, organisationId))!;
    expect(detail.summary).toMatchObject({ kind: "PHARMACY", womenOwned: true, active: true });
    // While active, the confirmed status cannot change on one admin's word; other details can.
    await expect(updateOrganisation(admin, organisationId, { ...input, womenOwned: false })).rejects.toMatchObject({ code: "organisation_status_confirmed" });
    await updateOrganisation(admin, organisationId, { ...input, contactName: "Owner, new contact (TEST)" });
    expect((await organisationDetail(admin, organisationId))!.summary).toMatchObject({ contactName: "Owner, new contact (TEST)", womenOwned: true });
  });

  it("a supplier user never sees an organisation order it did not sell", async () => {
    const hub = await actors.hub();
    const supplier = await actors.supplier();
    const { kit } = await ids();
    // The hub sells to the same organisation from its own stock (stock exists from the ladder tests? the seed hub holds none) — refused honestly.
    await expect(createOrgSale(hub, { organisationId: orgId, productId: kit.id, quantity: 1 })).rejects.toMatchObject({ code: "insufficient_stock" });
    const supplierOrders = await recentOrdersFor(supplier);
    expect(supplierOrders.every((o) => o.supplierId === supplier.supplierId)).toBe(true);
    const otherSupplier: Actor = { userId: "00000000-0000-0000-0000-000000000000", role: "SUPPLIER", hubId: null, supplierId: "00000000-0000-0000-0000-000000000001", mfa: false };
    expect((await recentOrdersFor(otherSupplier)).length).toBe(0);
  });
});
