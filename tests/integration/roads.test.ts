/**
 * Prompt I §2 on a real database: an admin records the road to a hub and the
 * rains in its area; restocking plans for the road, learns from real trips,
 * does not read days with an empty shelf as days nobody wanted to buy, and
 * counts what local sellers are still waiting for.
 *
 * The clock runs ahead of real time from the first trip on (and only forward),
 * so three five-day trips can complete inside one test run.
 */
import { and, desc, eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { getDb } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import { SEED } from "@/scripts/seed";
import { setClock } from "@/lib/clock-override";
import { now, nowMs } from "@/lib/clock";
import { tzDay } from "@/lib/util/time";
import { PolicyError } from "@/lib/policy";
import { simulate } from "@/lib/payments/simulator";
import { acceptPickup, adminCreatePickup, confirmBatchReady, confirmReceipt, confirmRelease, passInspection, requestStock, revealDeliveryCode, startInspection } from "@/lib/services/orders";
import { updateAreaRains, updateHubRoad } from "@/lib/services/areas";
import { reportProblem } from "@/lib/services/exceptions";
import { hubRoads, recordHubStock, restockSuggestions, WINDOW_DAYS } from "@/lib/services/replenishment";
import { CHECKS, INSPECTION_OK } from "@/lib/demo/supply";
import { actors, ids, latestOrderOfKind, order, userByPhone } from "./helpers";

const DAY = 86_400_000;
let offset = 0;
/** Move the clock forward by `ms` and keep it running from there. */
function ahead(ms: number): void {
  offset += ms;
  const at = offset;
  setClock(() => new Date(Date.now() + at));
}

/** One factory → delivery partner → hub trip that takes `days` from pickup assigned to stock on the hub's shelf. */
async function trip(days: number, seal: string): Promise<void> {
  const { supplier, hub, kit } = await ids();
  const rider = await userByPhone(SEED.riders[0]!.phone);
  ahead(60_000);
  const { orderId: pickupId } = await adminCreatePickup(await actors.adminA(), { supplierId: supplier.id, productId: kit.id, hubId: hub.id, riderId: rider.id, quantity: 10, pickupDate: tzDay() });
  await confirmBatchReady(await actors.supplier(), pickupId, seal, { packedWaterproof: true });
  await acceptPickup(await actors.rider(), pickupId, { rainCover: true });
  await simulate("success", (await order(pickupId)).ref);
  await confirmRelease(await actors.supplier(), pickupId);
  await confirmReceipt(await actors.rider(), pickupId, CHECKS);
  const delivery = await latestOrderOfKind("RIDER_TO_HUB", pickupId);
  ahead(days * DAY);
  await startInspection(await actors.hub(), delivery.id, await revealDeliveryCode(await actors.rider(), delivery.id));
  await passInspection(await actors.hub(), delivery.id, INSPECTION_OK);
  await simulate("success", (await order(delivery.id)).ref);
  await confirmRelease(await actors.rider(), delivery.id);
}

const month = () => Number(tzDay().slice(5, 7));
const otherMonth = () => (month() % 12) + 1;

describe("roads and rains", () => {
  afterAll(() => setClock(null));

  it("an admin records the road to a hub and the area's rainy months; both are logged; nobody else can", async () => {
    const { hub, area } = await ids();
    const admin = await actors.adminA();
    await updateHubRoad(admin, hub.id, { distanceKm: 95, road: "DIRT", slowInRains: true });
    await updateAreaRains(admin, area.id, [12, 3, 3, 4]);
    const db = getDb();
    expect(await db.query.hubs.findFirst({ where: eq(s.hubs.id, hub.id) })).toMatchObject({ distanceKm: 95, road: "DIRT", slowInRains: true });
    expect((await db.query.serviceAreas.findFirst({ where: eq(s.serviceAreas.id, area.id) }))!.rainyMonths).toEqual([3, 4, 12]);
    const log = await db.query.adminActionLog.findFirst({ where: and(eq(s.adminActionLog.action, "hub.road.update"), eq(s.adminActionLog.targetId, hub.id)), orderBy: desc(s.adminActionLog.id) });
    expect(log?.details).toMatchObject({ before: { distanceKm: null, road: null }, after: { distanceKm: 95, road: "DIRT" } });
    expect(await db.query.adminActionLog.findFirst({ where: eq(s.adminActionLog.action, "area.rains.update") })).toBeTruthy();

    await expect(updateHubRoad(await actors.hub(), hub.id, { distanceKm: 1, road: "PAVED", slowInRains: false })).rejects.toThrow(PolicyError);
    await expect(updateAreaRains(await actors.champion(), area.id, [1])).rejects.toThrow(PolicyError);
    await expect(updateHubRoad(admin, hub.id, { distanceKm: -1, road: "PAVED", slowInRains: false })).rejects.toThrow();
    await expect(updateAreaRains(admin, area.id, [13])).rejects.toThrow();
  });

  it("plans a dirt road far out as longer, and twice that while the rains slow it", async () => {
    const { hub, area, supplier } = await ids();
    const admin = await actors.adminA();
    await updateHubRoad(admin, hub.id, { distanceKm: 95, road: "DIRT", slowInRains: true });
    await updateAreaRains(admin, area.id, [otherMonth()]);
    const dry = (await hubRoads({ hubId: hub.id })).get(hub.id)!;
    // Dirt (2 days) + far (1 day) on top of the supplier's promise.
    expect(dry.lead).toMatchObject({ days: supplier.leadTimeDays + 3, source: "planned" });
    expect(dry.rainyNow).toBe(false);
    await updateAreaRains(admin, area.id, [month()]);
    const wet = (await hubRoads({ hubId: hub.id })).get(hub.id)!;
    expect(wet.rainyNow).toBe(true);
    expect(wet.lead.days).toBe(supplier.leadTimeDays + 6);
    // Restock suggestions plan with the same lead time.
    const rows = await restockSuggestions(null, { hubId: hub.id });
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) expect(r.leadTimeDays).toBe(wet.lead.days);
  });

  it("learns from real trips: slower than the plan → the real time; a fast record never shortens a careful plan", async () => {
    const { hub, area, supplier } = await ids();
    const admin = await actors.adminA();
    await updateHubRoad(admin, hub.id, { distanceKm: 4, road: "PAVED", slowInRains: false });
    expect((await hubRoads({ hubId: hub.id })).get(hub.id)!.lead).toMatchObject({ days: supplier.leadTimeDays + 1, trips: 0, measuredDays: null, source: "planned" });
    for (const [i, days] of [5, 5, 5].entries()) await trip(days, `SEAL-ROAD-${i}`);
    const learned = (await hubRoads({ hubId: hub.id })).get(hub.id)!;
    expect(learned.lead.trips).toBe(3);
    expect(learned.lead.measuredDays).toBeCloseTo(5, 0);
    expect(learned.lead).toMatchObject({ days: 5, source: "measured" });
    expect(learned.roadDaysTypical).toBeCloseTo(5, 0);

    await updateHubRoad(admin, hub.id, { distanceKm: 95, road: "DIRT", slowInRains: true });
    await updateAreaRains(admin, area.id, [month()]);
    expect((await hubRoads({ hubId: hub.id })).get(hub.id)!.lead).toMatchObject({ days: supplier.leadTimeDays + 6, source: "planned" });
  });

  it("records each hub's shelf once a night; a second run the same day overwrites", async () => {
    const db = getDb();
    const first = await recordHubStock();
    expect(first.rows).toBeGreaterThan(0);
    const second = await recordHubStock();
    expect(second.rows).toBe(first.rows);
    const today = await db.query.hubStockDays.findMany({ where: eq(s.hubStockDays.day, tzDay()) });
    expect(today).toHaveLength(first.rows);
    const { hub, kit } = await ids();
    const shelf = await db.query.batches.findMany({ where: and(eq(s.batches.hubId, hub.id), eq(s.batches.productId, kit.id), eq(s.batches.custodyState, "AVAILABLE_AT_HUB")) });
    expect(today.find((r) => r.hubId === hub.id && r.productId === kit.id)?.onHand).toBe(shelf.reduce((a, b) => a + b.quantity, 0));
  });

  it("a delivery locked as damaged is not counted as on the way: it is not coming until two admins resolve it", async () => {
    const { supplier, hub, disposable } = await ids();
    const rider = await userByPhone(SEED.riders[0]!.phone);
    const coming = async () => (await restockSuggestions(null, { hubId: hub.id })).find((r) => r.productId === disposable.id)!.onTheWay;
    ahead(60_000);
    const before = await coming();
    const { orderId: pickupId } = await adminCreatePickup(await actors.adminA(), { supplierId: supplier.id, productId: disposable.id, hubId: hub.id, riderId: rider.id, quantity: 20, pickupDate: tzDay() });
    await confirmBatchReady(await actors.supplier(), pickupId, "SEAL-ROAD-WET", { packedWaterproof: true });
    await acceptPickup(await actors.rider(), pickupId, { rainCover: true });
    await simulate("success", (await order(pickupId)).ref);
    await confirmRelease(await actors.supplier(), pickupId);
    await confirmReceipt(await actors.rider(), pickupId, CHECKS);
    const delivery = await latestOrderOfKind("RIDER_TO_HUB", pickupId);
    expect(await coming()).toBe(before + 20);
    const r = await reportProblem(await actors.rider(), { type: "DAMAGED_OR_WET", orderId: delivery.id, note: "Soaked crossing the river (test)" });
    expect(r.lockedBatch).toBe(true);
    expect(await coming()).toBe(before);
  });

  it("does not read days with an empty shelf as low demand, and counts what sellers are waiting for", async () => {
    const db = getDb();
    const { hub, kit } = await ids();
    // Fourteen recorded nights: ten found the shelf empty.
    for (let i = 0; i < WINDOW_DAYS; i++) {
      const day = tzDay(new Date(nowMs() - i * DAY));
      const onHand = i < 10 ? 0 : 20;
      await db.insert(s.hubStockDays).values({ hubId: hub.id, productId: kit.id, day, onHand, createdAt: now() }).onConflictDoUpdate({ target: [s.hubStockDays.hubId, s.hubStockDays.productId, s.hubStockDays.day], set: { onHand } });
    }
    const row = async () => (await restockSuggestions(null, { hubId: hub.id })).find((r) => r.productId === kit.id)!;
    const before = await row();
    expect(before.daysOutOfStock).toBe(10);

    // Sellers ask for everything the hub holds and has coming: owed units come off its position, so a pickup is now due.
    const asked = Math.min(500, Math.max(7, before.onHand + before.onTheWay));
    await requestStock(await actors.champion(), { productId: kit.id, quantity: asked });
    const after = await row();
    expect(after.waiting - before.waiting).toBe(asked);
    expect(after.reason).not.toBe("ok");
    expect(after.suggested).toBeGreaterThan(0);
  });
});
