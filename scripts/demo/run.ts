/**
 * Demo profile orchestrator (Prompt B §2). Lays down `weeks` of simulated
 * history day by day, in East Africa Time, through the real services, then
 * records the manifest. Requires an empty database, SIMULATOR_ENABLED=true
 * and valid seed credentials; never runs in production.
 */
import { eq, sql } from "drizzle-orm";
import * as s from "@/lib/db/schema";
import { appEnv, simulatorEnabled } from "@/lib/env";
import { SimulatedClock, setClock } from "@/lib/clock-override";
import { now } from "@/lib/clock";
import { runDailyReconciliation } from "@/lib/services/reconciliation";
import { putSetting } from "@/lib/services/core";
import { assertEmptyDatabase, assertSafeTargetDatabase, requireSeedCredentials, seed } from "../seed";
import { Rng } from "./rng";
import { addDays, atEat, eatDayStart, isSunday } from "./time";
import { FICTIONAL_PLACES } from "./names";
import { SCALES, World, type Hub, type Person, type Product, type Scale } from "./world";
import { claimWithoutPaying, deadJob, delayedPayment, enrolCustomer, handover, leaveInFlight, overpaymentWithRefund, payInstallment, pickupChain, restock, reviewPayment, reversedPayment, startCustomerPlan, type Plan } from "./supply";
import { adminDay, buildWorld, ensureExceptionCoverage, importStatementForLastWeek, peopleLifecycle, reportFieldProblems, resolveOpenExceptions, syncNotes } from "./admin";

function scaleFromEnv(): Scale {
  const v = process.env.DEMO_SCALE ?? "small";
  if (v !== "small" && v !== "full") throw new Error(`unknown DEMO_SCALE ${v}`);
  return v;
}

export interface DemoRunResult {
  seconds: number;
  counts: Record<string, number>;
  skipped: number;
}

export async function runDemoSeed(): Promise<DemoRunResult> {
  if (appEnv() === "production") throw new Error("demo seed refuses to run in production");
  if (!simulatorEnabled()) throw new Error("SEED_PROFILE=demo needs SIMULATOR_ENABLED=true (payments go through the mock provider's simulator)");
  await assertSafeTargetDatabase();
  await assertEmptyDatabase();
  requireSeedCredentials();

  const scale = scaleFromEnv();
  const params = SCALES[scale];
  const seedName = process.env.DEMO_SEED ?? "dandelion-2026";
  const rng = new Rng(seedName);
  const started = Date.now();

  // Simulated time starts `weeks` ago at 07:00 EAT and ends yesterday evening (real "today" is deliberately read here).
  const todayStart = eatDayStart(new Date());
  const firstDay = addDays(todayStart, -7 * params.weeks);
  const clock = new SimulatedClock(atEat(firstDay, 7, 0));
  clock.install();
  try {
    console.log(`[demo] scale=${scale} seed=${seedName} history ${firstDay.toISOString().slice(0, 10)} → ${addDays(todayStart, -1).toISOString().slice(0, 10)}`);
    const base = await seed();
    if (!base) throw new Error("minimal seed did not run (database not empty?)");
    const w = new World(rng, clock, scale, params, base, seedName);
    await buildWorld(w);

    const plans: Plan[] = [];
    const totalDays = 7 * params.weeks;
    const lastDay = totalDays - 1;
    const customersPerDay = params.customers / (totalDays * 0.8);

    for (let day = 0; day < totalDays; day++) {
      const dayStart = addDays(firstDay, day);
      const sunday = isSunday(dayStart);
      clock.advanceTo(atEat(dayStart, 7, rng.int(0, 30)));

      // Mornings: admin work and supply moves (quiet on Sundays).
      if (!sunday) {
        await adminDay(w, plans, day);
        await keepHubsStocked(w, day, lastDay);
      }

      // Daytime: champions restock and sell.
      clock.advanceTo(atEat(dayStart, sunday ? 14 : 10, rng.int(0, 40)));
      for (const hub of w.hubs) {
        for (const champion of hub.champions) {
          if (sunday && !rng.chance(0.2)) continue;
          await championDay(w, hub, champion, plans, day, customersPerDay);
        }
      }

      // Installments due today; handovers for fully paid plans (held on the last day so some stay pending).
      for (const p of plans) {
        if (p.handedOver) continue;
        if (p.nextPaymentDay !== null && p.nextPaymentDay <= day) {
          clock.advanceTo(atEat(dayStart, rng.int(9, 19), rng.int(0, 59)));
          try {
            await payInstallment(w, p, day);
          } catch (e) {
            w.manifest.skip("payInstallment", e);
            p.nextPaymentDay = day + 3;
          }
        } else if (p.nextPaymentDay === null && day !== lastDay) {
          clock.advanceTo(atEat(dayStart, rng.int(10, 18), rng.int(0, 59)));
          try {
            await handover(w, p);
          } catch (e) {
            w.manifest.skip("handover", e);
          }
        }
      }

      // Afternoons: problems, notes, people lifecycle, admin resolutions.
      if (!sunday) {
        clock.advanceTo(atEat(dayStart, 15, rng.int(0, 50)));
        await reportFieldProblems(w, plans, day);
        if (day === totalDays - 6 || day === lastDay) await ensureExceptionCoverage(w, plans);
        await syncNotes(w, day);
        await peopleLifecycle(w, day, totalDays);
        clock.advanceTo(atEat(dayStart, 17, rng.int(0, 40)));
        await resolveOpenExceptions(w, day, totalDays);
      }
      if (day === lastDay) {
        clock.advanceTo(atEat(dayStart, 18, 0));
        await leaveInFlight(w, plans);
      }

      // Nightly reconciliation at 20:00 EAT.
      clock.advanceTo(atEat(dayStart, 20, 0));
      await runDailyReconciliation();
      w.manifest.count("reconciliation.runs");
      if (day % 7 === 6) console.log(`[demo] week ${Math.floor(day / 7) + 1} done (${plans.length} plans, ${w.customers.length} customers, ${Math.round((Date.now() - started) / 1000)}s)`);
    }

    // The provider statement for the last simulated week, with deliberate differences.
    clock.advanceTo(atEat(todayStart, 6, 30));
    await importStatementForLastWeek(w, addDays(todayStart, -7), todayStart);

    const manifest = w.manifest.toJSON(atEat(firstDay, 7, 0), addDays(todayStart, -1), FICTIONAL_PLACES);
    await putSetting(w.db, "seedProfile", "demo", w.adminA.userId);
    await putSetting(w.db, "demoScale", scale, w.adminA.userId);
    await putSetting(w.db, "demoSeed", seedName, w.adminA.userId);
    await putSetting(w.db, "demoManifest", JSON.stringify(manifest), w.adminA.userId);

    const counts = await summary(w);
    const seconds = Math.round((Date.now() - started) / 1000);
    console.log(`[demo] done in ${seconds}s`);
    console.log(`[demo] ${JSON.stringify(counts)}`);
    if (w.manifest.skipped.length) console.log(`[demo] skipped scenarios: ${w.manifest.skipped.length} (see settings.demoManifest)`);
    return { seconds, counts, skipped: w.manifest.skipped.length };
  } finally {
    setClock(null);
  }
}

/** Pickups per product so every hub can serve every product; a few chains are left mid-way near the end. */
async function keepHubsStocked(w: World, day: number, lastDay: number): Promise<void> {
  const rng = w.rng;
  for (const hub of w.hubs) {
    for (const product of w.products) {
      const stock = await w.hubStock(hub, product.id);
      const low = stock < hub.minStockUnits * 2;
      if (!low && !rng.chance(0.05)) continue;
      const rider = rng.pick(w.riders);
      const qty = rng.int(40, 120);
      const outcome = day >= lastDay - 2 && rng.chance(0.3) ? "in_transit" : rng.chance(w.params.inspectionIssueRate) ? (rng.chance(0.5) ? "inspection_issue" : "damaged") : "complete";
      try {
        await pickupChain(w, hub, rider, product, qty, outcome);
      } catch (e) {
        w.manifest.skip(`pickupChain(${outcome})`, e);
      }
      w.tick(10, 40);
    }
  }
}

async function championDay(w: World, hub: Hub, champion: Person, plans: Plan[], day: number, customersPerDay: number): Promise<void> {
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
  const newCustomers = w.customers.length < w.params.customers && rng.chance(Math.min(0.9, customersPerDay / w.champions.length)) ? 1 : 0;
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

/** Reusables only where the area confirms WASH conditions; the first seeded area does, later ones do not. */
function pickProductForArea(w: World, hub: Hub): Product {
  const areaIndex = w.areas.findIndex((a) => a.id === hub.areaId);
  return areaIndex === 0 ? w.product() : w.product("DISPOSABLE");
}

async function summary(w: World): Promise<Record<string, number>> {
  const tables = { users: s.users, customers: s.customers, orders: s.orders, payment_intents: s.paymentIntents, exceptions: s.exceptions, approval_requests: s.approvalRequests, ledger_events: s.ledgerEvents, reconciliation_flags: s.reconciliationFlags, sms_outbox: s.smsOutbox } as const;
  const out: Record<string, number> = {};
  for (const [name, table] of Object.entries(tables)) {
    const [r] = await w.db.select({ n: sql<number>`count(*)::int` }).from(table);
    out[name] = Number(r?.n ?? 0);
  }
  const [verified] = await w.db.select({ n: sql<number>`count(*)::int` }).from(s.customers).where(eq(s.customers.status, "ACTIVE"));
  out.customers_active = Number(verified?.n ?? 0);
  out.simulated_end_utc_hour = now().getUTCHours();
  return out;
}
