/**
 * The shop in the demo district (Prompt L §3): girls and women join with their phone, ask for a pack at a public
 * meeting point, and the village delivery partner accepts when he holds the product; the sale then runs like any
 * other plan. At the end of the history one request is left waiting, so the field app and the admin home show it.
 * Every step is the real service call; codes are read from the mock SMS outbox like everywhere else in the demo.
 */
import { addMeetingPoint, meetingPointsFor } from "@/lib/services/areas";
import { acceptCustomerRequest, finishShopSignIn, joinShop, requestOrder } from "@/lib/services/shop";
import { planFromOrder, type Plan } from "./supply";
import type { Person, Product, World } from "./world";

export const DEMO_PLACES = ["Market gate", "Dispensary gate", "Primary school gate"] as const;

/** Each area's public meeting points, added by an admin. */
export async function addDemoPlaces(w: World): Promise<void> {
  for (const area of w.areas) {
    for (const name of DEMO_PLACES) {
      await addMeetingPoint(w.adminA, { serviceAreaId: area.id, name });
      w.manifest.count("shop.places");
    }
    w.tick(2, 10);
  }
}

/** A new customer joins the shop and orders one pack; `rider` accepts unless the request is left waiting. */
export async function shopOrder(w: World, rider: Person, product: Product, day: number, accept = true): Promise<Plan | null> {
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
  const { requestId } = await requestOrder({ id: customerId }, { productId: product.id, meetingPointId: place.id });
  w.manifest.count("shop.requests");
  if (!accept) return null;
  w.tick(10, 90);
  const { orderId } = await acceptCustomerRequest(rider.actor, requestId);
  w.manifest.count("shop.accepted");
  const c = { id: customerId, name, phone, champion: rider };
  w.customers.push(c);
  return planFromOrder(w, c, product, orderId, day);
}
