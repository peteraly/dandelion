/**
 * Prompt B §8.6 on a real database: a supplier organisation is activated by
 * two admins, supplies only what it offers, and every user of the
 * organisation sees the organisation's pickups — nobody else's.
 */
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { getDb } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import { SEED } from "@/scripts/seed";
import { actors, ids, ledgerCount, userByPhone } from "./helpers";
import { createSupplier, listSuppliers, pickupPairs, requestSupplierActivation, setSupplierProduct, supplierDetail, supplierHome, updateSupplier } from "@/lib/services/suppliers";
import { decideApproval } from "@/lib/services/approvals";
import { adminCreatePickup, recentOrdersFor } from "@/lib/services/orders";
import { createUser } from "@/lib/services/users";
import { simulate } from "@/lib/payments/simulator";
import { acceptPickup, confirmBatchReady } from "@/lib/services/orders";
import { tzDay } from "@/lib/util/time";
import { can, type Actor } from "@/lib/policy";
import { tzWeekStart } from "@/lib/util/time";

let newSupplierId: string;

describe("supplier organisation", () => {
  beforeAll(async () => {
    const { area } = await ids();
    const admin = await actors.adminA();
    newSupplierId = (await createSupplier(admin, { businessName: "Second Supplier Co. (TEST)", serviceAreaId: area.id, contactName: "Contact (TEST)", contactPhone: "+255700009900", leadTimeDays: 4, paymentTermsNote: "test" })).supplierId;
  });

  it("starts inactive and cannot receive a pickup until two admins activate it", async () => {
    const { hub, kit } = await ids();
    const admin = await actors.adminA();
    const rider = await userByPhone(SEED.riders[0]!.phone);
    await setSupplierProduct(admin, newSupplierId, kit.id, true, "KIT-2");
    await expect(adminCreatePickup(admin, { supplierId: newSupplierId, productId: kit.id, hubId: hub.id, riderId: rider.id, quantity: 5, pickupDate: tzDay() })).rejects.toMatchObject({ code: "supplier_not_active" });

    const before = await ledgerCount("STAKEHOLDER_ACTIVATED");
    const { requestId } = await requestSupplierActivation(admin, newSupplierId, true);
    // The requester cannot approve their own request; a duplicate request is refused while one is pending.
    await expect(decideApproval(admin, requestId, "APPROVE")).rejects.toMatchObject({ code: "self_approval" });
    await expect(requestSupplierActivation(admin, newSupplierId, true)).rejects.toMatchObject({ code: "supplier_activation_pending" });
    expect((await listSuppliers(admin)).find((r) => r.id === newSupplierId)?.pendingActivation).toBe(true);

    const r = await decideApproval(await actors.adminB(), requestId, "APPROVE", "verified");
    expect(r.status).toBe("EXECUTED");
    const sup = await getDb().query.suppliers.findFirst({ where: eq(s.suppliers.id, newSupplierId) });
    expect(sup?.active).toBe(true);
    expect(await ledgerCount("STAKEHOLDER_ACTIVATED")).toBe(before + 1);
    await expect(requestSupplierActivation(admin, newSupplierId, true)).rejects.toMatchObject({ code: "supplier_already_in_state" });
  });

  it("refuses a pickup for a product the supplier does not supply, and offers only offered pairs", async () => {
    const { supplier, hub, kit, disposable } = await ids();
    const admin = await actors.adminA();
    const rider = await userByPhone(SEED.riders[0]!.phone);
    // The seeded supplier supplies both products; withdraw the disposable pack.
    await setSupplierProduct(admin, supplier.id, disposable.id, false);
    await expect(adminCreatePickup(admin, { supplierId: supplier.id, productId: disposable.id, hubId: hub.id, riderId: rider.id, quantity: 5, pickupDate: tzDay() })).rejects.toMatchObject({ code: "supplier_product_not_offered" });
    const pairs = await pickupPairs(admin);
    expect(pairs.some((p) => p.supplierId === supplier.id && p.productId === kit.id)).toBe(true);
    expect(pairs.some((p) => p.supplierId === supplier.id && p.productId === disposable.id)).toBe(false);
    await setSupplierProduct(admin, supplier.id, disposable.id, true, "DISP-10");
    expect((await pickupPairs(admin)).some((p) => p.supplierId === supplier.id && p.productId === disposable.id)).toBe(true);
  });

  it("every user of the organisation sees its pickups; another organisation's user does not", async () => {
    const { supplier, hub, kit } = await ids();
    const admin = await actors.adminA();
    const rider = await userByPhone(SEED.riders[0]!.phone);
    const { orderId } = await adminCreatePickup(admin, { supplierId: supplier.id, productId: kit.id, hubId: hub.id, riderId: rider.id, quantity: 10, pickupDate: tzDay() });
    // A colleague at the seeded supplier, not the user named on the order.
    const { userId } = await createUser(admin, { role: "SUPPLIER", displayName: "Colleague (TEST)", phone: "+255700009901", supplierId: supplier.id, serviceAreaId: hub.serviceAreaId, payoutProvider: "MPESA", payeeAccount: "TILL-SUP-002" });
    const colleague: Actor = { userId, role: "SUPPLIER", hubId: null, supplierId: supplier.id, mfa: false };
    const stranger: Actor = { userId: "00000000-0000-0000-0000-000000000000", role: "SUPPLIER", hubId: null, supplierId: newSupplierId, mfa: false };
    expect((await recentOrdersFor(colleague)).some((o) => o.id === orderId)).toBe(true);
    expect((await recentOrdersFor(stranger)).some((o) => o.id === orderId)).toBe(false);
    const order = (await getDb().query.orders.findFirst({ where: eq(s.orders.id, orderId) }))!;
    const resource = { type: "order" as const, order: { kind: order.kind, sellerUserId: order.sellerUserId, buyerUserId: order.buyerUserId, supplierId: order.supplierId, hubId: order.hubId } };
    expect(can(colleague, "order.confirm_batch_ready", resource)).toBe(true);
    expect(can(stranger, "order.confirm_batch_ready", resource)).toBe(false);
    // The colleague can do the work: confirm the batch, and the home view lists the pickup.
    await confirmBatchReady(colleague, orderId, "SEAL-COLL");
    const home = await supplierHome(colleague);
    expect(home.pickups.some((p) => p.id === orderId && p.state === "BATCH_READY")).toBe(true);
    expect(home.businessName).toBe(SEED.supplier.name);
    await expect(supplierHome(stranger)).resolves.toMatchObject({ pickups: [] });
  });

  it("shows only provider-confirmed money on the supplier pages", async () => {
    const { supplier, hub, kit } = await ids();
    const admin = await actors.adminA();
    const supplierActor = await actors.supplier();
    const rider = await userByPhone(SEED.riders[0]!.phone);
    const riderActor = await actors.rider();
    const { orderId } = await adminCreatePickup(admin, { supplierId: supplier.id, productId: kit.id, hubId: hub.id, riderId: rider.id, quantity: 4, pickupDate: tzDay() });
    await confirmBatchReady(supplierActor, orderId, "SEAL-PAY");
    await acceptPickup(riderActor, orderId);
    const before = (await supplierDetail(admin, supplier.id))!.payments.confirmedWeekTzs;
    const o = (await getDb().query.orders.findFirst({ where: eq(s.orders.id, orderId) }))!;
    // Money the provider still holds as pending confirms nothing; only the confirmed callback does.
    const pending = await simulate("delayed", o.ref);
    expect(pending.outcomes).not.toContain("CONFIRMED");
    expect((await supplierDetail(admin, supplier.id))!.payments.confirmedWeekTzs).toBe(before);
    const ok = await simulate("success", o.ref);
    expect(ok.outcomes).toContain("CONFIRMED");
    const detail = (await supplierDetail(admin, supplier.id))!;
    expect(detail.payments.confirmedWeekTzs).toBe(before + o.totalTzs);
    expect(detail.payments.rows.some((r) => r.orderRef === o.ref && r.amountTzs === o.totalTzs && r.statementMatched === false)).toBe(true);
    expect((await supplierHome(supplierActor)).confirmedWeekTzs).toBe(before + o.totalTzs);
    expect(tzWeekStart().getTime()).toBeLessThanOrEqual(Date.now());
  });

  it("edits reference data and reports the directory row", async () => {
    const admin = await actors.adminA();
    const { area } = await ids();
    await updateSupplier(admin, newSupplierId, { businessName: "Second Supplier Co. (TEST)", serviceAreaId: area.id, leadTimeDays: 3, notes: "edited" });
    const d = (await supplierDetail(admin, newSupplierId))!;
    expect(d.supplier.leadTimeDays).toBe(3);
    expect(d.supplier.notes).toBe("edited");
    expect(d.supplier.contactPhoneMasked).toMatch(/•/);
    expect(d.products.find((p) => p.name.includes("kit"))?.offered).toBe(true);
    expect(d.history.some((h) => h.status === "EXECUTED" && h.active)).toBe(true);
    const row = (await listSuppliers(admin)).find((r) => r.id === newSupplierId)!;
    expect(row.active).toBe(true);
    expect(row.products.length).toBe(1);
    expect(row.openPickups).toBe(0);
    // Reference data is admin-only.
    await expect(updateSupplier(await actors.supplier(), newSupplierId, { businessName: "x y", serviceAreaId: area.id })).rejects.toThrow(/forbidden/);
  });
});
