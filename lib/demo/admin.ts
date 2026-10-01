/**
 * World construction and the admin/people/exception scenarios (Prompt B §2.3).
 * Reference data is inserted directly (like the minimal seed); everything that
 * changes state goes through the services as the right actor.
 */
import { randomUUID } from "node:crypto";
import { and, eq, gte, lt, ne, sql } from "drizzle-orm";
import * as s from "@/lib/db/schema";
import { now } from "@/lib/clock";
import { tzDay } from "@/lib/util/time";
import { decideApproval, requestApproval, uploadEvidence } from "@/lib/services/approvals";
import { draftPriceList } from "@/lib/services/pricing";
import { adminLockUser, adminReenrollUser, adminSuspendUser, completeFieldEnrollment, createUser, lockWithPhoneAndPin, loginWithPin, startFieldEnrollment } from "@/lib/services/users";
import { proposeResolution, reportProblem } from "@/lib/services/exceptions";
import { createDataRequest, handleDataRequest, openDataRequests } from "@/lib/services/admin";
import { createSupplier, requestSupplierActivation, setSupplierProduct } from "@/lib/services/suppliers";
import { createOrganisation, requestOrganisationActivation } from "@/lib/services/organisations";
import { addDemoPlaces } from "./shop";
import { requestAreaSales, updateAreaRains, updateHubRoad } from "@/lib/services/areas";
import { DIRECT_KINDS } from "@/lib/domain/sales";
import { adminCreatePickup, expectCustomerPayment } from "@/lib/services/orders";
import { syncOfflineNotes } from "@/lib/services/notes";
import { importStatement } from "@/lib/services/statements";
import { isLocked } from "@/lib/domain/custody";
import { SEED } from "@/lib/seed-identities";
import { resyncPlan, reversedPayment, reviewPayment, strayProviderTransaction, type Plan } from "./supply";
import type { Area, Hub, Person, SupplierOrg, World } from "./world";

// ---------- world ----------

export async function buildWorld(w: World): Promise<void> {
  const db = w.db;
  const base = w.base;
  // Products: the two from the minimal seed plus a larger disposable pack.
  const [large] = await db.insert(s.products).values({ name: "Disposable pack (large)", category: "DISPOSABLE", unitDescription: "1 large pack of disposable pads" }).returning();
  await db.insert(s.productAreaAvailability).values({ productId: large!.id, serviceAreaId: base.areaId, available: true, washConditionsConfirmed: false });
  await db.insert(s.supplierProducts).values({ supplierId: base.supplierId, productId: large!.id, supplierSku: "DISP-LG" });
  for (const p of await db.query.products.findMany()) w.products.push({ id: p.id, name: p.name, category: p.category });

  // Area 1: the minimal seed's people, looked up.
  const supplierUser = await db.query.users.findFirst({ where: and(eq(s.users.role, "SUPPLIER"), eq(s.users.supplierId, base.supplierId)) });
  const primary1 = await w.personFromUser(supplierUser!.id, SEED.supplier.phone, SEED.supplier.payee);
  const area1: Area = {
    id: base.areaId,
    name: "Test Village (TEST)",
    supplierId: base.supplierId,
    supplier: primary1,
    suppliers: [{ id: base.supplierId, name: SEED.supplier.name, users: [primary1], leadTimeDays: 2, quality: "good" }],
    hubs: [],
  };
  const hubAManager = await db.query.users.findFirst({ where: and(eq(s.users.role, "HUB_MANAGER"), eq(s.users.hubId, base.hubId)) });
  const hubA: Hub = { id: base.hubId, name: "Test Hub (TEST)", areaId: base.areaId, manager: await w.personFromUser(hubAManager!.id, SEED.hub.phone, SEED.hub.payee), champions: [], minStockUnits: 10 };
  const baseChampions = await db.query.users.findMany({ where: and(eq(s.users.role, "FIELD_CHAMPION"), eq(s.users.hubId, base.hubId)) });
  for (const [i, c] of baseChampions.entries()) hubA.champions.push(await w.personFromUser(c.id, SEED.champions[i]?.phone ?? "", SEED.champions[i]?.payee ?? c.payeeAccount ?? ""));
  while (hubA.champions.length < w.params.championsPerHub) hubA.champions.push(await w.createFieldPerson("FIELD_CHAMPION", { areaId: area1.id, hubId: hubA.id, payee: w.names.till("CHA", 100 + hubA.champions.length) }));
  area1.hubs.push(hubA);
  for (let h = 1; h < w.params.hubsPerArea[0]!; h++) area1.hubs.push(await createHub(w, area1, h, h === 1 ? 15 : 10));
  w.areas.push(area1);

  // Riders: the seeded two plus extras.
  const baseRiders = await db.query.users.findMany({ where: eq(s.users.role, "BOSS_RIDER") });
  for (const [i, r] of baseRiders.entries()) w.riders.push(await w.personFromUser(r.id, SEED.riders[i]?.phone ?? "", SEED.riders[i]?.payee ?? r.payeeAccount ?? ""));
  while (w.riders.length < w.params.ridersTotal) w.riders.push(await w.createFieldPerson("BOSS_RIDER", { areaId: area1.id, payee: w.names.till("RID", 100 + w.riders.length) }));

  // Area 2 (full scale only): peri-urban, no WASH confirmation, so reusables are not offered there.
  for (let a = 1; a < w.params.areas; a++) {
    const [row] = await db.insert(s.serviceAreas).values({ code: `DEMO-AREA-${a + 1}`, name: w.names.village(a + 3), region: "Demo Region (fictional)" }).returning();
    const [sup] = await db
      .insert(s.suppliers)
      .values({ businessName: w.names.company(a + 2), serviceAreaId: row!.id, active: true, contactName: "Business contact (TEST)", leadTimeDays: 2, paymentTermsNote: "Paid per pickup before release (test data)" })
      .returning();
    await db.insert(s.supplierProducts).values(w.products.map((p) => ({ supplierId: sup!.id, productId: p.id })));
    const supplier = await w.createFieldPerson("SUPPLIER", { areaId: row!.id, supplierId: sup!.id, payee: w.names.till("SUP", a + 1) });
    await db.insert(s.productAreaAvailability).values(w.products.map((p) => ({ productId: p.id, serviceAreaId: row!.id, available: p.category === "DISPOSABLE", washConditionsConfirmed: false })));
    const area: Area = { id: row!.id, name: row!.name, supplierId: sup!.id, supplier, suppliers: [{ id: sup!.id, name: sup!.businessName, users: [supplier], leadTimeDays: 2, quality: "good" }], hubs: [] };
    for (let h = 0; h < (w.params.hubsPerArea[a] ?? 1); h++) area.hubs.push(await createHub(w, area, h + 10, 12));
    w.areas.push(area);
    await activatePrices(w, area, [1.0, 1.05]);
  }

  // A price list v2 for area 1 that covers all three products (drafted by A, approved by B).
  await activatePrices(w, area1, [1.0, 1.0]);

  // Every area has a second, occasional supplier (Prompt B §8.5): longer lead time, activated by dual approval, own price list.
  for (const [i, area] of w.areas.entries()) await addOccasionalSupplier(w, area, i);

  // Prompt §8.8: the demo switches every direct path on in every area (dual approval) and adds two buyer organisations per area.
  for (const area of w.areas) {
    const { requestId } = await requestAreaSales(w.adminA, area.id, [...DIRECT_KINDS]);
    w.tick(30, 120);
    await decideApproval(w.adminB, requestId, "APPROVE", "Pilot demo: every path on");
    w.manifest.count("approvals.AREA_SALES_CHANGE");
  }
  w.directPaths = true;
  // Public meeting points for shop orders in every area (Prompt L §3).
  await addDemoPlaces(w);
  for (const [i, area] of w.areas.entries()) {
    // A school, an NGO and a women-owned pharmacy (business buyers, founders' decision of 2026-10-01) per area.
    for (const [j, kind] of (["SCHOOL", "NGO", "PHARMACY"] as const).entries()) {
      // Short enough for a map tile (≤ 18 characters before the suffix, Prompt D §5.6): the village's first word plus what it is.
      const first = (n: number) => w.names.village(n).replace(" (TEST)", "").split(" ")[0]!;
      const name = kind === "SCHOOL" ? `${first(i * 2 + j + 5)} School (TEST)` : kind === "NGO" ? `${first(i * 2 + j + 7)} Health NGO (TEST)` : `${first(i * 2 + j + 9)} Pharmacy (TEST)`;
      const { organisationId } = await createOrganisation(w.adminA, { name, kind, serviceAreaId: area.id, contactName: "Coordinator (TEST)", contactPhone: w.names.fieldPhone(), womenOwned: kind === "PHARMACY", notes: "Fictional buyer organisation in the demo dataset" });
      w.tick(20, 90);
      const { requestId } = await requestOrganisationActivation(w.adminA, organisationId, true);
      w.tick(30, 240);
      await decideApproval(w.adminB, requestId, "APPROVE", "Organisation verified (test data)");
      w.manifest.count("approvals.STAKEHOLDER_ACTIVATE");
      w.organisations.push({ id: organisationId, name, areaId: area.id, kind });
      w.manifest.count("organisations");
    }
  }

  // The minimal seed's customers, so their plans count too.
  for (const c of await db.query.customers.findMany()) {
    const champion = w.champions.find((p) => p.actor.userId === c.championId);
    const fixed = SEED.customers.find((x) => x.name === c.displayName);
    if (champion && fixed) w.customers.push({ id: c.id, name: c.displayName, phone: fixed.phone, champion });
  }
  w.manifest.count("hubs", w.hubs.length);
  await recordRoads(w);
}

/**
 * Roads and rains (Prompt I §2.1), recorded through the admin service like a founder would. Area 1 is the district:
 * its first hub is in town on tarmac, the next is far out on a dirt road the rains slow, any more are out on gravel.
 * Area 2 is peri-urban, on gravel the rains do not stop. Area 1 has two rainy seasons (March–May and
 * October–December), area 2 one long one (November–April).
 */
async function recordRoads(w: World): Promise<void> {
  const DISTRICT = [
    { road: "PAVED", distanceKm: 4, slowInRains: false },
    { road: "DIRT", distanceKm: 95, slowInRains: true },
    { road: "GRAVEL", distanceKm: 35, slowInRains: true },
  ] as const;
  const PERI_URBAN = { road: "GRAVEL", distanceKm: 18, slowInRains: false } as const;
  for (const [i, area] of w.areas.entries()) {
    await updateAreaRains(w.adminA, area.id, i === 0 ? [3, 4, 5, 10, 11, 12] : [1, 2, 3, 4, 11, 12]);
    for (const [h, hub] of area.hubs.entries()) {
      // Hubs beyond the third are further out still along gravel roads.
      const r = i === 0 ? DISTRICT[Math.min(h, DISTRICT.length - 1)]! : PERI_URBAN;
      await updateHubRoad(w.adminA, hub.id, { ...r, distanceKm: r.distanceKm + Math.max(0, h - DISTRICT.length + 1) * 12 });
      w.tick(1, 5);
    }
  }
  w.manifest.count("roads.recorded", w.hubs.length);
}

async function createHub(w: World, area: Area, index: number, minStockUnits: number): Promise<Hub> {
  const [row] = await w.db.insert(s.hubs).values({ name: `${w.names.village(index).replace(" (TEST)", "")} Hub (TEST)`, serviceAreaId: area.id, minStockUnits, active: true }).returning();
  const manager = await w.createFieldPerson("HUB_MANAGER", { areaId: area.id, hubId: row!.id, payee: w.names.till("HUB", 100 + index) });
  const hub: Hub = { id: row!.id, name: row!.name, areaId: area.id, manager, champions: [], minStockUnits };
  for (let i = 0; i < w.params.championsPerHub; i++) hub.champions.push(await w.createFieldPerson("FIELD_CHAMPION", { areaId: area.id, hubId: row!.id, payee: w.names.till("CHA", 200 + index * 10 + i) }));
  return hub;
}

/** Draft + dual-approve a price list for an area (ladder respected). `factor` per product category tweaks prices. */
/** The occasional supplier: created inactive through the admin service, activated by two admins (STAKEHOLDER_ACTIVATE), priced a little higher. */
async function addOccasionalSupplier(w: World, area: Area, index: number): Promise<SupplierOrg> {
  const name = w.names.company(index);
  const { supplierId } = await createSupplier(w.adminA, {
    businessName: name,
    serviceAreaId: area.id,
    contactName: "Business contact (TEST)",
    contactPhone: w.names.fieldPhone(),
    leadTimeDays: 4,
    paymentTermsNote: "Paid per pickup before release (test data)",
    notes: "Occasional supplier in the demo dataset; longer lead time.",
  });
  for (const p of w.products) await setSupplierProduct(w.adminA, supplierId, p.id, true, `S${index + 1}-${p.category.slice(0, 3)}`);
  const user = await w.createFieldPerson("SUPPLIER", { areaId: area.id, supplierId, payee: w.names.till("SUP", 20 + index) });
  w.tick(30, 120);
  const { requestId } = await requestSupplierActivation(w.adminA, supplierId, true);
  w.tick(30, 240);
  await decideApproval(w.adminB, requestId, "APPROVE", "Supplier verified (test data)");
  w.manifest.count("approvals.STAKEHOLDER_ACTIVATE");
  await activatePrices(w, area, [1.02, 1.05], supplierId);
  const org: SupplierOrg = { id: supplierId, name, users: [user], leadTimeDays: 4, quality: "poor" };
  area.suppliers.push(org);
  w.manifest.count("suppliers");
  return org;
}

/** Supplier set pieces on fixed days (seed only): a colleague enrolled by SMS link; a pickup the occasional supplier never confirms. */
export async function supplierSetPieces(w: World, day: number, totalDays: number): Promise<void> {
  const area = w.areas[0]!;
  const primary = area.suppliers.find((o) => o.quality === "good");
  const occasional = area.suppliers.find((o) => o.quality === "poor");
  if (day >= 4 && primary && w.once("supplier.secondUser")) {
    try {
      const name = w.names.person();
      const phone = w.names.fieldPhone();
      const { userId } = await createUser(w.adminA, { role: "SUPPLIER", displayName: name, phone, supplierId: primary.id, serviceAreaId: area.id, payoutProvider: "MPESA", payeeAccount: w.names.till("SUP", 50) });
      w.tick(30, 600);
      const token = await w.enrollTokenFromSms(phone);
      const device = `demo-device-${userId.slice(0, 8)}`;
      const { challengeId } = await startFieldEnrollment(token, phone, device, "127.0.0.1");
      w.tick(1, 3);
      const code = await w.lastSmsCode(phone, "OTP");
      await completeFieldEnrollment(token, challengeId, code, SEED.fieldPin, device);
      primary.users.push({ actor: { userId, role: "SUPPLIER", hubId: null, supplierId: primary.id, mfa: false }, name, phone, pin: SEED.fieldPin, payee: w.names.till("SUP", 50) });
      w.manifest.count("people.enrolled_via_link");
      w.manifest.count("suppliers.second_user_enrolled");
    } catch (e) {
      w.manifest.skip("enrol second supplier user via SMS link", e);
    }
  }
  if (day >= totalDays - 6 && occasional && w.once("supplier.waitingPickup")) {
    try {
      const hub = w.hubs[0]!;
      const product = w.product("DISPOSABLE");
      const { orderId } = await adminCreatePickup(w.adminA, { supplierId: occasional.id, productId: product.id, hubId: hub.id, riderId: w.riders[0]!.actor.userId, quantity: w.rng.int(30, 60), pickupDate: tzDay() });
      w.manifest.count("orders.SUPPLIER_TO_RIDER");
      w.manifest.anomaly("PICKUP_WAITING_ON_SUPPLIER", `${occasional.name} never confirmed this batch; older than its ${occasional.leadTimeDays}-day lead time by the end`, { orderRef: await w.orderRef(orderId) });
    } catch (e) {
      w.manifest.skip("pickup left waiting on the supplier", e);
    }
  }
}

async function activatePrices(w: World, area: Area, factor: [number, number], supplierId: string = area.supplierId): Promise<void> {
  const items = w.products.map((p) => {
    const f = p.category === "REUSABLE" ? factor[0] : factor[1];
    const baseRow = p.category === "REUSABLE" ? { supplier: 7500, hub: 8000, champion: 9000, customer: 11400 } : p.name.includes("large") ? { supplier: 5000, hub: 5500, champion: 6200, customer: 7500 } : { supplier: 3000, hub: 3300, champion: 3800, customer: 4500 };
    const r = (n: number) => Math.round((n * f) / 100) * 100;
    // Upstream prices may differ per supplier; champion and customer prices are one per area (handbook §7, pricing.ts).
    // Organisations pay the champion price (between hub and customer) — a demo default; the founders decide the real one (§8.8.6).
    return { productId: p.id, supplierPriceTzs: r(baseRow.supplier), hubPriceTzs: Math.min(r(baseRow.hub), baseRow.champion), championPriceTzs: baseRow.champion, customerPriceTzs: baseRow.customer, organisationPriceTzs: baseRow.champion };
  });
  const { approvalRequestId } = await draftPriceList(w.adminA, { serviceAreaId: area.id, supplierId, effectiveFrom: tzDay(), items });
  w.tick(30, 180);
  await decideApproval(w.adminB, approvalRequestId, "APPROVE", "Prices agreed with supplier");
  w.manifest.count("approvals.PRICE_LIST_ACTIVATE");
}

// ---------- admin day ----------

export async function adminDay(w: World, plans: Plan[], day: number): Promise<void> {
  const rng = w.rng;
  const run = async (name: string, fn: () => Promise<void>) => {
    try {
      await fn();
    } catch (e) {
      w.manifest.skip(name, e);
    }
  };
  switch (day) {
    case 1:
      await run("setting change", async () => {
        const { requestId } = await requestApproval(w.adminA, "SETTING_CHANGE", { key: "customerPauseDays", value: 21 }, "Set customerPauseDays = 21");
        w.tick(60, 240);
        await decideApproval(w.adminB, requestId, "APPROVE");
        w.manifest.count("approvals.SETTING_CHANGE");
      });
      break;
    case 2:
      await run("large export", async () => {
        const { requestId } = await requestApproval(w.adminA, "LARGE_EXPORT", { dataset: "orders", rows: 250 }, "Export orders for the monthly report");
        w.tick(30, 120);
        await decideApproval(w.adminB, requestId, "APPROVE");
        w.manifest.count("approvals.LARGE_EXPORT");
      });
      break;
    case 3:
      await run("product availability", async () => {
        const area = w.areas[0]!;
        const product = w.products.find((p) => p.name.includes("large"))!;
        const { requestId } = await requestApproval(w.adminA, "PRODUCT_AVAILABILITY", { productId: product.id, serviceAreaId: area.id, available: true, washConditionsConfirmed: true }, "Large pack available in area 1");
        w.tick(60, 300);
        await decideApproval(w.adminB, requestId, "APPROVE");
        w.manifest.count("approvals.PRODUCT_AVAILABILITY");
      });
      break;
    case 4:
      await run("rejected price list", async () => {
        const area = w.areas[0]!;
        const items = w.products.map((p) => ({ productId: p.id, supplierPriceTzs: 9000, hubPriceTzs: 9500, championPriceTzs: 10500, customerPriceTzs: 13000 }));
        const { approvalRequestId } = await draftPriceList(w.adminA, { serviceAreaId: area.id, supplierId: area.supplierId, effectiveFrom: tzDay(), items });
        w.tick(120, 600);
        await decideApproval(w.adminB, approvalRequestId, "REJECT", "Too steep for customers; keep v2");
        w.manifest.count("approvals.rejected");
      });
      break;
    case 5:
      await run("self-approval attempt", async () => {
        const { requestId } = await requestApproval(w.adminA, "SETTING_CHANGE", { key: "largeExportRows", value: 150 }, "Set largeExportRows = 150");
        w.tick(1, 5);
        try {
          await decideApproval(w.adminA, requestId, "APPROVE");
          throw new Error("self-approval was accepted — invariant §3.14 broken");
        } catch (e) {
          if (e instanceof Error && /invariant/.test(e.message)) throw e;
          w.manifest.count("security.self_approval_refused");
        }
        w.tick(60, 200);
        await decideApproval(w.adminB, requestId, "APPROVE");
      });
      break;
    case 9:
      await run("donor funding approved", async () => {
        // The demo's notes can lag the database (a plan paid off or handed over elsewhere): ask the order itself.
        let plan: Plan | undefined;
        for (const p of plans) {
          if (p.handedOver || p.paidTzs >= p.totalTzs || !p.installments.length) continue;
          if ((await w.order(p.orderId)).state === "PLAN_ACTIVE") {
            plan = p;
            break;
          }
        }
        if (!plan) throw new Error("no open plan for donor funding");
        const ev = await uploadEvidence(w.adminA, { filename: "donor-transfer.pdf", contentType: "application/pdf", data: Buffer.from("%PDF-1.4 demo donor transfer confirmation (TEST)") });
        const amount = Math.min(plan.installments[plan.installments.length - 1]!, plan.totalTzs - plan.paidTzs);
        const { requestId } = await requestApproval(w.adminA, "DONOR_FUNDING", { orderId: plan.orderId, donorRef: `DON-${rng.int(1000, 9999)} (TEST)`, amountTzs: amount, evidenceId: ev.evidenceId }, "Donor covers final installment");
        w.tick(120, 400);
        await decideApproval(w.adminB, requestId, "APPROVE", "Evidence checked");
        plan.installments.pop();
        plan.paidTzs += amount;
        if (plan.installments.length === 0) plan.nextPaymentDay = null;
        w.manifest.anomaly("DONOR_FUNDED", "part of this plan is donor-funded with evidence and dual approval", { orderRef: plan.ref });
        w.manifest.count("approvals.DONOR_FUNDING");
      });
      break;
    case 11:
      await run("donor funding without evidence", async () => {
        const plan = plans.find((p) => !p.handedOver && p.installments.length > 0);
        if (!plan) throw new Error("no open plan");
        try {
          await requestApproval(w.adminA, "DONOR_FUNDING", { orderId: plan.orderId, donorRef: "DON-NOEVIDENCE (TEST)", amountTzs: 2000 }, "Donor funding without evidence");
          throw new Error("donor funding without evidence was accepted — invariant §3.6 broken");
        } catch (e) {
          if (e instanceof Error && /invariant/.test(e.message)) throw e;
          w.manifest.count("security.donor_without_evidence_refused");
        }
      });
      break;
    case 13:
      await run("donor funding over cap", async () => {
        const plan = plans.find((p) => !p.handedOver && p.installments.length > 0);
        if (!plan) throw new Error("no open plan");
        const ev = await uploadEvidence(w.adminA, { filename: "donor-large.pdf", contentType: "application/pdf", data: Buffer.from("%PDF-1.4 demo (TEST)") });
        try {
          await requestApproval(w.adminA, "DONOR_FUNDING", { orderId: plan.orderId, donorRef: "DON-OVERCAP (TEST)", amountTzs: 600_000, evidenceId: ev.evidenceId }, "Donor funding over the monthly cap");
          throw new Error("donor funding over the cap was accepted — invariant §3.6 broken");
        } catch (e) {
          if (e instanceof Error && /invariant/.test(e.message)) throw e;
          w.manifest.count("security.donor_over_cap_refused");
        }
      });
      break;
    case 10:
    case 12:
      await run("data request", async () => {
        const kind = day === 10 ? "CORRECTION" : "DELETION";
        // A deletion is refused while the customer still has an open plan (the phone is tombstoned), so choose someone whose plans are all done.
        const eligible = kind === "DELETION" ? w.customers.filter((c) => plans.every((p) => p.customer.id !== c.id || p.handedOver)) : w.customers;
        if (!eligible.length) throw new Error("no customer without an open plan");
        const c = rng.pick(eligible);
        await createDataRequest(w.adminA, { kind, subjectType: "CUSTOMER", subjectId: c.id, details: kind === "CORRECTION" ? "Customer asked to correct the spelling of her name (TEST)" : "Customer asked for deletion after moving away (TEST)" });
        w.tick(120, 600);
        const open = await openDataRequests(w.adminA);
        const mine = open.find((r) => r.subjectId === c.id);
        if (mine) await handleDataRequest(w.adminA, mine.id, "DONE", kind === "CORRECTION" ? "Name corrected" : "Records anonymised per policy");
        if (kind === "DELETION") w.customers.splice(w.customers.indexOf(c), 1);
        w.manifest.count(`data_requests.${kind}`);
      });
      break;
    default:
      break;
  }
}

// ---------- field problems, notes, people ----------

export async function reportFieldProblems(w: World, plans: Plan[], day: number): Promise<void> {
  const rng = w.rng;
  const attempt = async (name: string, fn: () => Promise<void>) => {
    try {
      await fn();
    } catch (e) {
      w.manifest.skip(name, e);
    }
  };
  if (rng.chance(0.25)) {
    await attempt("WASH_CONCERN", async () => {
      const champion = rng.pick(w.champions);
      const { exceptionRef } = await reportProblem(champion.actor, { type: "WASH_CONCERN", note: w.manifest.swahili("Maji safi hayapatikani kwa wiki hii katika mtaa wa mteja") });
      w.manifest.count("exceptions.WASH_CONCERN");
      void exceptionRef;
    });
  }
  if (rng.chance(0.15)) {
    await attempt("CUSTOMER_UNWELL", async () => {
      const champion = rng.pick(w.champions);
      await reportProblem(champion.actor, { type: "CUSTOMER_UNWELL", note: "Customer said she felt unwell; referred to the health facility as trained. No details recorded." });
      w.manifest.count("exceptions.CUSTOMER_UNWELL");
    });
  }
  if (rng.chance(0.2)) {
    await attempt("OTHER", async () => {
      const p = rng.pick(w.champions);
      await reportProblem(p.actor, { type: "OTHER", note: w.manifest.swahili("Mvua kubwa; barabara imefungwa, mauzo yamesimama leo") });
      w.manifest.count("exceptions.OTHER");
    });
  }
  if (rng.chance(0.15)) {
    await attempt("WRONG_AMOUNT (reported)", async () => {
      const plan = rng.pick(plans.filter((p) => !p.handedOver));
      await reportProblem(plan.customer.champion.actor, { type: "WRONG_AMOUNT", orderId: plan.orderId, note: "Customer says she paid 5,000 but the app shows less" });
      w.manifest.count("exceptions.WRONG_AMOUNT");
      w.manifest.anomaly("WRONG_AMOUNT", "champion reported a disputed amount", { orderRef: plan.ref });
    });
  }
  if (rng.chance(0.1)) {
    await attempt("PAYMENT_PENDING_TOO_LONG (reported)", async () => {
      const plan = rng.pick(plans.filter((p) => !p.handedOver && p.paidTzs < p.totalTzs));
      await reportProblem(plan.customer.champion.actor, { type: "PAYMENT_PENDING_TOO_LONG", orderId: plan.orderId, note: w.manifest.swahili("Mteja alilipa asubuhi lakini bado inaonyesha inasubiri") });
      w.manifest.count("exceptions.PAYMENT_PENDING_TOO_LONG");
    });
  }
  if (day === 6 || day === 15) {
    await attempt("WRONG_HUB", async () => {
      const hub = rng.pick(w.hubs);
      const delivery = await w.db.query.orders.findFirst({ where: and(eq(s.orders.kind, "RIDER_TO_HUB"), eq(s.orders.hubId, hub.id)) });
      if (!delivery) throw new Error("no delivery to report on");
      await reportProblem(hub.manager.actor, { type: "WRONG_HUB", orderId: delivery.id, note: "Rider first went to the other hub; arrived late" });
      w.manifest.count("exceptions.WRONG_HUB");
    });
  }
  if (day === 8 || day === 17) {
    await attempt("DAMAGED_OR_WET (champion stock)", async () => {
      const champion = rng.pick(w.champions);
      const batch = await w.db.query.batches.findFirst({ where: and(eq(s.batches.custodianUserId, champion.actor.userId), eq(s.batches.custodyState, "WITH_CHAMPION")) });
      if (!batch) throw new Error("champion holds no stock");
      const { exceptionRef } = await reportProblem(champion.actor, { type: "DAMAGED_OR_WET", batchId: batch.id, note: w.manifest.swahili("Mfuko umelowa mvua usiku") });
      w.manifest.anomaly("DAMAGED_OR_WET", "champion's lot quarantined after rain damage", { ids: { exceptionRef, batchCode: batch.code } });
      w.manifest.count("exceptions.DAMAGED_OR_WET");
    });
  }
  if (day === 12) {
    await attempt("SUSPECTED_THEFT", async () => {
      const hub = rng.pick(w.hubs);
      const batch = await w.db.query.batches.findFirst({ where: and(eq(s.batches.hubId, hub.id), eq(s.batches.custodyState, "AVAILABLE_AT_HUB")) });
      if (!batch) throw new Error("hub holds no stock");
      const { exceptionRef } = await reportProblem(hub.manager.actor, { type: "SUSPECTED_THEFT", batchId: batch.id, note: "Count short after the weekend; padlock damaged" });
      w.manifest.anomaly("SUSPECTED_THEFT", "hub lot quarantined pending investigation", { ids: { exceptionRef, batchCode: batch.code } });
      w.manifest.count("exceptions.SUSPECTED_THEFT");
    });
  }
}

/** Every reportable problem type at least twice over the run (Prompt B §2.3), without faking anything: a real report each. */
export async function ensureExceptionCoverage(w: World, plans: Plan[]): Promise<void> {
  const counts = await w.db.select({ type: s.exceptions.type, n: sql<number>`count(*)::int` }).from(s.exceptions).groupBy(s.exceptions.type);
  void counts;
  const champion = w.rng.pick(w.champions);
  const openPlan = plans.find((p) => !p.handedOver && p.paidTzs < p.totalTzs);
  /** A hub that currently holds an available lot, with that lot — any hub will do for a report. */
  const hubLot = async () => {
    for (const hub of w.rng.shuffle(w.hubs)) {
      const batch = await w.db.query.batches.findFirst({ where: and(eq(s.batches.hubId, hub.id), eq(s.batches.custodyState, "AVAILABLE_AT_HUB")) });
      if (batch) return { hub, batch };
    }
    throw new Error("no hub holds an available lot");
  };
  const reports: Record<string, () => Promise<unknown>> = {
    PAYMENT_PENDING_TOO_LONG: async () => openPlan && reportProblem(openPlan.customer.champion.actor, { type: "PAYMENT_PENDING_TOO_LONG", orderId: openPlan.orderId, note: "Payment still pending after a day" }),
    WRONG_AMOUNT: async () => openPlan && reportProblem(openPlan.customer.champion.actor, { type: "WRONG_AMOUNT", orderId: openPlan.orderId, note: "Amount shown differs from what the customer paid" }),
    STOCK_SHORT: async () => {
      const { hub, batch } = await hubLot();
      return reportProblem(hub.manager.actor, { type: "STOCK_SHORT", batchId: batch.id, note: "Recount found two packs fewer than recorded" });
    },
    SEAL_BROKEN: async () => {
      const { hub, batch } = await hubLot();
      return reportProblem(hub.manager.actor, { type: "SEAL_BROKEN", batchId: batch.id, note: "Seal found broken during the weekly check" });
    },
    DAMAGED_OR_WET: async () => {
      const batch = await w.db.query.batches.findFirst({ where: and(eq(s.batches.custodianUserId, champion.actor.userId), eq(s.batches.custodyState, "WITH_CHAMPION")) });
      if (!batch) throw new Error("champion holds no stock for DAMAGED_OR_WET");
      return reportProblem(champion.actor, { type: "DAMAGED_OR_WET", batchId: batch.id, note: w.manifest.swahili("Mfuko umelowa") });
    },
    WRONG_HUB: async () => {
      // A completed delivery whose lot is not locked, so the report can later be closed without a custody decision.
      const deliveries = await w.db.query.orders.findMany({ where: and(eq(s.orders.kind, "RIDER_TO_HUB"), eq(s.orders.state, "COMPLETED")) });
      const delivery = deliveries[w.rng.int(0, Math.max(0, deliveries.length - 1))];
      if (!delivery) throw new Error("no delivery for WRONG_HUB");
      const hub = w.hubs.find((h) => h.id === delivery.hubId) ?? w.hubs[0]!;
      return reportProblem(hub.manager.actor, { type: "WRONG_HUB", orderId: delivery.id, note: "Delivered to the wrong hub first" });
    },
    REFUND_REQUEST: async () => openPlan && requestRefundReviewSafe(w, openPlan),
    CUSTOMER_UNWELL: async () => reportProblem(champion.actor, { type: "CUSTOMER_UNWELL", note: "Customer felt unwell; referred to the facility. No details recorded." }),
    SUSPECTED_THEFT: async () => {
      const { hub, batch } = await hubLot();
      return reportProblem(hub.manager.actor, { type: "SUSPECTED_THEFT", batchId: batch.id, note: "Store found open in the morning" });
    },
    WASH_CONCERN: async () => reportProblem(champion.actor, { type: "WASH_CONCERN", note: w.manifest.swahili("Hakuna maji safi wiki hii") }),
    OTHER: async () => reportProblem(champion.actor, { type: "OTHER", note: "Road closed by rain; visits postponed" }),
    // System-raised types: the verifier opens these itself when the provider's answer does not match the intent.
    // (OVERPAYMENT is an exception type the verifier never raises — an over-payment becomes an intent in review
    // plus a reconciliation flag; recorded as a finding in docs/REVIEW.md rather than faked here.)
    PAYEE_MISMATCH: async () => withOpenPlan((p) => reviewPayment(w, p.orderId, "wrong_payee", p.installments[0])),
    // A callback the provider then reports FAILED is what the verifier files as UNMATCHED_PAYMENT (a spoofed callback is a security event, not an exception).
    // The verifier only files it when the customer had said she was paying (an unclaimed FAILED is provider noise).
    UNMATCHED_PAYMENT: async () => withOpenPlan(async (p) => {
      await expectCustomerPayment(p.customer.champion.actor, p.orderId);
      await reviewPayment(w, p.orderId, "failure", p.installments[0]);
    }),
    PAYMENT_REVERSED: async () => withOpenPlan(async (p) => {
      await reversedPayment(w, p.orderId); // pays what is left, then the provider reverses it
      await resyncPlan(w, p); // the plan owes the same again; let the database say how much
      if (p.installments.length) p.nextPaymentDay = (p.nextPaymentDay ?? 0) + w.rng.int(2, 5);
    }),
  };
  // Each system scenario gets its own open plan so no single customer collects every anomaly.
  const openPlans = plans.filter((p) => !p.handedOver && p.installments.length > 0);
  let cursor = 0;
  async function withOpenPlan(fn: (p: Plan) => Promise<unknown>): Promise<unknown> {
    const p = openPlans[cursor++ % Math.max(1, openPlans.length)];
    if (!p) throw new Error("no open plan available");
    await fn(p);
    return true;
  }
  // Re-count from the database after every report: a system-raised scenario may land as a different type
  // (the verifier decides), so an optimistic +1 would overstate coverage.
  const countOf = async (type: string) => Number((await w.db.select({ n: sql<number>`count(*)::int` }).from(s.exceptions).where(eq(s.exceptions.type, type as (typeof s.exceptions.$inferSelect)["type"])))[0]?.n ?? 0);
  for (const [type, fn] of Object.entries(reports)) {
    let attempts = 0;
    while ((await countOf(type)) < 2 && attempts < 4) {
      attempts++;
      try {
        const r = await fn();
        if (!r) throw new Error("no target available");
        if (type === "DAMAGED_OR_WET" || type === "SUSPECTED_THEFT" || type === "STOCK_SHORT" || type === "SEAL_BROKEN") w.manifest.anomaly(type, "reported to reach coverage; lot locked", {});
        w.manifest.count(`exceptions.${type}`);
        w.tick(3, 30);
      } catch (e) {
        w.manifest.skip(`coverage ${type}`, e);
        break;
      }
    }
    if ((await countOf(type)) < 2 && attempts >= 4) w.manifest.skip(`coverage ${type}`, new Error(`still below two after ${attempts} attempts`));
  }
}

async function requestRefundReviewSafe(w: World, p: Plan): Promise<unknown> {
  const { requestRefundReview } = await import("@/lib/services/orders");
  return requestRefundReview(p.customer.champion.actor, p.orderId, "Customer asks for a refund of the first installment");
}

export async function syncNotes(w: World, day: number): Promise<void> {
  if (!w.rng.chance(0.6)) return;
  const champion = w.rng.pick(w.champions);
  const bodies = [
    w.manifest.swahili("Nimetembelea wateja watatu leo; wawili wataendelea kulipa wiki ijayo"),
    "Hub asked me to come back Thursday for the next lot",
    w.manifest.swahili("Mteja mmoja ameomba bidhaa ya kutupwa badala ya ile ya kutumika tena"),
    "Phone battery low all afternoon; notes written offline",
  ];
  const notes = Array.from({ length: w.rng.int(1, 2) }, () => ({
    clientId: randomUUID(),
    category: w.rng.pick(["GENERAL", "STOCK", "CUSTOMER_VISIT", "PROBLEM"] as const),
    body: w.rng.pick(bodies),
    writtenAt: new Date(now().getTime() - w.rng.int(1, 6) * 3_600_000),
  }));
  try {
    await syncOfflineNotes(champion.actor, notes);
    w.manifest.count("notes", notes.length);
  } catch (e) {
    w.manifest.skip("syncOfflineNotes", e);
  }
  void day;
}

/** Enrolment, lost phones, lockouts, suspension and re-enrolment through the real flows. */
export async function peopleLifecycle(w: World, day: number, totalDays: number): Promise<void> {
  const attempt = async (name: string, fn: () => Promise<void>) => {
    try {
      await fn();
    } catch (e) {
      w.manifest.skip(name, e);
    }
  };
  const hub = w.hubs[0]!;
  if (day === 2) {
    await attempt("enrol champion via SMS link", async () => {
      const name = w.names.person();
      const phone = w.names.fieldPhone();
      const { userId } = await createUser(w.adminA, { role: "FIELD_CHAMPION", displayName: name, phone, hubId: hub.id, serviceAreaId: hub.areaId, payoutProvider: "MPESA", payeeAccount: w.names.till("CHA", 300) });
      w.tick(30, 600);
      const token = await w.enrollTokenFromSms(phone);
      const device = `demo-device-${userId.slice(0, 8)}`;
      const { challengeId } = await startFieldEnrollment(token, phone, device, "127.0.0.1");
      w.tick(1, 3);
      const code = await w.lastSmsCode(phone, "OTP");
      await completeFieldEnrollment(token, challengeId, code, SEED.fieldPin, device);
      hub.champions.push({ actor: { userId, role: "FIELD_CHAMPION", hubId: hub.id, supplierId: null, mfa: false }, name, phone, pin: SEED.fieldPin, payee: "" });
      w.manifest.count("people.enrolled_via_link");
    });
  }
  if (day === 3) {
    await attempt("invite left pending + OTP burst", async () => {
      const phone = w.names.fieldPhone();
      await createUser(w.adminA, { role: "FIELD_CHAMPION", displayName: w.names.person(), phone, hubId: hub.id, serviceAreaId: hub.areaId, payoutProvider: "MPESA", payeeAccount: w.names.till("CHA", 301) });
      w.tick(60, 300);
      const token = await w.enrollTokenFromSms(phone);
      let refused = 0;
      for (let i = 0; i < 6; i++) {
        try {
          await startFieldEnrollment(token, phone, "demo-burst-device", "127.0.0.1");
        } catch {
          refused++;
        }
        w.clock.advance(5_000);
      }
      w.manifest.count("security.otp_burst_refusals", refused);
      w.manifest.anomaly("PENDING_ENROLLMENT", "invited champion never completed enrollment (link unused)", { ids: {} });
    });
  }
  if (day === 5) {
    await attempt("lost phone: self-lock then admin re-enrol", async () => {
      const champion = hub.champions[1]!;
      const ok = await lockWithPhoneAndPin(champion.phone, champion.pin, "127.0.0.1");
      if (!ok) throw new Error("self-lock refused");
      w.manifest.count("security.self_locks");
      w.tick(600, 1200);
      await adminReenrollUser(w.adminA, champion.actor.userId);
      w.tick(60, 300);
      const token = await w.enrollTokenFromSms(champion.phone);
      const device = `demo-device-new-${champion.actor.userId.slice(0, 8)}`;
      const { challengeId } = await startFieldEnrollment(token, champion.phone, device, "127.0.0.1");
      w.tick(1, 3);
      const code = await w.lastSmsCode(champion.phone, "OTP");
      await completeFieldEnrollment(token, challengeId, code, SEED.fieldPin, device);
      w.manifest.count("people.reenrolled");
    });
  }
  if (day === 6) {
    await attempt("PIN lockout", async () => {
      const rider = w.riders[w.riders.length - 1]!;
      for (let i = 0; i < 6; i++) {
        try {
          await loginWithPin(rider.phone, "0000", "demo-lockout-device", "127.0.0.1");
        } catch {
          /* refused, as it should be */
        }
        w.clock.advance(20_000);
      }
      const u = await w.db.query.users.findFirst({ where: eq(s.users.id, rider.actor.userId) });
      if (!u?.lockedUntil && u?.status !== "LOCKED") throw new Error("six wrong PINs did not lock the account");
      w.manifest.count("security.pin_lockouts");
    });
  }
  if (day === 9) {
    await attempt("suspend idle champion", async () => {
      const lastHub = w.hubs[w.hubs.length - 1]!;
      const champion = lastHub.champions[lastHub.champions.length - 1]!;
      await adminSuspendUser(w.adminA, champion.actor.userId, true);
      w.manifest.anomaly("SUSPENDED_USER", "champion suspended by admin (demo: inactive)", { ids: { userId: champion.actor.userId } });
      // Take them out of the daily loop.
      lastHub.champions.pop();
    });
  }
  if (day === 14 && w.rng.chance(1)) {
    await attempt("admin lock", async () => {
      const champion = w.hubs[0]!.champions[0]!;
      await adminLockUser(w.adminA, champion.actor.userId, "device reported stolen");
      w.tick(30, 90);
      await adminReenrollUser(w.adminA, champion.actor.userId);
      w.tick(60, 200);
      const token = await w.enrollTokenFromSms(champion.phone);
      const device = `demo-device-2-${champion.actor.userId.slice(0, 8)}`;
      const { challengeId } = await startFieldEnrollment(token, champion.phone, device, "127.0.0.1");
      w.tick(1, 3);
      const code = await w.lastSmsCode(champion.phone, "OTP");
      await completeFieldEnrollment(token, challengeId, code, SEED.fieldPin, device);
      w.manifest.count("people.reenrolled");
    });
  }
  if (day === totalDays - 1) {
    await attempt("admin lock awaiting a new phone", async () => {
      const lastHub = w.hubs[w.hubs.length - 1]!;
      const champion = lastHub.champions[0]!;
      await adminLockUser(w.adminA, champion.actor.userId, "phone stolen; replacement expected next week");
      w.manifest.anomaly("LOCKED_USER", "champion locked by admin on the last day; re-enrolment pending", { ids: { userId: champion.actor.userId } });
    });
  }
  if (day === totalDays - 2) {
    await attempt("fresh invite (pending at the end)", async () => {
      await createUser(w.adminA, { role: "FIELD_CHAMPION", displayName: w.names.person(), phone: w.names.fieldPhone(), hubId: hub.id, serviceAreaId: hub.areaId, payoutProvider: "AIRTEL", payeeAccount: w.names.till("CHA", 302) });
      w.manifest.anomaly("PENDING_ENROLLMENT", "champion invited two days before the end; link unused", { ids: {} });
    });
  }
}

/** Admin A proposes, admin B approves — for exceptions older than a day, leaving the newest open. */
export async function resolveOpenExceptions(w: World, day: number, totalDays: number): Promise<void> {
  const cutoff = new Date(now().getTime() - 24 * 3_600_000);
  const open = await w.db.query.exceptions.findMany({ where: and(ne(s.exceptions.status, "RESOLVED"), lt(s.exceptions.createdAt, cutoff)) });
  for (const ex of open) {
    // Leave a share open, and everything from the last two days, so the attention lists are populated.
    if (day >= totalDays - 2 || w.rng.chance(0.35)) continue;
    const pending = await w.db.query.approvalRequests.findFirst({ where: and(eq(s.approvalRequests.type, "EXCEPTION_RESOLVE"), eq(s.approvalRequests.status, "PENDING"), sql`${s.approvalRequests.payload} ->> 'exceptionId' = ${ex.id}`) });
    if (pending) continue;
    // A report about a lot that is locked (by this or another report) needs a custody decision; anything else is simply closed.
    const batchId = ex.batchId ?? (ex.orderId ? (await w.db.query.orders.findFirst({ where: eq(s.orders.id, ex.orderId) }))?.batchId ?? null : null);
    const batch = batchId ? await w.db.query.batches.findFirst({ where: eq(s.batches.id, batchId) }) : null;
    const locked = !!batch && isLocked(batch.custodyState);
    const outcome = locked ? (ex.type === "DAMAGED_OR_WET" || ex.type === "SUSPECTED_THEFT" ? "RETURN" : "RESUME") : "CLOSE";
    try {
      const { requestId } = await proposeResolution(w.adminA, ex.id, outcome, `${outcome}: checked with the ${ex.lockedBatch ? "hub" : "reporter"} (demo)`);
      w.tick(20, 240);
      await decideApproval(w.adminB, requestId, "APPROVE");
      w.manifest.count(`exceptions.resolved.${outcome}`);
    } catch (e) {
      w.manifest.skip(`resolve ${ex.type}`, e);
    }
  }
}

// ---------- statement ----------

/** Provider statement for [from, to) with deliberate differences, imported by admin A. */
export async function importStatementForLastWeek(w: World, from: Date, to: Date): Promise<void> {
  const confirmed = await w.db
    .select({ providerTxRef: s.paymentIntents.providerTxRef, amount: s.paymentIntents.confirmedAmountTzs, payee: s.paymentIntents.payeeAccount, at: s.paymentIntents.confirmedAt })
    .from(s.paymentIntents)
    .where(and(eq(s.paymentIntents.status, "PAYMENT_CONFIRMED"), gte(s.paymentIntents.confirmedAt, from), lt(s.paymentIntents.confirmedAt, to)));
  const rows = confirmed.filter((r) => r.providerTxRef && r.amount !== null && r.at);
  if (rows.length < 4) {
    w.manifest.skip("statement import", new Error(`only ${rows.length} confirmed payments in the last week`));
    return;
  }
  const shuffled = w.rng.shuffle(rows);
  const missingInStatement = shuffled.slice(0, 2);
  const kept = shuffled.slice(2);
  // One deliberate difference on a payment to a supplier when the week has one (Prompt B §8.5).
  const supplierPayees = new Set(w.supplierOrgs.flatMap((o) => o.users.map((u) => u.payee)));
  const differs = kept.find((r) => r.payee && supplierPayees.has(r.payee)) ?? kept[0]!;
  const stray = await strayProviderTransaction(w, w.hubs[0]!.manager.payee, 4500);
  const lines = ["reference,amount,payee,date"];
  for (const r of kept) lines.push(`${r.providerTxRef},${r === differs ? (r.amount ?? 0) + 500 : r.amount},${r.payee ?? ""},${tzDay(r.at!)}`);
  lines.push(`${stray},4500,${w.hubs[0]!.manager.payee},${tzDay(new Date(to.getTime() - 3_600_000))}`);
  const { importId, diff } = await importStatement(w.adminA, "mock", `statement-${tzDay(from)}.csv`, lines.join("\n"));
  for (const r of missingInStatement) w.manifest.anomaly("STATEMENT_MISSING_IN_STATEMENT", "confirmed here, left out of the statement on purpose", { ids: { providerTxRef: r.providerTxRef! } });
  w.manifest.anomaly("STATEMENT_AMOUNT_DIFFERS", supplierPayees.has(differs.payee ?? "") ? "statement amount of a supplier payment raised by 500 on purpose" : "statement amount raised by 500 on purpose", { ids: { providerTxRef: differs.providerTxRef! } });
  w.manifest.anomaly("STATEMENT_MISSING_IN_APP", "a provider transaction with no order behind it", { ids: { providerTxRef: stray } });
  w.manifest.count("statement.matched", diff.matched.length);
  w.manifest.count("statement.imports");
  void importId;
}
