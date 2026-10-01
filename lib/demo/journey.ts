/**
 * The guided walkthrough (Prompt H): one sale, start to finish, across every
 * stakeholder, one step per click. Demand travels up and stock travels down:
 *
 *   a local seller signs up a customer → she pays in instalments → she gets
 *   her product with a one-time code → the seller restocks from the hub → the
 *   hub, now low, gets a pickup from the factory → the delivery partner
 *   collects, pays, rides, is inspected and paid → the hub is full again.
 *
 * Every step is the real service call by the person who would take it; every
 * text message goes through the same (mock) SMS provider as everywhere else,
 * so the phones on the walkthrough page show exactly what each person would
 * receive. Demo dataset only, outside production; its orders are held back
 * from the live engine (settings.demoJourney) so nobody else moves them.
 */
import { and, eq, gte } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import { decryptString } from "@/lib/crypto/envelope";
import { appEnv, simulatorEnabled } from "@/lib/env";
import { now } from "@/lib/clock";
import { DomainError, getSetting, logAdminAction, putSetting } from "@/lib/services/core";
import { hitRateLimit } from "@/lib/security/rate-limit";
import { createCustomer, verifyCustomerPhone } from "@/lib/services/customers";
import { acceptPickup, adminCreatePickup, completeHandover, confirmBatchReady, confirmReceipt, confirmRelease, passInspection, prepareTransfer, requestStock, revealDeliveryCode, startHandover, startInspection, startPlan } from "@/lib/services/orders";
import { paidTotals } from "@/lib/services/payments";
import { restockSuggestions } from "@/lib/services/replenishment";
import { tzDay } from "@/lib/util/time";
import { Rng } from "./rng";
import { RealClock } from "./clock";
import { loadWorld } from "./load";
import { pickProductForArea } from "./day";
import { CHECKS, EDUCATION, INSPECTION_OK, pay } from "./supply";
import type { Hub, Person, World } from "./world";
import { JOURNEY_STEPS, parseJourney, type JourneyRole, type JourneyState } from "./journey-state";

export { JOURNEY_STEPS, journeyOrderIds, parseJourney, type JourneyLogEntry, type JourneyRole, type JourneyState, type JourneyStepKey } from "./journey-state";

const KEY = "demoJourney";

export async function journeyState(): Promise<JourneyState | null> {
  return parseJourney(await getSetting(KEY));
}

async function guard(): Promise<void> {
  if (appEnv() === "production" || !simulatorEnabled()) throw new DomainError("simulator_disabled");
  if (String(await getSetting("seedProfile")) !== "demo") throw new DomainError("demo_profile_required");
  const limit = await hitRateLimit("demo:journey", 120, 600);
  if (!limit.allowed) throw new DomainError("rate_limited");
}

async function world(st: JourneyState | null): Promise<World> {
  const seed = String(await getSetting("demoSeed")) || "demo";
  return loadWorld(new Rng(`${seed}:journey:${st?.startedAt ?? Date.now()}:${st?.step ?? 0}`), new RealClock(), seed);
}

/** Units the local seller asks her hub for in the walkthrough (step "restockRequest"). */
const RESTOCK_UNITS = 5;

/**
 * Pick the people for a new walkthrough: a hub that can fill the seller's restock, a local seller there who has
 * stock for the first sale, its reliable supplier, a delivery partner. Hubs are stocked by demand, so not every hub
 * holds spare units; one that does is preferred, and any hub with a stocked seller is the fallback.
 */
export async function startJourney(adminId: string): Promise<JourneyState> {
  await guard();
  const w = await world(null);
  type Pick = { hub: Hub; seller: Person; productId: string };
  let chosen: Pick | null = null;
  let fallback: Pick | null = null;
  for (const hub of w.hubs) {
    const productId = pickProductForArea(w, hub).id;
    // The hub fills a request from one lot (prepareTransfer), so it needs a single lot that large, not just the total.
    const lot = await w.db.query.batches.findFirst({ where: and(eq(s.batches.hubId, hub.id), eq(s.batches.productId, productId), eq(s.batches.custodyState, "AVAILABLE_AT_HUB"), gte(s.batches.quantity, RESTOCK_UNITS)) });
    const hubCanRestock = !!lot;
    for (const seller of hub.champions) {
      if (chosen || w.busy.has(seller.actor.userId) || (await w.sellerStock(seller, productId)) < 1) continue;
      if (hubCanRestock) chosen = { hub, seller, productId };
      else fallback ??= { hub, seller, productId };
    }
  }
  chosen ??= fallback;
  if (!chosen) throw new DomainError("journey_no_seller_with_stock");
  const area = w.areas.find((a) => a.id === chosen!.hub.areaId)!;
  const org = area.suppliers.find((o) => o.quality === "good" && o.users.length) ?? area.suppliers.find((o) => o.users.length);
  if (!org || !w.riders.length) throw new DomainError("journey_no_supplier");
  const at = now().toISOString();
  const st: JourneyState = {
    step: 0,
    startedAt: at,
    lastAt: at,
    hubId: chosen.hub.id,
    sellerId: chosen.seller.actor.userId,
    riderId: w.riders[0]!.actor.userId,
    supplierUserId: org.users[0]!.actor.userId,
    supplierId: org.id,
    productId: chosen.productId,
    customerName: w.names.person(),
    customerPhone: w.names.customerPhone(),
    log: [],
  };
  await putSetting(w.db, KEY, st, adminId);
  await logAdminAction(w.db, adminId, "demo.journey", { type: "settings", id: KEY }, { step: "start" });
  return st;
}

/** Run the next step. Returns the new state; a failed step is recorded and can be retried or the walkthrough restarted. */
export async function advanceJourney(adminId: string): Promise<JourneyState> {
  await guard();
  const current = await journeyState();
  if (!current) throw new DomainError("journey_not_started");
  if (current.step >= JOURNEY_STEPS.length) return current;
  const w = await world(current);
  const st: JourneyState = { ...current, log: [...current.log], lastAt: now().toISOString() };
  delete st.error;
  const hub = w.hubs.find((h) => h.id === st.hubId);
  const seller = hub?.champions.find((c) => c.actor.userId === st.sellerId);
  const rider = w.riders.find((r) => r.actor.userId === st.riderId);
  const supplier = w.supplierOrgs.flatMap((o) => o.users).find((u) => u.actor.userId === st.supplierUserId);
  const product = w.products.find((p) => p.id === st.productId);
  const step = JOURNEY_STEPS[st.step]!;
  const facts: Record<string, string | number> = {};
  const ref = async (id: string | undefined) => (id ? await w.orderRef(id) : "");
  try {
    if (!hub || !seller || !rider || !supplier || !product) throw new DomainError("journey_people_changed");
    switch (step.key) {
      case "enrol": {
        const r = await createCustomer(seller.actor, { displayName: st.customerName, phone: st.customerPhone, consentMessages: true, consentReminders: true }, `journey-${st.startedAt}`, "127.0.0.1");
        st.customerId = r.customerId;
        st.challengeId = r.challengeId;
        break;
      }
      case "verify":
        await verifyCustomerPhone(seller.actor, st.customerId!, st.challengeId!, await w.lastSmsCode(st.customerPhone, "OTP"));
        break;
      case "plan": {
        st.planId = (await startPlan(seller.actor, st.customerId!, product.id)).orderId;
        const o = await w.order(st.planId);
        facts.ref = o.ref;
        facts.tzs = o.totalTzs;
        break;
      }
      case "payPart":
      case "payRest": {
        const o = await w.order(st.planId!);
        const owed = (await paidTotals(w.db, o)).remainingTzs;
        const amount = step.key === "payPart" ? Math.min(owed, Math.max(500, Math.round(o.totalTzs / 2 / 500) * 500)) : owed;
        await pay(w, o.id, "success", amount);
        facts.ref = o.ref;
        facts.tzs = amount;
        break;
      }
      case "handoverStart":
        await startHandover(seller.actor, st.planId!);
        facts.ref = await ref(st.planId);
        break;
      case "handoverDone":
        await completeHandover(seller.actor, st.planId!, await w.lastSmsCode(st.customerPhone, "HANDOVER_CODE"), EDUCATION[product.category]);
        facts.ref = await ref(st.planId);
        break;
      case "restockRequest":
        st.restockId = (await requestStock(seller.actor, { productId: product.id, quantity: RESTOCK_UNITS })).orderId;
        facts.ref = await ref(st.restockId);
        facts.units = RESTOCK_UNITS;
        break;
      case "restockPrepare":
        await prepareTransfer(hub.manager.actor, st.restockId!);
        if ((await w.order(st.restockId!)).state !== "AWAITING_PAYMENT") throw new DomainError("journey_hub_short");
        facts.ref = await ref(st.restockId);
        break;
      case "restockPay": {
        const o = await w.order(st.restockId!);
        await pay(w, o.id, "success");
        facts.ref = o.ref;
        facts.tzs = o.totalTzs;
        break;
      }
      case "restockHandover":
        await confirmRelease(hub.manager.actor, st.restockId!);
        await confirmReceipt(seller.actor, st.restockId!, CHECKS);
        facts.ref = await ref(st.restockId);
        break;
      case "pickupAssign": {
        // What the hub's sales say it needs (lib/domain/replenishment.ts); at least a small batch so the chain has something to carry.
        const [r] = await restockSuggestions(null, { hubId: hub.id }).then((rows) => rows.filter((x) => x.productId === product.id));
        const quantity = Math.max(20, Math.min(120, r?.suggested || 0));
        st.pickupId = (await adminCreatePickup(w.adminA, { supplierId: st.supplierId, productId: product.id, hubId: hub.id, riderId: rider.actor.userId, quantity, pickupDate: tzDay() })).orderId;
        facts.ref = await ref(st.pickupId);
        facts.units = quantity;
        facts.suggested = r?.suggested ?? 0;
        facts.daysLeft = r?.daysOfCover ?? "—";
        break;
      }
      case "batchReady":
        await confirmBatchReady(supplier.actor, st.pickupId!, `SEAL-${w.rng.int(10000, 99999)}`, { packedWaterproof: true });
        facts.ref = await ref(st.pickupId);
        break;
      case "pickupAccept":
        await acceptPickup(rider.actor, st.pickupId!, { rainCover: true });
        facts.ref = await ref(st.pickupId);
        break;
      case "pickupPay": {
        const o = await w.order(st.pickupId!);
        await pay(w, o.id, "success");
        facts.ref = o.ref;
        facts.tzs = o.totalTzs;
        break;
      }
      case "pickupHandover":
        await confirmRelease(supplier.actor, st.pickupId!);
        await confirmReceipt(rider.actor, st.pickupId!, CHECKS);
        st.deliveryId = (await w.deliveryOrderFor(st.pickupId!)).id;
        facts.ref = await ref(st.deliveryId);
        break;
      case "arrive":
        await startInspection(hub.manager.actor, st.deliveryId!, await revealDeliveryCode(rider.actor, st.deliveryId!));
        facts.ref = await ref(st.deliveryId);
        break;
      case "inspect":
        await passInspection(hub.manager.actor, st.deliveryId!, INSPECTION_OK);
        facts.ref = await ref(st.deliveryId);
        break;
      case "deliveryPay": {
        const o = await w.order(st.deliveryId!);
        await pay(w, o.id, "success");
        facts.ref = o.ref;
        facts.tzs = o.totalTzs;
        break;
      }
      case "deliveryRelease":
        await confirmRelease(rider.actor, st.deliveryId!);
        facts.ref = await ref(st.deliveryId);
        break;
    }
    st.log.push({ key: step.key, at: st.lastAt, facts });
    st.step += 1;
  } catch (e) {
    st.error = e instanceof DomainError ? e.code : e instanceof Error ? e.message.slice(0, 200) : String(e);
  }
  await putSetting(w.db, KEY, st, adminId);
  await logAdminAction(w.db, adminId, "demo.journey", { type: "settings", id: KEY }, { step: step.key, ok: !st.error });
  return st;
}

/** The people on the walkthrough's phones, with their phone numbers (fake range) for the SMS threads. */
export async function journeyPeople(st: JourneyState): Promise<{ role: JourneyRole; userId: string | null; name: string; phone: string }[]> {
  const db = getDb();
  const out: { role: JourneyRole; userId: string | null; name: string; phone: string }[] = [{ role: "customer", userId: null, name: st.customerName, phone: st.customerPhone }];
  for (const [role, id] of [
    ["seller", st.sellerId],
    ["hub", null],
    ["rider", st.riderId],
    ["supplier", st.supplierUserId],
  ] as const) {
    const u = id
      ? await db.query.users.findFirst({ where: eq(s.users.id, id) })
      : await db.query.users.findFirst({ where: and(eq(s.users.hubId, st.hubId), eq(s.users.role, "HUB_MANAGER")) });
    if (u) out.push({ role, userId: u.id, name: u.displayName, phone: await decryptString(u.phoneEnc) });
  }
  return out;
}
