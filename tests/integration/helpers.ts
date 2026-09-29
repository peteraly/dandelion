import { and, desc, eq, sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import { phoneBlindIndex } from "@/lib/crypto/blind-index";
import type { Actor } from "@/lib/policy";
import { SEED } from "@/scripts/seed";

export async function userByPhone(phone: string) {
  const u = await getDb().query.users.findFirst({ where: eq(s.users.phoneIndex, phoneBlindIndex(phone)) });
  if (!u) throw new Error(`no user ${phone}`);
  return u;
}

export async function actorFor(phone: string, mfa = false): Promise<Actor> {
  const u = await userByPhone(phone);
  return { userId: u.id, role: u.role, hubId: u.hubId, supplierId: u.supplierId, mfa: u.role === "SUPER_ADMIN" ? true : mfa };
}

export const actors = {
  adminA: () => actorFor(SEED.adminA.phone),
  adminB: () => actorFor(SEED.adminB.phone),
  supplier: () => actorFor(SEED.supplier.phone),
  rider: () => actorFor(SEED.riders[0]!.phone),
  rider2: () => actorFor(SEED.riders[1]!.phone),
  hub: () => actorFor(SEED.hub.phone),
  champion: () => actorFor(SEED.champions[0]!.phone),
  champion2: () => actorFor(SEED.champions[1]!.phone),
};

export async function ids() {
  const db = getDb();
  const area = (await db.query.serviceAreas.findFirst())!;
  const supplier = (await db.query.suppliers.findFirst())!;
  const hub = (await db.query.hubs.findFirst())!;
  const kit = (await db.query.products.findFirst({ where: eq(s.products.category, "REUSABLE") }))!;
  const disposable = (await db.query.products.findFirst({ where: eq(s.products.category, "DISPOSABLE") }))!;
  return { area, supplier, hub, kit, disposable };
}

export async function order(id: string) {
  const o = await getDb().query.orders.findFirst({ where: eq(s.orders.id, id) });
  if (!o) throw new Error("order missing");
  return o;
}

export async function batch(id: string) {
  const b = await getDb().query.batches.findFirst({ where: eq(s.batches.id, id) });
  if (!b) throw new Error("batch missing");
  return b;
}

export async function latestOrderOfKind(kind: (typeof s.orderKindEnum.enumValues)[number], parentOrderId?: string) {
  const o = await getDb().query.orders.findFirst({
    where: parentOrderId ? and(eq(s.orders.kind, kind), eq(s.orders.parentOrderId, parentOrderId)) : eq(s.orders.kind, kind),
    orderBy: desc(s.orders.createdAt),
  });
  if (!o) throw new Error(`no ${kind} order`);
  return o;
}

export async function intentsFor(orderId: string) {
  return getDb().query.paymentIntents.findMany({ where: eq(s.paymentIntents.orderId, orderId), orderBy: s.paymentIntents.createdAt });
}

export async function lastSms(purpose?: string) {
  const rows = await getDb().query.smsOutbox.findMany({ where: purpose ? eq(s.smsOutbox.purpose, purpose) : undefined, orderBy: desc(s.smsOutbox.createdAt), limit: 1 });
  return rows[0];
}

export async function customerFor(championPhone: string) {
  const champ = await userByPhone(championPhone);
  const c = await getDb().query.customers.findFirst({ where: eq(s.customers.championId, champ.id) });
  if (!c) throw new Error("no customer");
  return c;
}

export async function ledgerCount(type?: (typeof s.ledgerEventTypeEnum.enumValues)[number]) {
  const [r] = await getDb()
    .select({ n: sql<number>`count(*)::int` })
    .from(s.ledgerEvents)
    .where(type ? eq(s.ledgerEvents.type, type) : undefined);
  return Number(r?.n ?? 0);
}

export async function securityEvents(type: string) {
  return getDb().query.securityEventLog.findMany({ where: eq(s.securityEventLog.type, type) });
}

/** Drizzle wraps driver errors as "Failed query: …" with the pg error in `cause`. */
export async function rejectsWithPg(p: Promise<unknown>, re: RegExp): Promise<void> {
  try {
    await p;
  } catch (e) {
    const err = e as { message?: string; cause?: { message?: string } };
    const msg = `${err.cause?.message ?? ""} ${err.message ?? ""}`;
    if (!re.test(msg)) throw new Error(`expected error matching ${re}, got: ${msg}`);
    return;
  }
  throw new Error(`expected rejection matching ${re}`);
}
