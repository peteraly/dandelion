/**
 * The generator's view of the world: reference data, people as `Actor`s the
 * services accept, the simulated clock, the PRNG and the manifest — plus the
 * small read helpers scenarios need (an order's ref, the last SMS code).
 * People are created the way the minimal seed creates them (direct inserts of
 * fake identities); everything that happens to them afterwards goes through
 * the services.
 */
import { and, desc, eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import type { Actor } from "@/lib/policy";
import type { OrganisationKind } from "@/lib/domain/types";
import { encryptString } from "@/lib/crypto/envelope";
import { phoneBlindIndex } from "@/lib/crypto/blind-index";
import { hashPin } from "@/lib/auth/secrets";
import { now } from "@/lib/clock";
import type { DemoClock } from "./clock";
import { SEED, type MinimalSeedResult } from "@/lib/seed-identities";
import { Rng } from "./rng";
import { Names } from "./names";
import { Manifest } from "./manifest";
import { MINUTE } from "./time";

export type Scale = "small" | "full";

export interface ScaleParams {
  areas: number;
  hubsPerArea: number[];
  ridersTotal: number;
  championsPerHub: number;
  customers: number;
  weeks: number;
  /** Rates (Prompt B §2.4). */
  stallRate: number;
  reviewRate: number;
  inspectionIssueRate: number;
  lockRate: number;
}

export const SCALES: Record<Scale, ScaleParams> = {
  small: { areas: 1, hubsPerArea: [2], ridersTotal: 2, championsPerHub: 3, customers: 40, weeks: 3, stallRate: 0.15, reviewRate: 0.05, inspectionIssueRate: 0.03, lockRate: 0.02 },
  full: { areas: 2, hubsPerArea: [2, 1], ridersTotal: 3, championsPerHub: 4, customers: 150, weeks: 6, stallRate: 0.15, reviewRate: 0.05, inspectionIssueRate: 0.03, lockRate: 0.02 },
};

export interface Person {
  actor: Actor;
  name: string;
  phone: string;
  pin: string;
  payee: string;
}

export interface Hub {
  id: string;
  name: string;
  areaId: string;
  manager: Person;
  champions: Person[];
  minStockUnits: number;
}

/** A supplier organisation in the demo: the reliable primary, or the occasional one whose batches carry most issues (Prompt B §8.5). */
export interface SupplierOrg {
  id: string;
  name: string;
  users: Person[];
  leadTimeDays: number;
  quality: "good" | "poor";
}

export interface Area {
  id: string;
  name: string;
  /** The primary supplier (kept for the scenarios that only need one). */
  supplierId: string;
  supplier: Person;
  suppliers: SupplierOrg[];
  hubs: Hub[];
}

/** A buyer organisation in the demo (prompt §8.8.4): a school or NGO that buys in bulk. */
export interface OrgBuyer {
  id: string;
  name: string;
  areaId: string;
  kind: OrganisationKind;
}

/** A pickup whose supplier confirms the batch late; the chain continues on `dueDay` (seed only). */
export interface DeferredPickup {
  pickupId: string;
  org: SupplierOrg;
  supplierUser: Person;
  hub: Hub;
  rider: Person;
  product: Product;
  outcome: "complete" | "in_transit" | "inspection_issue" | "damaged" | "awaiting_rider_payment";
  dueDay: number;
}

export interface Customer {
  id: string;
  name: string;
  phone: string;
  champion: Person;
}

export interface Product {
  id: string;
  name: string;
  category: "REUSABLE" | "DISPOSABLE";
}

export class World {
  readonly db = getDb();
  readonly names: Names;
  readonly admins: [Actor, Actor];
  readonly areas: Area[] = [];
  readonly riders: Person[] = [];
  readonly customers: Customer[] = [];
  readonly products: Product[] = [];
  readonly manifest: Manifest;
  /** Late supplier confirmations waiting for their day (only the backdated seed uses this; ticks never defer). */
  readonly deferred: DeferredPickup[] = [];
  /** May a supplier confirm a batch days late? The seed says yes; a real-clock tick cannot wait, so no. */
  allowLateBatches = false;
  /** Buyer organisations (prompt §8.8.4). */
  readonly organisations: OrgBuyer[] = [];
  /** People someone is playing right now in the field app (lib/demo/load.ts): the live engine never acts for them. */
  readonly busy = new Set<string>();
  /** Direct sale paths switched on in every area (the demo enables them all by dual approval). */
  directPaths = false;
  /** Working (non-Sunday) days so far; set pieces key on this, so a Sunday never silently drops one. */
  workingDay = 0;
  private readonly done = new Set<string>();

  /** True the first time a key is seen: for set pieces that must happen once, on the first day they can. */
  once(key: string): boolean {
    if (this.done.has(key)) return false;
    this.done.add(key);
    return true;
  }

  constructor(
    readonly rng: Rng,
    readonly clock: DemoClock,
    readonly scale: Scale,
    readonly params: ScaleParams,
    readonly base: MinimalSeedResult,
    seedName: string,
  ) {
    this.names = new Names(rng);
    this.admins = [
      { userId: base.adminIds[0], role: "SUPER_ADMIN", hubId: null, supplierId: null, mfa: true },
      { userId: base.adminIds[1], role: "SUPER_ADMIN", hubId: null, supplierId: null, mfa: true },
    ];
    this.manifest = new Manifest(seedName, scale, () => now());
  }

  get adminA(): Actor {
    return this.admins[0];
  }
  get adminB(): Actor {
    return this.admins[1];
  }
  get hubs(): Hub[] {
    return this.areas.flatMap((a) => a.hubs);
  }
  get champions(): Person[] {
    return this.hubs.flatMap((h) => h.champions);
  }
  get supplierOrgs(): SupplierOrg[] {
    return this.areas.flatMap((a) => a.suppliers);
  }

  /** Three pickups in four go to the reliable supplier; the rest to the occasional one. */
  pickSupplier(area: Area): SupplierOrg {
    const good = area.suppliers.filter((o) => o.quality === "good");
    const poor = area.suppliers.filter((o) => o.quality === "poor");
    if (!poor.length) return this.rng.pick(good.length ? good : area.suppliers);
    if (!good.length) return this.rng.pick(poor);
    return this.rng.chance(0.75) ? this.rng.pick(good) : this.rng.pick(poor);
  }

  /** Advance simulated time by a random number of minutes in [min, max]. */
  /** When set, ticks never run past this moment, so a busy simulated day cannot drift into the next one (or into the future). */
  dayEnd: Date | null = null;

  tick(minMinutes: number, maxMinutes = minMinutes): Date {
    const ms = this.rng.int(minMinutes, maxMinutes) * MINUTE + this.rng.int(0, 59) * 1000;
    if (this.dayEnd) {
      const room = this.dayEnd.getTime() - this.clock.now().getTime();
      if (room <= 0) return this.clock.now();
      return this.clock.advance(Math.min(ms, room));
    }
    return this.clock.advance(ms);
  }

  // ---------- creation of people (direct inserts, like the minimal seed) ----------

  async createFieldPerson(role: "SUPPLIER" | "BOSS_RIDER" | "HUB_MANAGER" | "FIELD_CHAMPION", opts: { areaId: string; hubId?: string; supplierId?: string; payee: string; name?: string; phone?: string }): Promise<Person> {
    const name = opts.name ?? this.names.person();
    const phone = opts.phone ?? this.names.fieldPhone();
    const pin = SEED.fieldPin;
    const hashed = await hashPin(pin);
    const [u] = await this.db
      .insert(s.users)
      .values({
        displayName: name,
        phoneEnc: await encryptString(phone),
        phoneIndex: phoneBlindIndex(phone),
        role,
        status: "ACTIVE",
        preferredLocale: this.rng.chance(0.8) ? "sw" : "en",
        serviceAreaId: opts.areaId,
        hubId: opts.hubId ?? null,
        supplierId: opts.supplierId ?? null,
        pinHash: hashed.hash,
        pinPepperVersion: hashed.pepperVersion,
        payoutProvider: this.rng.weighted([
          ["MPESA", 6],
          ["AIRTEL", 2],
          ["MIXX", 1],
          ["HALOPESA", 1],
        ] as const),
        payeeAccount: opts.payee,
        enrolledAt: now(),
        createdBy: this.adminA.userId,
      })
      .returning();
    await this.db.insert(s.trainingRecords).values({ userId: u!.id, module: "role_training_v1", agreementAccepted: true, recordedBy: this.adminA.userId });
    this.manifest.count(`people.${role}`);
    return { actor: { userId: u!.id, role, hubId: opts.hubId ?? null, supplierId: opts.supplierId ?? null, mfa: false }, name, phone, pin, payee: opts.payee };
  }

  async personFromUser(userId: string, phone: string, payee: string): Promise<Person> {
    const u = await this.db.query.users.findFirst({ where: eq(s.users.id, userId) });
    if (!u) throw new Error(`user ${userId} missing`);
    return { actor: { userId: u.id, role: u.role, hubId: u.hubId, supplierId: u.supplierId, mfa: false }, name: u.displayName, phone, pin: SEED.fieldPin, payee };
  }

  // ---------- read helpers ----------

  async order(orderId: string) {
    const o = await this.db.query.orders.findFirst({ where: eq(s.orders.id, orderId) });
    if (!o) throw new Error(`order ${orderId} missing`);
    return o;
  }

  async orderRef(orderId: string): Promise<string> {
    return (await this.order(orderId)).ref;
  }

  async deliveryOrderFor(pickupOrderId: string) {
    const o = await this.db.query.orders.findFirst({ where: and(eq(s.orders.kind, "RIDER_TO_HUB"), eq(s.orders.parentOrderId, pickupOrderId)) });
    if (!o) throw new Error(`no delivery order for pickup ${pickupOrderId}`);
    return o;
  }

  /** The most recent mock SMS to a phone for a purpose (the code lives in its body). */
  async lastSms(phone: string, purpose: string): Promise<string> {
    const rows = await this.db
      .select({ body: s.smsOutbox.body })
      .from(s.smsOutbox)
      .where(and(eq(s.smsOutbox.toIndex, phoneBlindIndex(phone)), eq(s.smsOutbox.purpose, purpose)))
      .orderBy(desc(s.smsOutbox.createdAt))
      .limit(1);
    if (!rows[0]) throw new Error(`no ${purpose} SMS for ${phone}`);
    return rows[0].body;
  }

  async lastSmsCode(phone: string, purpose: string): Promise<string> {
    const body = await this.lastSms(phone, purpose);
    const m = body.match(/\b(\d{6})\b/) ?? body.match(/\b(\d{4,8})\b/);
    if (!m) throw new Error(`no code in ${purpose} SMS`);
    return m[1]!;
  }

  async enrollTokenFromSms(phone: string): Promise<string> {
    const body = await this.lastSms(phone, "ENROLL_LINK");
    const m = body.match(/\/enroll\/([A-Za-z0-9_-]+)/);
    if (!m) throw new Error("no enrollment link in SMS");
    return m[1]!;
  }

  async exceptionIdByRef(ref: string): Promise<string> {
    const e = await this.db.query.exceptions.findFirst({ where: eq(s.exceptions.ref, ref) });
    if (!e) throw new Error(`exception ${ref} missing`);
    return e.id;
  }

  /** Units a champion currently holds for a product (batches WITH_CHAMPION). */
  async championStock(champion: Person, productId: string): Promise<number> {
    const rows = await this.db
      .select({ q: s.batches.quantity })
      .from(s.batches)
      .where(and(eq(s.batches.custodianUserId, champion.actor.userId), eq(s.batches.productId, productId), eq(s.batches.custodyState, "WITH_CHAMPION")));
    return rows.reduce((a, r) => a + r.q, 0);
  }

  /** Units a seller holds for a product in the state they sell from; a factory books no inventory here (registers at sale). */
  async sellerStock(seller: Person, productId: string): Promise<number> {
    if (seller.actor.role === "SUPPLIER") return Number.POSITIVE_INFINITY;
    const state = seller.actor.role === "BOSS_RIDER" ? "WITH_RIDER" : "WITH_CHAMPION";
    const rows = await this.db
      .select({ q: s.batches.quantity })
      .from(s.batches)
      .where(and(eq(s.batches.custodianUserId, seller.actor.userId), eq(s.batches.productId, productId), eq(s.batches.custodyState, state)));
    return rows.reduce((a, r) => a + r.q, 0);
  }

  async hubStock(hub: Hub, productId: string): Promise<number> {
    const rows = await this.db
      .select({ q: s.batches.quantity })
      .from(s.batches)
      .where(and(eq(s.batches.hubId, hub.id), eq(s.batches.productId, productId), eq(s.batches.custodyState, "AVAILABLE_AT_HUB")));
    return rows.reduce((a, r) => a + r.q, 0);
  }

  product(category?: "REUSABLE" | "DISPOSABLE"): Product {
    const pool = category ? this.products.filter((p) => p.category === category) : this.products;
    return this.rng.pick(pool);
  }
}
