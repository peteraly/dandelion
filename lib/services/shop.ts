/**
 * The shop (Prompt L §3): girls, women and anyone else can join with their phone — like a delivery app — and ask for a
 * pack at a public meeting point in their area. A delivery partner in that area who holds the product accepts the
 * request; from then on it is an ordinary plan: she pays Dandelion's collection account by mobile money with the
 * order's reference, and the hand-over at the meeting point is confirmed with the code she receives by SMS.
 *
 * Joining is safe to try with any number: the answer never says whether a phone already has an account (a household
 * member must not be able to find out who buys here). Names only, never an address; places are named public places.
 */
import { now, nowMs } from "@/lib/clock";
import { and, desc, eq, gte, inArray, isNotNull, isNull, lt, ne, or, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb, type DbOrTx, type Tx } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import { encryptString, decryptString } from "@/lib/crypto/envelope";
import { phoneBlindIndex } from "@/lib/crypto/blind-index";
import { humanCode } from "@/lib/crypto/random";
import { normalizeTzPhone, TzPhoneSchema } from "@/lib/phone";
import { FAKE_PHONE_RE } from "@/lib/seed-identities";
import { authorize, type Actor } from "@/lib/policy";
import { issueOtp, consumeOtp } from "@/lib/auth/otp";
import { createCustomerSession } from "@/lib/auth/customer-session";
import { getSmsProvider } from "@/lib/sms";
import { tr } from "@/lib/i18n/server-translator";
import { firstName } from "@/lib/util/names";
import { formatTzs } from "@/lib/money";
import { DomainError, getSetting, logSecurityEvent, recordLedgerEvent, SYSTEM, withTx, isUniqueViolation } from "./core";
import { allowedSalesFor } from "./areas";
import { activePriceItem } from "./pricing";
import { applyOrder, createPlanInTx, lockOrder } from "./orders";
import { lockBatch, returnToParent } from "./custody";
import { openIntent, paidTotals } from "./payments";
import { PRIVACY_NOTICE_VERSION } from "./customers";

/** An unanswered request lapses after two days, so nobody waits on a request no one will take. */
export const SHOP_REQUEST_HOURS = 48;
const OPEN_PLAN_STATES = ["PLAN_ACTIVE", "FULLY_PAID", "HANDOVER_PENDING"] as const;

export interface ShopProduct {
  id: string;
  name: string;
  category: string;
  unitDescription: string;
  priceTzs: number;
}

export interface ShopPlace {
  id: string;
  name: string;
  /** When someone is usually there ("Thursdays 10:00–12:00, market day"), or null. */
  when: string | null;
}

export interface ShopArea {
  id: string;
  name: string;
  region: string;
  places: ShopPlace[];
  products: ShopProduct[];
  /** Delivery partners may take orders here (the area's "delivery partner → customer" switch); local sellers always may. */
  ridersSell: boolean;
}

/**
 * Areas where the shop is open: a named public place, a product with a price, and someone who can take orders —
 * a woman local seller at one of the area's hubs (always allowed: it is the handbook ladder), or delivery partners
 * where two admins switched that on.
 */
export async function shopAreas(db: DbOrTx = getDb()): Promise<ShopArea[]> {
  const areas = await db.query.serviceAreas.findMany({ where: eq(s.serviceAreas.active, true), orderBy: s.serviceAreas.name });
  const out: ShopArea[] = [];
  for (const a of areas) {
    const ridersSell = (await allowedSalesFor(db, a.id)).includes("RIDER_TO_CUSTOMER");
    const [sellers] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(s.users)
      .innerJoin(s.hubs, eq(s.hubs.id, s.users.hubId))
      .where(and(eq(s.users.role, "FIELD_CHAMPION"), eq(s.users.status, "ACTIVE"), eq(s.hubs.serviceAreaId, a.id), eq(s.hubs.active, true)));
    if (!ridersSell && !Number(sellers?.n ?? 0)) continue;
    const places = await db.query.meetingPoints.findMany({ where: and(eq(s.meetingPoints.serviceAreaId, a.id), eq(s.meetingPoints.active, true)), orderBy: s.meetingPoints.name });
    if (!places.length) continue;
    const products = await areaProducts(db, a.id);
    if (!products.length) continue;
    out.push({ id: a.id, name: a.name, region: a.region, places: places.map((p) => ({ id: p.id, name: p.name, when: p.whenText })), products, ridersSell });
  }
  return out;
}

/** What is on sale in an area, at the area's one customer price; reusables only where washing conditions are confirmed (§11). */
async function areaProducts(db: DbOrTx, serviceAreaId: string): Promise<ShopProduct[]> {
  const rows = await db
    .select({ p: s.products, avail: s.productAreaAvailability })
    .from(s.productAreaAvailability)
    .innerJoin(s.products, eq(s.products.id, s.productAreaAvailability.productId))
    .where(and(eq(s.productAreaAvailability.serviceAreaId, serviceAreaId), eq(s.productAreaAvailability.available, true), eq(s.products.active, true)))
    .orderBy(s.products.name);
  const out: ShopProduct[] = [];
  for (const r of rows) {
    if (r.p.category === "REUSABLE" && !r.avail.washConditionsConfirmed) continue;
    try {
      const item = await activePriceItem(db, { serviceAreaId, productId: r.p.id });
      out.push({ id: r.p.id, name: r.p.name, category: r.p.category, unitDescription: r.p.unitDescription, priceTzs: item.customerPriceTzs });
    } catch {
      // No agreed price yet: not on sale here.
    }
  }
  return out;
}

async function openPlace(db: DbOrTx, meetingPointId: string): Promise<{ place: typeof s.meetingPoints.$inferSelect; area: ShopArea }> {
  const place = await db.query.meetingPoints.findFirst({ where: eq(s.meetingPoints.id, meetingPointId) });
  if (!place?.active) throw new DomainError("meeting_point_unavailable");
  const area = (await shopAreas(db)).find((a) => a.id === place.serviceAreaId);
  if (!area) throw new DomainError("shop_closed_here");
  return { place, area };
}

// ---------- joining and signing in ----------

export const JoinSchema = z
  .object({
    displayName: z.string().trim().min(1).max(60),
    phone: TzPhoneSchema,
    meetingPointId: z.uuid(),
    consentMessages: z.literal(true, { error: "consent_required" }),
    consentReminders: z.boolean(),
  })
  .strict();

interface SignInOpts {
  deviceId: string | null;
  ip: string | null;
  /** The open demo stores only fictional numbers (ADR-025). */
  openDemo: boolean;
}

function assertDemoPhone(phone: string, opts: SignInOpts): void {
  if (opts.openDemo && !FAKE_PHONE_RE.test(normalizeTzPhone(phone) ?? phone)) throw new DomainError("open_demo_fake_phone");
}

/**
 * Join the shop. A new number gets an account waiting for its code; a number that already has one simply gets a
 * sign-in code — the screen that follows is the same either way. Details on an account that never confirmed its
 * code are replaced by the latest join (only the phone's owner can confirm it).
 */
export async function joinShop(raw: z.input<typeof JoinSchema>, opts: SignInOpts): Promise<{ challengeId: string }> {
  const input = JoinSchema.parse(raw);
  assertDemoPhone(input.phone, opts);
  const db = getDb();
  const { place } = await openPlace(db, input.meetingPointId);
  const phoneIndex = phoneBlindIndex(input.phone);
  const consents = (customerId: string) => [
    { customerId, kind: "TRANSACTION_MESSAGES" as const, granted: true, noticeVersion: PRIVACY_NOTICE_VERSION, recordedBy: null },
    { customerId, kind: "REMINDERS" as const, granted: input.consentReminders, noticeVersion: PRIVACY_NOTICE_VERSION, recordedBy: null },
  ];
  const customerId = await withTx(async (tx) => {
    const existing = await tx.query.customers.findFirst({ where: eq(s.customers.phoneIndex, phoneIndex) });
    if (existing) {
      if (existing.status === "ACTIVE" && !existing.phoneVerifiedAt && existing.selfRegistered) {
        await tx
          .update(s.customers)
          .set({ displayName: input.displayName, serviceAreaId: place.serviceAreaId, meetingPointId: place.id, updatedAt: now() })
          .where(eq(s.customers.id, existing.id));
        await tx.insert(s.consentRecords).values(consents(existing.id));
      }
      return existing.status === "ACTIVE" ? existing.id : null;
    }
    const [c] = await tx
      .insert(s.customers)
      .values({
        championId: null,
        selfRegistered: true,
        displayName: input.displayName,
        phoneEnc: await encryptString(input.phone),
        phoneIndex,
        serviceAreaId: place.serviceAreaId,
        meetingPointId: place.id,
      })
      .returning({ id: s.customers.id });
    await tx.insert(s.consentRecords).values(consents(c!.id));
    return c!.id;
  }).catch(async (e) => {
    // Two joins for one number at once: the other one made the account.
    if (!isUniqueViolation(e)) throw e;
    return (await db.query.customers.findFirst({ where: eq(s.customers.phoneIndex, phoneIndex) }))?.id ?? null;
  });
  return sendSignInCode(input.phone, phoneIndex, customerId, opts);
}

/** Sign in with a phone. A number without an account gets no SMS, and the screen that follows looks the same. */
export async function startShopSignIn(phoneRaw: string, opts: SignInOpts): Promise<{ challengeId: string }> {
  const phone = TzPhoneSchema.parse(phoneRaw);
  assertDemoPhone(phone, opts);
  const phoneIndex = phoneBlindIndex(phone);
  const c = await getDb().query.customers.findFirst({ where: and(eq(s.customers.phoneIndex, phoneIndex), eq(s.customers.status, "ACTIVE")) });
  return sendSignInCode(phone, phoneIndex, c?.id ?? null, opts);
}

/**
 * A cap on shop sign-in codes across the district (founders, 2026-10-01: 100 an hour, an alarm at 50): nobody can make
 * Dandelion send thousands of SMS. Counted for every code asked for, with or without an account, so the cap reveals
 * nothing about who has joined.
 */
async function assertCodeCapacity(): Promise<void> {
  const db = getDb();
  const hourAgo = new Date(nowMs() - 3_600_000);
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(s.otpChallenges)
    .where(and(eq(s.otpChallenges.purpose, "CUSTOMER_LOGIN"), gte(s.otpChallenges.createdAt, hourAgo)));
  const n = Number(row?.n ?? 0);
  if (n >= Number(await getSetting("shopCodeSmsPerHour"))) throw new DomainError("shop_busy");
  if (n + 1 >= Number(await getSetting("shopCodeSmsAlarm"))) {
    const raised = await db.query.securityEventLog.findFirst({ where: and(eq(s.securityEventLog.type, "SHOP_CODE_SURGE"), gte(s.securityEventLog.createdAt, hourAgo)), columns: { id: true } });
    if (!raised) await logSecurityEvent(db, "SHOP_CODE_SURGE", "ALERT", { details: { lastHour: n + 1 } });
  }
}

async function sendSignInCode(phone: string, phoneIndex: string, customerId: string | null, opts: SignInOpts): Promise<{ challengeId: string }> {
  await assertCodeCapacity();
  return withTx(async (tx) => {
    const { challengeId, code } = await issueOtp({ purpose: "CUSTOMER_LOGIN", phoneIndex, subjectId: customerId, deviceId: opts.deviceId, ip: opts.ip }, tx);
    if (customerId) await getSmsProvider().send(phone, tr("sw", "sms.otp", { code }), "OTP", tx);
    return { challengeId };
  });
}

/** Confirm the code: the phone is hers, and she is signed in to the shop. */
export async function finishShopSignIn(challengeId: string, code: string): Promise<{ customerId: string; token: string; expiresAt: Date }> {
  if (!z.uuid().safeParse(challengeId).success) throw new DomainError("otp_invalid");
  const db = getDb();
  const ch = await db.query.otpChallenges.findFirst({ where: and(eq(s.otpChallenges.id, challengeId), eq(s.otpChallenges.purpose, "CUSTOMER_LOGIN")) });
  if (!ch) throw new DomainError("otp_invalid");
  // Consumed outside any transaction so a wrong code still counts against the attempt limit.
  const ok = await consumeOtp({ challengeId, purpose: "CUSTOMER_LOGIN", subjectId: ch.subjectId, code });
  if (!ok || !ch.subjectId) throw new DomainError("otp_invalid");
  const c = await db.query.customers.findFirst({ where: eq(s.customers.id, ch.subjectId) });
  if (!c || c.status !== "ACTIVE" || c.phoneIndex !== ch.phoneIndex) throw new DomainError("otp_invalid");
  return withTx(async (tx) => {
    if (!c.phoneVerifiedAt) await tx.update(s.customers).set({ phoneVerifiedAt: now(), updatedAt: now() }).where(eq(s.customers.id, c.id));
    const session = await createCustomerSession(c.id, tx);
    return { customerId: c.id, ...session };
  });
}

/** Open demo only: the code the mock SMS carried for this challenge, so a visitor can try the shop without a phone. */
export async function demoCodeFor(challengeId: string): Promise<string | null> {
  if (!z.uuid().safeParse(challengeId).success) return null;
  const db = getDb();
  const ch = await db.query.otpChallenges.findFirst({ where: and(eq(s.otpChallenges.id, challengeId), eq(s.otpChallenges.purpose, "CUSTOMER_LOGIN")) });
  if (!ch?.subjectId) return null;
  const sms = await db.query.smsOutbox.findFirst({
    where: and(eq(s.smsOutbox.toIndex, ch.phoneIndex), eq(s.smsOutbox.purpose, "OTP"), gte(s.smsOutbox.createdAt, new Date(ch.createdAt.getTime() - 5_000))),
    orderBy: desc(s.smsOutbox.createdAt),
  });
  return sms?.body.match(/\b(\d{6})\b/)?.[1] ?? null;
}

// ---------- ordering ----------

/**
 * Requests nobody accepted in time lapse (checked whenever the shop or a delivery partner looks). One that carried her
 * payment from a late seller lapses the same way, and her money is given back: that is money going out, so the system
 * opens the refund for the admins and tells her by SMS — nobody has to notice it.
 */
export async function expireShopRequests(): Promise<number> {
  const cutoff = new Date(nowMs() - SHOP_REQUEST_HOURS * 3_600_000);
  return withTx(async (tx) => {
    const rows = await tx
      .update(s.customerRequests)
      .set({ state: "EXPIRED", updatedAt: now() })
      .where(and(eq(s.customerRequests.state, "OPEN"), lt(s.customerRequests.createdAt, cutoff)))
      .returning();
    for (const r of rows.filter((x) => x.carriedTzs > 0)) await refundCarried(tx, r, "nobody could take it in time", "sms.carriedRefund");
    return rows.length;
  });
}

/** Her carried payment goes back to her: a refund case for the admins (only admins move money out) and one SMS. */
async function refundCarried(tx: Tx, r: typeof s.customerRequests.$inferSelect, why: string, sms: "sms.carriedRefund" | "sms.cancelledRefund"): Promise<void> {
  await tx.insert(s.exceptions).values({ ref: `EX-${humanCode(6)}`, type: "REFUND_REQUEST", orderId: r.carriedFromOrderId, reportedBySystem: true, note: `[shop] ${r.ref}: ${why}; refund ${r.carriedTzs} TZS` });
  const c = await tx.query.customers.findFirst({ where: eq(s.customers.id, r.customerId) });
  if (c?.status === "ACTIVE") {
    await getSmsProvider().send(await decryptString(c.phoneEnc), tr("sw", sms, { name: firstName(c.displayName), ref: r.ref, amount: formatTzs(r.carriedTzs, "sw") }), "SHOP_REQUEST", tx);
  }
}

// ---------- late orders pass to the next seller (Prompt M §3.1, founders 2026-10-01) ----------

/**
 * A shop order must be handed over within `shopHandoverHours` of her full payment. Half-way, the seller is reminded.
 * At the deadline it passes on by itself: the late seller's order is cancelled (a pack set aside goes back to his
 * stock), her order reopens to the other sellers in her area — never to him — and her payment follows it to the next
 * seller's order, recorded once and for ever. He earns nothing from it and is asked later in future. Runs whenever the
 * shop, a seller's list or the admin's shop page is opened, every live-demo minute and every night.
 */
export async function passOnLateShopOrders(): Promise<{ reminded: number; passed: number }> {
  const hours = Number(await getSetting("shopHandoverHours"));
  if (hours <= 0) return { reminded: 0, passed: 0 };
  const db = getDb();
  const rows = await db
    .select({ o: s.orders, r: s.customerRequests })
    .from(s.orders)
    .innerJoin(s.customerRequests, eq(s.customerRequests.orderId, s.orders.id))
    .where(and(inArray(s.orders.state, ["FULLY_PAID", "HANDOVER_PENDING"]), isNotNull(s.orders.fullyPaidAt)))
    .limit(200);
  let reminded = 0;
  let passed = 0;
  for (const { o, r } of rows) {
    const due = o.fullyPaidAt!.getTime() + hours * 3_600_000;
    if (nowMs() >= due) {
      // One order that cannot pass on (its stock is held in a problem) never stops the others.
      if (await passOn(o.id, r).catch((e: unknown) => (e instanceof DomainError ? false : Promise.reject(e)))) passed++;
    } else if (!o.dueReminderAt && nowMs() >= due - (hours * 3_600_000) / 2) {
      await withTx(async (tx) => {
        const marked = await tx.update(s.orders).set({ dueReminderAt: now() }).where(and(eq(s.orders.id, o.id), isNull(s.orders.dueReminderAt)));
        if (!marked.rowCount) return;
        const seller = await tx.query.users.findFirst({ where: eq(s.users.id, o.sellerUserId) });
        if (seller) {
          const when = formatDue(new Date(due), seller.preferredLocale);
          await getSmsProvider().send(await decryptString(seller.phoneEnc), tr(seller.preferredLocale, "sms.handoverDue", { name: firstName(seller.displayName), ref: o.ref, due: when }), "NOTICE", tx);
        }
        reminded++;
      });
    }
  }
  return { reminded, passed };
}

function formatDue(d: Date, locale: string): string {
  return new Intl.DateTimeFormat(locale === "sw" ? "sw-TZ" : "en-GB", { weekday: "short", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Dar_es_Salaam" }).format(d);
}

/** When a shop order's hand-over is due, or null before she has paid in full. */
export async function handoverDueAt(order: Pick<typeof s.orders.$inferSelect, "fullyPaidAt" | "state">): Promise<Date | null> {
  if (!order.fullyPaidAt || !["FULLY_PAID", "HANDOVER_PENDING"].includes(order.state)) return null;
  const hours = Number(await getSetting("shopHandoverHours"));
  return hours > 0 ? new Date(order.fullyPaidAt.getTime() + hours * 3_600_000) : null;
}

async function passOn(orderId: string, r: typeof s.customerRequests.$inferSelect): Promise<boolean> {
  return withTx(async (tx) => {
    const order = await lockOrder(tx, orderId);
    if (order.state !== "FULLY_PAID" && order.state !== "HANDOVER_PENDING") return false; // handed over or handled meanwhile
    if (order.state === "HANDOVER_PENDING" && order.batchId) {
      const child = await lockBatch(tx, order.batchId);
      if (child.custodyState === "RESERVED_FOR_CUSTOMER") await returnToParent(tx, SYSTEM, child, "CANCEL_CUSTOMER_RESERVATION", { orderHasConfirmedPayment: true }, order.id);
    }
    const paid = await paidTotals(tx, order);
    // Only money in Dandelion's account can follow the order. Money paid straight to the late seller (the seller-collects
    // route) stays with him: the admins get it back for her.
    const [direct] = await tx
      .select({ n: sql<number>`coalesce(sum(${s.paymentIntents.confirmedAmountTzs}), 0)::int` })
      .from(s.paymentIntents)
      .where(and(eq(s.paymentIntents.orderId, order.id), eq(s.paymentIntents.status, "PAYMENT_CONFIRMED"), eq(s.paymentIntents.collectedByPlatform, false)));
    const sellerHeld = Number(direct?.n ?? 0);
    const carried = Math.max(0, paid.confirmedTzs - sellerHeld);
    await applyOrder(tx, order, "REASSIGN", SYSTEM, {});
    const ref = await uniqueRequestRef(tx);
    await tx.insert(s.customerRequests).values({
      ref,
      customerId: r.customerId,
      serviceAreaId: r.serviceAreaId,
      meetingPointId: r.meetingPointId,
      productId: r.productId,
      womenOnly: r.womenOnly,
      carriedFromOrderId: order.id,
      carriedTzs: carried,
      excludedSellerId: order.sellerUserId,
    });
    if (sellerHeld > 0) {
      await tx.insert(s.exceptions).values({ ref: `EX-${humanCode(6)}`, type: "REFUND_REQUEST", orderId: order.id, reportedBySystem: true, note: `[shop] ${order.ref} passed on late; ${sellerHeld} TZS was paid straight to the late seller: get it back to her` });
    }
    if (paid.donorTzs > 0) {
      await tx.insert(s.exceptions).values({ ref: `EX-${humanCode(6)}`, type: "OTHER", orderId: order.id, reportedBySystem: true, note: `Donor funding of ${paid.donorTzs} TZS was on an order that passed to another seller (${ref}): apply it again` });
    }
    await recordLedgerEvent(tx, { type: "ORDER_REASSIGNED", subjectRef: order.ref, orderId: order.id, amountTzs: carried, role: "SYSTEM" });
    // Both are told; neither SMS names the product.
    const seller = await tx.query.users.findFirst({ where: eq(s.users.id, order.sellerUserId) });
    if (seller) await getSmsProvider().send(await decryptString(seller.phoneEnc), tr(seller.preferredLocale, "sms.passedOnSeller", { name: firstName(seller.displayName), ref: order.ref }), "NOTICE", tx);
    const c = (await tx.query.customers.findFirst({ where: eq(s.customers.id, r.customerId) }))!;
    await getSmsProvider().send(await decryptString(c.phoneEnc), tr("sw", "sms.passedOnCustomer", { name: firstName(c.displayName), ref: order.ref, amount: formatTzs(carried, "sw") }), "SHOP_REQUEST", tx);
    const place = (await tx.query.meetingPoints.findFirst({ where: eq(s.meetingPoints.id, r.meetingPointId) }))!;
    const area = (await shopAreas(tx)).find((a) => a.id === r.serviceAreaId);
    if (area) await alertSellers(tx, { ref, productId: r.productId, womenOnly: r.womenOnly, place, area, exclude: order.sellerUserId });
    return true;
  });
}

export const ShopRequestSchema = z.object({ productId: z.uuid(), meetingPointId: z.uuid(), womenOnly: z.boolean().default(false) }).strict();

/**
 * Ask for one pack at a meeting point. One order at a time: an open request or a plan not yet handed over. The sellers
 * in her area who hold it are told by SMS (as many as settings.shopAlertSellers), so a request is answered quickly.
 */
export async function requestOrder(customer: { id: string }, raw: z.input<typeof ShopRequestSchema>): Promise<{ requestId: string; ref: string }> {
  const input = ShopRequestSchema.parse(raw);
  await expireShopRequests();
  return withTx(async (tx) => {
    // One request at a time per customer, even with two taps at once.
    await tx.execute(sql`select id from customers where id = ${customer.id} for update`);
    const c = await tx.query.customers.findFirst({ where: eq(s.customers.id, customer.id) });
    if (!c || c.status !== "ACTIVE" || !c.phoneVerifiedAt) throw new DomainError("not_found");
    const open = await tx.query.customerRequests.findFirst({ where: and(eq(s.customerRequests.customerId, c.id), eq(s.customerRequests.state, "OPEN")) });
    const plan = await tx.query.orders.findFirst({ where: and(eq(s.orders.customerId, c.id), inArray(s.orders.state, [...OPEN_PLAN_STATES])), columns: { id: true } });
    if (open || plan) throw new DomainError("shop_order_open");
    const { place, area } = await openPlace(tx, input.meetingPointId);
    if (!area.products.some((p) => p.id === input.productId)) throw new DomainError("product_unavailable");
    const ref = await uniqueRequestRef(tx);
    // Where delivery partners do not sell, only local sellers see the request anyway.
    const womenOnly = input.womenOnly && area.ridersSell;
    const [row] = await tx
      .insert(s.customerRequests)
      .values({ ref, customerId: c.id, serviceAreaId: area.id, meetingPointId: place.id, productId: input.productId, womenOnly })
      .returning({ id: s.customerRequests.id });
    // Her usual place, offered first next time.
    await tx.update(s.customers).set({ serviceAreaId: area.id, meetingPointId: place.id, updatedAt: now() }).where(eq(s.customers.id, c.id));
    await alertSellers(tx, { ref, productId: input.productId, womenOnly, place, area });
    return { requestId: row!.id, ref };
  });
}

/** The sellers who could take this order now: in the area, holding the product, most stock first. */
async function sellersFor(db: DbOrTx, q: { serviceAreaId: string; productId: string; womenOnly: boolean; ridersSell: boolean }) {
  const held = sql<number>`coalesce(sum(${s.batches.quantity}), 0)::int`;
  const champions = await db
    .select({ id: s.users.id, displayName: s.users.displayName, phoneEnc: s.users.phoneEnc, locale: s.users.preferredLocale, held })
    .from(s.users)
    .innerJoin(s.hubs, eq(s.hubs.id, s.users.hubId))
    .innerJoin(s.batches, and(eq(s.batches.custodianUserId, s.users.id), eq(s.batches.custodyState, "WITH_CHAMPION"), eq(s.batches.productId, q.productId)))
    .where(and(eq(s.users.role, "FIELD_CHAMPION"), eq(s.users.status, "ACTIVE"), eq(s.hubs.serviceAreaId, q.serviceAreaId)))
    .groupBy(s.users.id);
  const riders =
    q.ridersSell && !q.womenOnly
      ? await db
          .select({ id: s.users.id, displayName: s.users.displayName, phoneEnc: s.users.phoneEnc, locale: s.users.preferredLocale, held })
          .from(s.users)
          .innerJoin(s.batches, and(eq(s.batches.custodianUserId, s.users.id), eq(s.batches.custodyState, "WITH_RIDER"), eq(s.batches.productId, q.productId)))
          .where(and(eq(s.users.role, "BOSS_RIDER"), eq(s.users.status, "ACTIVE"), eq(s.users.serviceAreaId, q.serviceAreaId)))
          .groupBy(s.users.id)
      : [];
  // Sellers who kept their promises are asked first (Prompt M §3.1): fewest orders passed on from them in 90 days,
  // then the most stock.
  const since = new Date(nowMs() - 90 * 86_400_000);
  const lateRows = await db
    .select({ id: s.customerRequests.excludedSellerId, n: sql<number>`count(*)::int` })
    .from(s.customerRequests)
    .where(and(isNotNull(s.customerRequests.excludedSellerId), gte(s.customerRequests.createdAt, since)))
    .groupBy(s.customerRequests.excludedSellerId);
  const late = new Map(lateRows.map((x) => [x.id, Number(x.n)]));
  return [...champions, ...riders]
    .filter((x) => Number(x.held) > 0)
    .sort((a, b) => (late.get(a.id) ?? 0) - (late.get(b.id) ?? 0) || Number(b.held) - Number(a.held));
}

async function alertSellers(tx: Tx, r: { ref: string; productId: string; womenOnly: boolean; place: typeof s.meetingPoints.$inferSelect; area: ShopArea; exclude?: string }): Promise<void> {
  const max = Number(await getSetting("shopAlertSellers", tx));
  if (max <= 0) return;
  const sellers = (await sellersFor(tx, { serviceAreaId: r.area.id, productId: r.productId, womenOnly: r.womenOnly, ridersSell: r.area.ridersSell })).filter((x) => x.id !== r.exclude);
  for (const seller of sellers.slice(0, max)) {
    // Never the product's name, and never the customer's: the phone may be shared.
    const body = tr(seller.locale, "sms.shopAlert", { name: firstName(seller.displayName), ref: r.ref, place: r.place.name });
    await getSmsProvider().send(await decryptString(seller.phoneEnc), body, "SHOP_ALERT", tx);
  }
}

async function uniqueRequestRef(tx: Tx): Promise<string> {
  for (let i = 0; i < 6; i++) {
    const ref = `RQ-${humanCode(6)}`;
    if (!(await tx.query.customerRequests.findFirst({ where: eq(s.customerRequests.ref, ref), columns: { id: true } }))) return ref;
  }
  throw new Error("could not allocate request reference");
}

/** Her usual meeting point (and so her area) — chosen when she joined, changed whenever she likes. */
export async function setShopPlace(customer: { id: string }, meetingPointId: string): Promise<void> {
  if (!z.uuid().safeParse(meetingPointId).success) throw new DomainError("meeting_point_unavailable");
  const { place } = await openPlace(getDb(), meetingPointId);
  await getDb().update(s.customers).set({ serviceAreaId: place.serviceAreaId, meetingPointId: place.id, updatedAt: now() }).where(eq(s.customers.id, customer.id));
}

export async function cancelShopRequest(customer: { id: string }, requestId: string): Promise<void> {
  if (!z.uuid().safeParse(requestId).success) throw new DomainError("not_found");
  await withTx(async (tx) => {
    const rows = await tx
      .update(s.customerRequests)
      .set({ state: "CANCELLED", updatedAt: now() })
      .where(and(eq(s.customerRequests.id, requestId), eq(s.customerRequests.customerId, customer.id), eq(s.customerRequests.state, "OPEN")))
      .returning();
    if (!rows.length) throw new DomainError("request_not_open");
    // Her payment was carried in it: it goes back to her.
    if (rows[0]!.carriedTzs > 0) await refundCarried(tx, rows[0]!, "she cancelled", "sms.cancelledRefund");
  });
}

export interface ShopOrderRow {
  id: string;
  ref: string;
  state: (typeof s.customerRequests.$inferSelect)["state"];
  createdAt: Date;
  productName: string;
  placeName: string;
  placeWhen: string | null;
  productId: string;
  meetingPointId: string;
  womenOnly: boolean;
  /** Her payment came with this order from one that passed on. */
  carriedTzs: number;
  /** This order was not handed over in time and passed to another seller. */
  passedOn: boolean;
  /** When the seller must hand over by (after full payment). */
  dueAt: Date | null;
  sellerName: string | null;
  order: null | {
    state: string;
    totalTzs: number;
    paidTzs: number;
    remainingTzs: number;
    paymentRef: string;
    payee: string | null;
  };
}

/** Her shop page: her area's places and products, and her orders with what to pay and where to meet. */
export async function shopHome(customer: ShopCustomerLike) {
  await expireShopRequests();
  await passOnLateShopOrders();
  const db = getDb();
  const areas = await shopAreas(db);
  const home = areas.find((a) => a.id === customer.serviceAreaId) ?? null;
  const requests = await db.query.customerRequests.findMany({ where: eq(s.customerRequests.customerId, customer.id), orderBy: desc(s.customerRequests.createdAt), limit: 20 });
  const rows: ShopOrderRow[] = [];
  for (const r of requests) {
    const product = await db.query.products.findFirst({ where: eq(s.products.id, r.productId), columns: { name: true } });
    const place = await db.query.meetingPoints.findFirst({ where: eq(s.meetingPoints.id, r.meetingPointId), columns: { name: true, whenText: true } });
    const seller = r.acceptedBy ? await db.query.users.findFirst({ where: eq(s.users.id, r.acceptedBy), columns: { displayName: true } }) : undefined;
    let order: ShopOrderRow["order"] = null;
    let passedOn = false;
    let dueAt: Date | null = null;
    if (r.orderId) {
      const o = (await db.query.orders.findFirst({ where: eq(s.orders.id, r.orderId) }))!;
      passedOn = o.state === "CANCELLED" && !!(await db.query.customerRequests.findFirst({ where: eq(s.customerRequests.carriedFromOrderId, o.id), columns: { id: true } }));
      dueAt = await handoverDueAt(o);
      const t = await paidTotals(db, o);
      const intent = await openIntent(db, o.id);
      order = { state: o.state, totalTzs: o.totalTzs, paidTzs: t.confirmedTzs, remainingTzs: t.remainingTzs, paymentRef: o.paymentRef, payee: intent?.payeeAccount ?? null };
    }
    rows.push({
      id: r.id,
      ref: r.ref,
      state: r.state,
      createdAt: r.createdAt,
      productName: product?.name ?? "",
      placeName: place?.name ?? "",
      placeWhen: place?.whenText ?? null,
      productId: r.productId,
      meetingPointId: r.meetingPointId,
      womenOnly: r.womenOnly,
      carriedTzs: r.carriedTzs,
      passedOn,
      dueAt,
      sellerName: seller ? firstName(seller.displayName) : null,
      order,
    });
  }
  const busy = rows.some((r) => r.state === "OPEN" || (r.order && OPEN_PLAN_STATES.includes(r.order.state as (typeof OPEN_PLAN_STATES)[number])));
  return { areas, home, orders: rows, canOrder: !busy && areas.length > 0, reminders: await remindersOn(db, customer.id), helpline: String(await getSetting("helplineText", db)) };
}

type ShopCustomerLike = Pick<typeof s.customers.$inferSelect, "id" | "serviceAreaId" | "meetingPointId">;

// ---------- sellers: delivery partners and women local sellers ----------

/**
 * Where a seller takes shop orders, and whether they may: a local seller at her hub's area (always — it is the
 * handbook ladder); a delivery partner in his own area, where two admins switched that on.
 */
async function sellerShopArea(db: DbOrTx, actor: Actor): Promise<string | null> {
  if (actor.role === "FIELD_CHAMPION") {
    const hub = actor.hubId ? await db.query.hubs.findFirst({ where: eq(s.hubs.id, actor.hubId) }) : undefined;
    return hub?.active ? hub.serviceAreaId : null;
  }
  const me = await db.query.users.findFirst({ where: eq(s.users.id, actor.userId), columns: { serviceAreaId: true } });
  if (!me?.serviceAreaId || !(await allowedSalesFor(db, me.serviceAreaId)).includes("RIDER_TO_CUSTOMER")) return null;
  return me.serviceAreaId;
}

/**
 * Open shop requests in a seller's area, grouped by meeting point (so one trip on market day serves several), with
 * whether they hold the product. Delivery partners never see a request she asked a woman local seller to bring.
 */
export async function openRequestsFor(actor: Actor) {
  authorize(actor, "order.accept_request");
  await expireShopRequests();
  await passOnLateShopOrders();
  const db = getDb();
  const areaId = await sellerShopArea(db, actor);
  if (!areaId) return [];
  const rows = await db
    .select({ r: s.customerRequests, product: s.products.name, place: s.meetingPoints.name, when: s.meetingPoints.whenText, customer: s.customers.displayName })
    .from(s.customerRequests)
    .innerJoin(s.products, eq(s.products.id, s.customerRequests.productId))
    .innerJoin(s.meetingPoints, eq(s.meetingPoints.id, s.customerRequests.meetingPointId))
    .innerJoin(s.customers, eq(s.customers.id, s.customerRequests.customerId))
    .where(
      and(
        eq(s.customerRequests.state, "OPEN"),
        eq(s.customerRequests.serviceAreaId, areaId),
        actor.role === "FIELD_CHAMPION" ? sql`true` : eq(s.customerRequests.womenOnly, false),
        or(isNull(s.customerRequests.excludedSellerId), ne(s.customerRequests.excludedSellerId, actor.userId)),
      ),
    )
    .orderBy(s.meetingPoints.name, s.customerRequests.createdAt)
    .limit(30);
  const held = await heldBy(db, actor);
  return rows.map((x) => ({
    id: x.r.id,
    ref: x.r.ref,
    createdAt: x.r.createdAt,
    productName: x.product,
    placeName: x.place,
    placeWhen: x.when,
    womenOnly: x.r.womenOnly,
    carriedTzs: x.r.carriedTzs,
    customerName: firstName(x.customer),
    inStock: (held.get(x.r.productId) ?? 0) > 0,
  }));
}

/** What a seller holds, by product: a local seller's own stock, a delivery partner's stock on the road. */
async function heldBy(db: DbOrTx, actor: Pick<Actor, "userId" | "role">): Promise<Map<string, number>> {
  const rows = await db
    .select({ productId: s.batches.productId, n: sql<number>`coalesce(sum(${s.batches.quantity}), 0)::int` })
    .from(s.batches)
    .where(and(eq(s.batches.custodianUserId, actor.userId), eq(s.batches.custodyState, actor.role === "FIELD_CHAMPION" ? "WITH_CHAMPION" : "WITH_RIDER")))
    .groupBy(s.batches.productId);
  return new Map(rows.map((r) => [r.productId, Number(r.n)]));
}

/**
 * A seller takes a request: it must be open, in their area, they must hold the product, and a request for a woman
 * local seller goes to one. The sale becomes an ordinary plan with them as the seller; she is told who is coming,
 * where, and how to pay.
 */
export async function acceptCustomerRequest(actor: Actor, requestId: string): Promise<{ orderId: string }> {
  authorize(actor, "order.accept_request");
  if (!z.uuid().safeParse(requestId).success) throw new DomainError("not_found");
  return withTx(async (tx) => {
    const [r] = await tx.select().from(s.customerRequests).where(eq(s.customerRequests.id, requestId)).for("update");
    if (!r) throw new DomainError("not_found");
    if (r.state !== "OPEN") throw new DomainError(r.state === "ACCEPTED" ? "request_taken" : "request_not_open");
    if (r.createdAt.getTime() < nowMs() - SHOP_REQUEST_HOURS * 3_600_000) throw new DomainError("request_not_open");
    if (r.womenOnly && actor.role !== "FIELD_CHAMPION") throw new DomainError("request_women_only");
    if (r.excludedSellerId === actor.userId) throw new DomainError("request_passed_on");
    if ((await sellerShopArea(tx, actor)) !== r.serviceAreaId) throw new DomainError("request_other_area");
    if (!((await heldBy(tx, actor)).get(r.productId) ?? 0)) throw new DomainError("request_no_stock");
    const me = (await tx.query.users.findFirst({ where: eq(s.users.id, actor.userId) }))!;
    const customer = await tx.query.customers.findFirst({ where: eq(s.customers.id, r.customerId) });
    if (!customer || customer.status !== "ACTIVE" || !customer.phoneVerifiedAt) throw new DomainError("not_found");
    const place = (await tx.query.meetingPoints.findFirst({ where: eq(s.meetingPoints.id, r.meetingPointId) }))!;
    // One SMS: who is coming, where, the price and how to pay.
    const carried = r.carriedFromOrderId && r.carriedTzs > 0 ? { fromOrderId: r.carriedFromOrderId, amountTzs: r.carriedTzs } : undefined;
    const { orderId } = await createPlanInTx(tx, actor, customer, r.productId, { ref: r.ref, seller: firstName(me.displayName), place: place.name, carried });
    await tx.update(s.customerRequests).set({ state: "ACCEPTED", acceptedBy: actor.userId, acceptedAt: now(), orderId, updatedAt: now() }).where(eq(s.customerRequests.id, r.id));
    return { orderId };
  });
}

// ---------- safety ----------

async function alertSafeguardingLeads(tx: Tx, ref: string, r: typeof s.customerRequests.$inferSelect): Promise<void> {
  const phones = String(await getSetting("safeguardingLeadPhones", tx))
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
  if (!phones.length) return;
  const c = (await tx.query.customers.findFirst({ where: eq(s.customers.id, r.customerId) }))!;
  const area = await tx.query.serviceAreas.findFirst({ where: eq(s.serviceAreas.id, r.serviceAreaId), columns: { name: true } });
  const place = await tx.query.meetingPoints.findFirst({ where: eq(s.meetingPoints.id, r.meetingPointId), columns: { name: true } });
  const body = tr("sw", "sms.safeguarding", { ref, name: firstName(c.displayName), phone: await decryptString(c.phoneEnc), area: area?.name ?? "", place: place?.name ?? "" });
  for (const phone of phones) await getSmsProvider().send(phone, body, "SAFEGUARDING", tx);
}

/** Her latest choice about monthly reminders (she can change it in the shop at any time). */
export async function remindersOn(db: DbOrTx, customerId: string): Promise<boolean> {
  const row = await db.query.consentRecords.findFirst({
    where: and(eq(s.consentRecords.customerId, customerId), eq(s.consentRecords.kind, "REMINDERS")),
    orderBy: desc(s.consentRecords.createdAt),
  });
  return row?.granted ?? false;
}

/** Switch monthly reminders on or off: a new consent record, so the history of her choices is kept. */
export async function setShopReminders(customer: { id: string }, on: boolean): Promise<void> {
  await getDb().insert(s.consentRecords).values({ customerId: customer.id, kind: "REMINDERS", granted: on, noticeVersion: PRIVACY_NOTICE_VERSION, recordedBy: null });
}

export const ShopReportSchema = z
  .object({
    requestId: z.uuid(),
    category: z.enum(["unsafe", "money", "other"]),
    note: z.string().trim().max(500).default(""),
  })
  .strict();

const REPORT_TYPE = { unsafe: "SAFETY_CONCERN", money: "WRONG_AMOUNT", other: "OTHER" } as const;

/**
 * She tells Dandelion something went wrong with an accepted order — she felt unsafe, she was asked for more money or
 * cash, or anything else. It goes to the admins' problems inbox, never to the seller. At most three a day.
 */
export async function reportShopProblem(customer: { id: string }, raw: z.input<typeof ShopReportSchema>): Promise<{ ref: string }> {
  const input = ShopReportSchema.parse(raw);
  return withTx(async (tx) => {
    const r = await tx.query.customerRequests.findFirst({ where: and(eq(s.customerRequests.id, input.requestId), eq(s.customerRequests.customerId, customer.id)) });
    if (!r?.orderId) throw new DomainError("not_found");
    const [recent] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(s.exceptions)
      .innerJoin(s.customerRequests, eq(s.customerRequests.orderId, s.exceptions.orderId))
      .where(and(eq(s.customerRequests.customerId, customer.id), sql`${s.exceptions.note} like '[shop]%'`, gte(s.exceptions.createdAt, new Date(nowMs() - 24 * 3_600_000))));
    if (Number(recent?.n ?? 0) >= 3) throw new DomainError("rate_limited");
    const ref = `EX-${humanCode(6)}`;
    await tx.insert(s.exceptions).values({ ref, type: REPORT_TYPE[input.category], orderId: r.orderId, reportedBy: null, note: `[shop] ${r.ref}: ${input.note || "—"}`.slice(0, 600) });
    // A customer who felt unsafe: the safeguarding leads are texted at once, with what they need to call her back.
    if (input.category === "unsafe") await alertSafeguardingLeads(tx, ref, r);
    return { ref };
  });
}

/** The shop request behind a plan, for the delivery partner's order page (where to meet). */
export async function shopRequestForOrder(db: DbOrTx, orderId: string): Promise<{ ref: string; placeName: string; placeWhen: string | null; dueAt: Date | null } | null> {
  const rows = await db
    .select({ ref: s.customerRequests.ref, placeName: s.meetingPoints.name, placeWhen: s.meetingPoints.whenText, fullyPaidAt: s.orders.fullyPaidAt, state: s.orders.state })
    .from(s.customerRequests)
    .innerJoin(s.meetingPoints, eq(s.meetingPoints.id, s.customerRequests.meetingPointId))
    .innerJoin(s.orders, eq(s.orders.id, s.customerRequests.orderId))
    .where(eq(s.customerRequests.orderId, orderId))
    .limit(1);
  const r = rows[0];
  return r ? { ref: r.ref, placeName: r.placeName, placeWhen: r.placeWhen, dueAt: await handoverDueAt(r) } : null;
}
