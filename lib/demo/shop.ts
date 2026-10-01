/**
 * The shop in the demo district (Prompt L §3): girls and women join with their phone, ask for a pack at a public
 * meeting point, and the village delivery partner accepts when he holds the product; the sale then runs like any
 * other plan. At the end of the history one request is left waiting, so the field app and the admin home show it.
 * Every step is the real service call; codes are read from the mock SMS outbox like everywhere else in the demo.
 */
import { addMeetingPoint, meetingPointsFor } from "@/lib/services/areas";
import { and, eq, gt, isNotNull } from "drizzle-orm";
import * as s from "@/lib/db/schema";
import { acceptCustomerRequest, finishShopSignIn, joinShop, reportShopProblem, requestOrder } from "@/lib/services/shop";
import { decideApproval } from "@/lib/services/approvals";
import { proposeResolution } from "@/lib/services/exceptions";
import { DomainError } from "@/lib/services/core";
import { planFromOrder, resyncPlan, type Plan } from "./supply";
import type { Person, Product, World } from "./world";

/** Named public places, with when a seller is usually there so orders can be brought together (market day). */
export const DEMO_PLACES = [
  { name: "Market gate", when: "Thursdays 10–12 (market day)" },
  { name: "Dispensary gate", when: "Weekdays 15–17" },
  { name: "Primary school gate", when: null },
] as const;

/** Each area's public meeting points, added by an admin. */
export async function addDemoPlaces(w: World): Promise<void> {
  for (const area of w.areas) {
    for (const { name, when } of DEMO_PLACES) {
      await addMeetingPoint(w.adminA, { serviceAreaId: area.id, name, when: when ?? undefined });
      w.manifest.count("shop.places");
    }
    w.tick(2, 10);
  }
}

/**
 * A new customer joins the shop and orders one pack; `seller` (the village delivery partner, or a woman local seller
 * when she asks for one) accepts unless the request is left waiting.
 */
export async function shopOrder(w: World, seller: Person, product: Product, day: number, opts: { accept?: boolean; womenOnly?: boolean } = {}): Promise<Plan | null> {
  const accept = opts.accept ?? true;
  const area = w.areas[0]!;
  const places = await meetingPointsFor(w.db, area.id);
  if (!places.length) throw new Error("no meeting point in the first area");
  const place = w.rng.pick(places);
  const name = w.names.person();
  const phone = w.names.customerPhone();
  const { challengeId } = await joinShop({ displayName: name, phone, meetingPointId: place.id, consentMessages: true, consentReminders: w.rng.chance(0.7) }, { deviceId: null, ip: "127.0.0.1", openDemo: false });
  w.tick(1, 4);
  const { customerId } = await finishShopSignIn(challengeId, await w.lastSmsCode(phone, "OTP"));
  w.manifest.count("people.CUSTOMER");
  w.manifest.count("shop.joined");
  w.tick(2, 20);
  const { requestId } = await requestOrder({ id: customerId }, { productId: product.id, meetingPointId: place.id, womenOnly: opts.womenOnly ?? false });
  w.manifest.count("shop.requests");
  if (!accept) return null;
  w.tick(10, 90);
  const { orderId } = await acceptCustomerRequest(seller.actor, requestId);
  w.manifest.count("shop.accepted");
  if (opts.womenOnly) w.manifest.count("shop.womenOnly");
  const c = { id: customerId, name, phone, champion: seller };
  w.customers.push(c);
  return planFromOrder(w, c, product, orderId, day);
}

/**
 * Orders that passed on from a late seller (Prompt M §3.1) carry her payment and wait for the next seller in her area:
 * a local seller who holds the product takes it first, else a delivery partner. Nothing is owed, so the plan goes
 * straight to the hand-over. The late seller is never offered it.
 */
export async function takePassedOnOrders(w: World, plans: Plan[], day: number): Promise<void> {
  const waiting = await w.db.query.customerRequests.findMany({ where: and(eq(s.customerRequests.state, "OPEN"), gt(s.customerRequests.carriedTzs, 0)), limit: 5 });
  for (const r of waiting) {
    const c = w.customers.find((x) => x.id === r.customerId);
    const product = w.products.find((p) => p.id === r.productId);
    const area = w.areas.find((a) => a.id === r.serviceAreaId);
    if (!c || !product || !area) continue;
    const candidates = [...area.hubs.flatMap((h) => h.champions), ...(r.womenOnly ? [] : w.riders)].filter((x) => x.actor.userId !== r.excludedSellerId && !w.busy.has(x.actor.userId));
    for (const seller of candidates) {
      if ((await w.sellerStock(seller, r.productId)) < 1) continue;
      let orderId: string;
      try {
        ({ orderId } = await acceptCustomerRequest(seller.actor, r.id));
      } catch (e) {
        if (e instanceof DomainError) continue; // not in this seller's area: the next one
        throw e;
      }
      w.manifest.count("shop.passedOnTaken");
      c.champion = seller; // she is served by the seller of her latest order
      const plan = await planFromOrder(w, c, product, orderId, day);
      if ((await resyncPlan(w, plan)) === 0) plan.nextPaymentDay = null;
      plans.push(plan);
      w.tick(5, 30);
      break;
    }
  }
}

/**
 * Two customers tell Dandelion, from the shop, that something felt wrong at a hand-over. One is followed up and closed
 * by two admins (the seller was reminded to meet only at the public place); one waits for the safeguarding lead.
 */
export async function shopSafetyReports(w: World): Promise<void> {
  const accepted = await w.db.query.customerRequests.findMany({ where: and(eq(s.customerRequests.state, "ACCEPTED"), isNotNull(s.customerRequests.orderId)), orderBy: s.customerRequests.createdAt, limit: 2 });
  for (const [i, r] of accepted.entries()) {
    w.tick(30, 180);
    const { ref } = await reportShopProblem({ id: r.customerId }, { requestId: r.id, category: "unsafe", note: i === 0 ? "The seller asked to meet behind the market instead (demo)" : "Someone else came instead of the seller (demo)" });
    w.manifest.count("shop.safetyReports");
    if (i > 0) continue; // the second one waits for the safeguarding lead
    const ex = (await w.db.query.exceptions.findFirst({ where: eq(s.exceptions.ref, ref) }))!;
    w.tick(60, 240);
    const { requestId } = await proposeResolution(w.adminA, ex.id, "CLOSE", "Called her back; the seller was reminded to meet only at the public place (demo)");
    w.tick(10, 60);
    await decideApproval(w.adminB, requestId, "APPROVE", "Follow-up done (demo)");
  }
}

/**
 * A demo district built before the shop existed has no meeting points, so its shop would stay closed. On a redeploy
 * the build tops them up (the same named public places), and nothing else: the history is left as it was.
 */
export async function ensureDemoPlaces(): Promise<number> {
  const { getDb } = await import("@/lib/db/client");
  const db = getDb();
  if (await db.query.meetingPoints.findFirst({ columns: { id: true } })) return 0;
  const areas = await db.query.serviceAreas.findMany({ where: eq(s.serviceAreas.active, true) });
  const rows = areas.flatMap((a) => DEMO_PLACES.map((p) => ({ serviceAreaId: a.id, name: p.name, whenText: p.when })));
  if (rows.length) await db.insert(s.meetingPoints).values(rows);
  return rows.length;
}
