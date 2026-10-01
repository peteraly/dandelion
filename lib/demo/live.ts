/**
 * The demo district, live. The seed and the "one day" tick run a sale start to
 * finish in one go, so the map would never catch one on the way. Here, on
 * every "one hour" tick, each order started by this module moves exactly one
 * step, by the person who would take it in the field:
 *
 *  - factory → rider → hub: prepared, picked up and paid for, on the road
 *    (sometimes for two ticks), inspected at the hub, paid for, handed over;
 *  - an organisation's bulk order: ordered, paid, delivered.
 *
 * Every step is a real service call; payments go through the mock provider
 * like everywhere else. Only orders started here are advanced (their ids live
 * in settings.demoLiveOrders), so the dataset's deliberate anomalies — a batch
 * waiting on a late supplier, a delivery on hold — stay where the story put them.
 */
import { getSetting, putSetting } from "@/lib/services/core";
import { tzDay } from "@/lib/util/time";
import { acceptPickup, adminCreatePickup, confirmBatchReady, confirmReceipt, confirmRelease, createOrgSale, deliverOrgSale, passInspection, revealDeliveryCode, startInspection } from "@/lib/services/orders";
import { restockSuggestions } from "@/lib/services/replenishment";
import { CHECKS, INSPECTION_OK, pay } from "./supply";
import type { Person, World } from "./world";

/** Deliveries in flight at once; a new one starts whenever fewer are moving. */
export const LIVE_CHAINS = 4;
/** Chance per hour that an organisation places a bulk order, when none is in flight (certain when no hub needs stock). */
const ORG_ORDER_CHANCE = 0.35;
/** Without demand, a hub is topped up to at most this many times its order-up-to level. */
const TOP_UP_CAP = 2;
/** Never track more than this, whatever the setting holds (it lives in a shared table). */
const MAX_TRACKED = 12;

/** The tracked ids from settings.demoLiveOrders: a JSON list (the driver hands it back parsed) or its text; anything else is nothing. */
export function parseLive(raw: unknown): string[] {
  let v: unknown = raw;
  if (typeof raw === "string") {
    try {
      v = raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  }
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && /^[0-9a-f-]{36}$/.test(x)).slice(0, MAX_TRACKED) : [];
}

function people(w: World): Person[] {
  return [...w.riders, ...w.hubs.flatMap((h) => [h.manager, ...h.champions]), ...w.supplierOrgs.flatMap((o) => o.users)];
}

/** One step for one tracked order. Returns the id to keep tracking (the delivery replaces the pickup), or null when done. */
async function step(w: World, orderId: string): Promise<string | null> {
  const o = await w.order(orderId);
  const who = (id: string | null) => people(w).find((p) => p.actor.userId === id);
  const hub = w.hubs.find((h) => h.id === o.hubId);
  const supplierUser = w.supplierOrgs.find((x) => x.id === o.supplierId)?.users[0];
  const rider = who(o.kind === "SUPPLIER_TO_RIDER" ? o.buyerUserId : o.sellerUserId);
  switch (`${o.kind}:${o.state}`) {
    case "SUPPLIER_TO_RIDER:PICKUP_ASSIGNED":
      if (!supplierUser) return null;
      await confirmBatchReady(supplierUser.actor, o.id, `SEAL-${w.rng.int(10000, 99999)}`, { packedWaterproof: true });
      return o.id;
    case "SUPPLIER_TO_RIDER:BATCH_READY":
      if (!rider) return null;
      await acceptPickup(rider.actor, o.id, { rainCover: true });
      return o.id;
    case "SUPPLIER_TO_RIDER:AWAITING_PAYMENT":
    case "RIDER_TO_HUB:AWAITING_PAYMENT":
    case "SUPPLIER_TO_ORG:AWAITING_PAYMENT":
    case "HUB_TO_ORG:AWAITING_PAYMENT":
    case "RIDER_TO_ORG:AWAITING_PAYMENT":
      await pay(w, o.id, "success");
      return o.id;
    case "SUPPLIER_TO_RIDER:PAID": {
      if (!supplierUser || !rider) return null;
      await confirmRelease(supplierUser.actor, o.id);
      await confirmReceipt(rider.actor, o.id, CHECKS);
      w.manifest.count("live.onTheRoad");
      return (await w.deliveryOrderFor(o.id)).id;
    }
    case "RIDER_TO_HUB:EN_ROUTE": {
      if (!rider || !hub) return null;
      if (w.rng.chance(0.5)) return o.id; // still riding
      const code = await revealDeliveryCode(rider.actor, o.id);
      await startInspection(hub.manager.actor, o.id, code);
      return o.id;
    }
    case "RIDER_TO_HUB:INSPECTING":
      if (!hub) return null;
      await passInspection(hub.manager.actor, o.id, INSPECTION_OK);
      return o.id;
    case "RIDER_TO_HUB:PAID":
      if (!rider) return null;
      await confirmRelease(rider.actor, o.id);
      w.manifest.count("live.delivered");
      return null;
    case "SUPPLIER_TO_ORG:PAID":
    case "HUB_TO_ORG:PAID":
    case "RIDER_TO_ORG:PAID": {
      const seller = who(o.sellerUserId);
      if (!seller) return null;
      await deliverOrgSale(seller.actor, o.id);
      w.manifest.count("live.orgDelivered");
      return null;
    }
    default:
      return null; // moved on by someone else (an admin, a reversal): stop following it
  }
}

/** Advance every live order one step, then start new ones: deliveries until LIVE_CHAINS are moving, now and then an organisation's order. */
export async function advanceLiveChains(w: World): Promise<{ tracked: number; started: number }> {
  const next: string[] = [];
  for (const id of parseLive(await getSetting("demoLiveOrders"))) {
    try {
      const keep = await step(w, id);
      if (keep) next.push(keep);
      w.manifest.count("live.steps");
    } catch (e) {
      w.manifest.skip("liveChainStep", e);
    }
  }
  const kinds = new Map((await Promise.all(next.map((id) => w.order(id)))).map((o) => [o.id, o.kind]));
  const deliveries = next.filter((id) => !kinds.get(id)?.endsWith("_TO_ORG")).length;
  let started = 0;
  const hubs = w.hubs.filter((h) => w.areas.find((a) => a.id === h.areaId)?.suppliers.some((o) => o.users.length));
  const rows = (await restockSuggestions(null)).filter((r) => hubs.some((h) => h.id === r.hubId));
  // Demand first: hubs whose sales say they will run out before a pickup arrives (lib/domain/replenishment.ts).
  const due = rows.filter((r) => r.suggested > 0);
  // Otherwise top up a hub with room below twice its order-up-to level, never beyond: the map keeps moving without
  // piling months of stock on a shelf (Prompt I §2.3). When no hub has room, an organisation's order keeps it moving.
  const roomOf = (r: (typeof rows)[number]) => TOP_UP_CAP * r.orderUpTo - (r.onHand + r.onTheWay - r.waiting);
  const room = rows.filter((r) => r.suggested === 0 && roomOf(r) >= 10);
  // New pickups go to delivery partners nobody is playing in the app right now.
  const riders = w.riders.filter((r) => !w.busy.has(r.actor.userId));
  for (let d = deliveries; d < LIVE_CHAINS && riders.length && started < 2; d++) {
    const want = due.shift() ?? (room.length ? room.splice(w.rng.int(0, room.length - 1), 1)[0] : undefined);
    if (!want) break;
    const hub = hubs.find((h) => h.id === want.hubId)!;
    const quantity = want.suggested > 0 ? Math.min(120, want.suggested) : Math.min(120, Math.floor(roomOf(want) / 10) * 10);
    const org = w.pickSupplier(w.areas.find((a) => a.id === hub.areaId)!);
    try {
      const { orderId } = await adminCreatePickup(w.adminA, { supplierId: org.id, productId: want.productId, hubId: hub.id, riderId: w.rng.pick(riders).actor.userId, quantity, pickupDate: tzDay() });
      next.push(orderId);
      w.manifest.count("live.started");
    } catch (e) {
      w.manifest.skip("liveChainStart", e);
    }
    started++;
  }
  // An organisation's bulk order from the factory, when none is in flight: ordered now, paid next hour, delivered after.
  const orgInFlight = next.some((id) => kinds.get(id)?.endsWith("_TO_ORG"));
  const buyer = w.organisations.length ? w.rng.pick(w.organisations) : null;
  const seller = buyer ? w.areas.find((a) => a.id === buyer.areaId)?.suppliers.find((o) => o.users.length)?.users[0] : undefined;
  const hubsFull = started === 0 && deliveries < LIVE_CHAINS; // room for a delivery, but no hub needs or has room for stock
  if (!orgInFlight && buyer && seller && (hubsFull || w.rng.chance(ORG_ORDER_CHANCE))) {
    try {
      const { orderId } = await createOrgSale(seller.actor, { organisationId: buyer.id, productId: w.product().id, quantity: w.rng.int(20, 60) });
      next.push(orderId);
      w.manifest.count("live.orgOrders");
    } catch (e) {
      w.manifest.skip("liveOrgSale", e); // the area may not have switched organisation sales on
    }
  }
  await putSetting(w.db, "demoLiveOrders", next.slice(0, MAX_TRACKED), w.adminA.userId);
  return { tracked: next.length, started };
}
