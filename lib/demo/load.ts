/**
 * Rebuild a demo World from a populated database, for the in-app "simulate"
 * controls (Prompt B §2.5). Only active people take part; phones are
 * decrypted for the SMS-code lookups the flows need.
 */
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import { decryptString } from "@/lib/crypto/envelope";
import { getSetting } from "@/lib/services/core";
import { paidTotals } from "@/lib/services/payments";
import type { MinimalSeedResult } from "@/lib/seed-identities";
import type { DemoClock } from "./clock";
import type { Rng } from "./rng";
import { SCALES, World, type Area, type Hub, type Person, type Scale, type SupplierOrg } from "./world";
import type { Plan } from "./supply";

type UserRow = typeof s.users.$inferSelect;

async function person(u: UserRow): Promise<Person> {
  return { actor: { userId: u.id, role: u.role, hubId: u.hubId, supplierId: u.supplierId, mfa: false }, name: u.displayName, phone: await decryptString(u.phoneEnc), pin: "", payee: u.payeeAccount ?? "" };
}

export async function loadWorld(rng: Rng, clock: DemoClock, seedName: string): Promise<World> {
  const db = getDb();
  const scaleSetting = (await getSetting("demoScale")) as string;
  const scale: Scale = scaleSetting === "full" ? "full" : "small";
  const params = SCALES[scale];
  const active = eq(s.users.status, "ACTIVE");

  const admins = await db.query.users.findMany({ where: and(eq(s.users.role, "SUPER_ADMIN"), active), orderBy: s.users.createdAt, limit: 2 });
  if (admins.length < 2) throw new Error("two active admins are needed");
  const products = await db.query.products.findMany({ where: eq(s.products.active, true) });
  const kit = products.find((p) => p.category === "REUSABLE") ?? products[0]!;
  const disposable = products.find((p) => p.category === "DISPOSABLE") ?? products[0]!;

  const areaRows = await db.query.serviceAreas.findMany({ where: eq(s.serviceAreas.active, true), orderBy: s.serviceAreas.createdAt });
  const areas: Area[] = [];
  const phones: string[] = [];
  for (const a of areaRows) {
    const supplierRows = await db.query.suppliers.findMany({ where: and(eq(s.suppliers.serviceAreaId, a.id), eq(s.suppliers.active, true)), orderBy: s.suppliers.createdAt });
    const orgs: SupplierOrg[] = [];
    for (const row of supplierRows) {
      const users: Person[] = [];
      for (const u of await db.query.users.findMany({ where: and(eq(s.users.role, "SUPPLIER"), eq(s.users.supplierId, row.id), active), orderBy: s.users.createdAt })) {
        const p = await person(u);
        phones.push(p.phone);
        users.push(p);
      }
      if (!users.length) continue;
      // The first supplier of an area is the reliable one; the demo's occasional supplier has the longer lead time.
      orgs.push({ id: row.id, name: row.businessName, users, leadTimeDays: row.leadTimeDays, quality: orgs.length === 0 ? "good" : "poor" });
    }
    const primary = orgs[0];
    if (!primary) continue;
    const area: Area = { id: a.id, name: a.name, supplierId: primary.id, supplier: primary.users[0]!, suppliers: orgs, hubs: [] };
    for (const h of await db.query.hubs.findMany({ where: and(eq(s.hubs.serviceAreaId, a.id), eq(s.hubs.active, true)), orderBy: s.hubs.createdAt })) {
      const managerRow = await db.query.users.findFirst({ where: and(eq(s.users.role, "HUB_MANAGER"), eq(s.users.hubId, h.id), active) });
      if (!managerRow) continue;
      const manager = await person(managerRow);
      phones.push(manager.phone);
      const hub: Hub = { id: h.id, name: h.name, areaId: a.id, manager, champions: [], minStockUnits: h.minStockUnits };
      for (const c of await db.query.users.findMany({ where: and(eq(s.users.role, "FIELD_CHAMPION"), eq(s.users.hubId, h.id), active), orderBy: s.users.createdAt })) {
        const champion = await person(c);
        phones.push(champion.phone);
        hub.champions.push(champion);
      }
      area.hubs.push(hub);
    }
    areas.push(area);
  }
  if (!areas.length || !areas[0]!.hubs.length) throw new Error("no active area with a hub and a manager");

  const base: MinimalSeedResult = { areaId: areas[0]!.id, supplierId: areas[0]!.supplierId, hubId: areas[0]!.hubs[0]!.id, productIds: { kit: kit.id, disposable: disposable.id }, adminIds: [admins[0]!.id, admins[1]!.id] };
  const w = new World(rng, clock, scale, params, base, seedName);
  w.areas.push(...areas);
  for (const p of products) w.products.push({ id: p.id, name: p.name, category: p.category });
  for (const r of await db.query.users.findMany({ where: and(eq(s.users.role, "BOSS_RIDER"), active), orderBy: s.users.createdAt })) {
    const rider = await person(r);
    phones.push(rider.phone);
    w.riders.push(rider);
  }
  if (!w.riders.length) throw new Error("no active rider");
  const champions = new Map(w.champions.map((c) => [c.actor.userId, c]));
  for (const c of await db.query.customers.findMany({ where: and(eq(s.customers.status, "ACTIVE"), isNotNull(s.customers.phoneVerifiedAt)) })) {
    const champion = champions.get(c.championId);
    if (!champion) continue;
    const phone = await decryptString(c.phoneEnc);
    phones.push(phone);
    w.customers.push({ id: c.id, name: c.displayName, phone, champion });
  }
  w.names.reserveAbove(phones);
  return w;
}

/** Open customer plans as the generator sees them: what is still owed, split into one or two installments. */
export async function loadPlans(w: World): Promise<Plan[]> {
  const db = getDb();
  const orders = await db.query.orders.findMany({ where: and(eq(s.orders.kind, "CHAMPION_TO_CUSTOMER"), inArray(s.orders.state, ["PLAN_ACTIVE", "FULLY_PAID"])) });
  const plans: Plan[] = [];
  for (const o of orders) {
    const customer = w.customers.find((c) => c.id === o.customerId);
    const product = w.products.find((p) => p.id === o.productId);
    if (!customer || !product) continue;
    const t = await paidTotals(db, o);
    const installments: number[] = [];
    if (t.remainingTzs > 0) {
      const first = t.remainingTzs > 3000 && w.rng.chance(0.5) ? w.rng.roundTo(t.remainingTzs / 2, 500) : t.remainingTzs;
      installments.push(Math.min(first, t.remainingTzs));
      if (first < t.remainingTzs) installments.push(t.remainingTzs - first);
    }
    plans.push({ orderId: o.id, ref: o.ref, customer, product, totalTzs: o.totalTzs, paidTzs: o.totalTzs - t.remainingTzs, nextPaymentDay: installments.length ? 0 : null, installments, stalled: false, handedOver: false });
  }
  return plans;
}
