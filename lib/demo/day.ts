/**
 * One simulated day, as phases the seed (backdated, SimulatedClock) and the
 * in-app "simulate" controls (real clock) share. Every phase drives the real
 * services; the clock only decides what timestamps they get.
 */
import { eq, sql } from "drizzle-orm";
import * as s from "@/lib/db/schema";
import { now } from "@/lib/clock";
import { runDailyReconciliation } from "@/lib/services/reconciliation";
import { atEat } from "./time";
import type { Hub, Person, Product, World } from "./world";
import { claimWithoutPaying, deadJob, delayedPayment, enrolCustomer, handover, overpaymentWithRefund, payInstallment, pickupChain, restock, reviewPayment, reversedPayment, startCustomerPlan, type Plan } from "./supply";
import { adminDay, ensureExceptionCoverage, peopleLifecycle, reportFieldProblems, resolveOpenExceptions, syncNotes } from "./admin";

export interface DayOptions {
  /** Index of the day within the run (drives the set-piece admin scenarios). */
  day: number;
  totalDays: number;
  /** 00:00 EAT of the day; a real-clock run passes the current day and the slots become no-ops. */
  dayStart: Date;
  sunday: boolean;
  customersPerDay: number;
  /** Set-piece admin scenarios (price lists, donor funding …) — the seed runs them, ticks do not. */
  adminSetPieces: boolean;
  /** Invitations, lockouts, suspensions — the seed runs them on fixed days, ticks do not. */
  peopleLifecycle: boolean;
  /** Hold handovers so some plans stay FULLY_PAID (the seed's last day). */
  holdHandovers: boolean;
  /** Leave chains mid-way (the seed's last days). */
  leaveInFlightChains: boolean;
}

/** Pickups per product so every hub can serve every product; a few chains are left mid-way when asked. */
export async function keepHubsStocked(w: World, opts: Pick<DayOptions, "leaveInFlightChains">): Promise<void> {
  const rng = w.rng;
  for (const hub of w.hubs) {
    for (const product of w.products) {
      const stock = await w.hubStock(hub, product.id);
      const low = stock < hub.minStockUnits * 2;
      if (!low && !rng.chance(0.05)) continue;
      const rider = rng.pick(w.riders);
      const qty = rng.int(40, 120);
      const outcome = opts.leaveInFlightChains && rng.chance(0.3) ? "in_transit" : rng.chance(w.params.inspectionIssueRate) ? (rng.chance(0.5) ? "inspection_issue" : "damaged") : "complete";
      try {
        await pickupChain(w, hub, rider, product, qty, outcome);
      } catch (e) {
        w.manifest.skip(`pickupChain(${outcome})`, e);
      }
      w.tick(10, 40);
    }
  }
}

/** Reusables only where the area confirms WASH conditions; the first seeded area does, later ones do not. */
export function pickProductForArea(w: World, hub: Hub): Product {
  const areaIndex = w.areas.findIndex((a) => a.id === hub.areaId);
  return areaIndex === 0 ? w.product() : w.product("DISPOSABLE");
}

export async function championDay(w: World, hub: Hub, champion: Person, plans: Plan[], day: number, customersPerDay: number): Promise<void> {
  const rng = w.rng;
  // Restock when the champion holds less than the plans still waiting for a product (plus a small buffer).
  for (const product of w.products) {
    const stock = await w.championStock(champion, product.id);
    const waiting = plans.filter((p) => p.customer.champion === champion && p.product.id === product.id && !p.handedOver).length;
    const need = waiting + 2 - stock;
    if (need <= 0 || !(stock < 3 || need > 3)) continue;
    if ((await w.hubStock(hub, product.id)) < need) continue;
    w.tick(5, 40);
    const scenario = rng.chance(w.params.reviewRate) ? rng.pick(["wrong_amount", "wrong_payee"] as const) : "success";
    try {
      const orderId = await restock(w, hub, champion, product, Math.max(5, Math.min(15, need + 3)), scenario);
      if (orderId && scenario !== "success") w.manifest.anomaly(scenario === "wrong_amount" ? "WRONG_AMOUNT" : "PAYEE_MISMATCH", `champion's restock payment: ${scenario}`, { orderRef: await w.orderRef(orderId) });
    } catch (e) {
      w.manifest.skip(`restock(${scenario})`, e);
    }
  }
  // New customers and plans.
  const newCustomers = w.customers.length < w.params.customers && rng.chance(Math.min(0.9, customersPerDay / Math.max(1, w.champions.length))) ? 1 : 0;
  for (let i = 0; i < newCustomers; i++) {
    w.tick(10, 90);
    try {
      const c = await enrolCustomer(w, champion);
      const product = pickProductForArea(w, hub);
      w.tick(5, 30);
      const plan = await startCustomerPlan(w, c, product, day);
      plans.push(plan);
      // Deliberate payment deviations on a few plans.
      const roll = rng.next();
      if (roll < 0.03) await overpaymentWithRefund(w, plan);
      else if (roll < 0.05) await reviewPayment(w, plan.orderId, "wrong_payee", plan.installments[0]);
      else if (roll < 0.07) await delayedPayment(w, plan.orderId);
      else if (roll < 0.085) await reversedPayment(w, plan.orderId);
      else if (roll < 0.095) await deadJob(w, plan.orderId);
      else if (roll < 0.105) await reviewPayment(w, plan.orderId, "duplicate", plan.installments[0]);
      else if (roll < 0.115) await reviewPayment(w, plan.orderId, "bad_signature", plan.installments[0]);
      else if (roll < 0.125) await reviewPayment(w, plan.orderId, "replay", plan.installments[0]);
      else if (roll < 0.135) {
        // Pending too long: the customer says "paying" but nothing arrives for days.
        await claimWithoutPaying(w, plan);
        plan.nextPaymentDay = day + rng.int(4, 8);
      }
    } catch (e) {
      w.manifest.skip("enrolCustomer/startPlan", e);
    }
  }
}

/** Installments due today; handovers for fully paid plans unless held. */
export async function installmentsAndHandovers(w: World, plans: Plan[], opts: Pick<DayOptions, "day" | "dayStart" | "holdHandovers">): Promise<void> {
  const rng = w.rng;
  for (const p of plans) {
    if (p.handedOver) continue;
    if (p.nextPaymentDay !== null && p.nextPaymentDay <= opts.day) {
      w.clock.advanceTo(atEat(opts.dayStart, rng.int(9, 19), rng.int(0, 59)));
      try {
        await payInstallment(w, p, opts.day);
      } catch (e) {
        w.manifest.skip("payInstallment", e);
        p.nextPaymentDay = opts.day + 3;
      }
    } else if (p.nextPaymentDay === null && !opts.holdHandovers) {
      w.clock.advanceTo(atEat(opts.dayStart, rng.int(10, 18), rng.int(0, 59)));
      try {
        await handover(w, p);
      } catch (e) {
        w.manifest.skip("handover", e);
      }
    }
  }
}

/** A whole day: mornings for admin and supply, daytime for sales, afternoons for problems, 20:00 reconciliation. */
export async function runDay(w: World, plans: Plan[], opts: DayOptions): Promise<void> {
  const rng = w.rng;
  const { dayStart, sunday, day } = opts;
  w.clock.advanceTo(atEat(dayStart, 7, rng.int(0, 30)));
  if (!sunday) {
    if (opts.adminSetPieces) await adminDay(w, plans, day);
    await keepHubsStocked(w, opts);
  }
  w.clock.advanceTo(atEat(dayStart, sunday ? 14 : 10, rng.int(0, 40)));
  for (const hub of w.hubs) {
    for (const champion of hub.champions) {
      if (sunday && !rng.chance(0.2)) continue;
      await championDay(w, hub, champion, plans, day, opts.customersPerDay);
    }
  }
  await installmentsAndHandovers(w, plans, opts);
  if (!sunday) {
    w.clock.advanceTo(atEat(dayStart, 15, rng.int(0, 50)));
    await reportFieldProblems(w, plans, day);
    if (opts.adminSetPieces && (day === opts.totalDays - 6 || day === opts.totalDays - 1)) await ensureExceptionCoverage(w, plans);
    await syncNotes(w, day);
    if (opts.peopleLifecycle) await peopleLifecycle(w, day, opts.totalDays);
    w.clock.advanceTo(atEat(dayStart, 17, rng.int(0, 40)));
    await resolveOpenExceptions(w, day, opts.totalDays);
  }
}

/** The nightly reconciliation at 20:00 EAT (the seed) or right now (a tick). */
export async function nightly(w: World, dayStart: Date): Promise<void> {
  w.clock.advanceTo(atEat(dayStart, 20, 0));
  await runDailyReconciliation();
  w.manifest.count("reconciliation.runs");
}

/**
 * A slice of a day for the "simulate one hour" control: some hubs restock,
 * a third of the champions sell, a quarter of the open plans pay, a few
 * problems get reported.
 */
export async function runHour(w: World, plans: Plan[], customersPerDay: number): Promise<void> {
  const rng = w.rng;
  if (rng.chance(0.3)) await keepHubsStocked(w, { leaveInFlightChains: false });
  for (const hub of w.hubs) {
    for (const champion of hub.champions) {
      if (!rng.chance(0.35)) continue;
      await championDay(w, hub, champion, plans, 0, customersPerDay / 8);
    }
  }
  for (const p of plans) if (!p.handedOver && p.nextPaymentDay !== null) p.nextPaymentDay = rng.chance(0.25) ? 0 : 1;
  await installmentsAndHandovers(w, plans, { day: 0, dayStart: now(), holdHandovers: false });
  if (rng.chance(0.4)) await reportFieldProblems(w, plans, 0);
  if (rng.chance(0.5)) await resolveOpenExceptions(w, 0, 100);
}

export async function summary(w: World): Promise<Record<string, number>> {
  const tables = { users: s.users, customers: s.customers, orders: s.orders, payment_intents: s.paymentIntents, exceptions: s.exceptions, approval_requests: s.approvalRequests, ledger_events: s.ledgerEvents, reconciliation_flags: s.reconciliationFlags, sms_outbox: s.smsOutbox } as const;
  const out: Record<string, number> = {};
  for (const [name, table] of Object.entries(tables)) {
    const [r] = await w.db.select({ n: sql<number>`count(*)::int` }).from(table);
    out[name] = Number(r?.n ?? 0);
  }
  const [verified] = await w.db.select({ n: sql<number>`count(*)::int` }).from(s.customers).where(eq(s.customers.status, "ACTIVE"));
  out.customers_active = Number(verified?.n ?? 0);
  return out;
}
