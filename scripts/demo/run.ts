/**
 * Demo profile orchestrator (Prompt B §2). Lays down `weeks` of simulated
 * history day by day, in East Africa Time, through the real services, then
 * records the manifest. Requires an empty database, SIMULATOR_ENABLED=true
 * and valid seed credentials; never runs in production.
 *
 * This is the only place the clock override is used (lib/clock-override.ts,
 * scripts and tests only); the in-app "simulate" controls reuse lib/demo/day.ts
 * on the real clock.
 */
import { appEnv, simulatorEnabled } from "@/lib/env";
import { SimulatedClock, setClock } from "@/lib/clock-override";
import { putSetting } from "@/lib/services/core";
import { assertEmptyDatabase, assertSafeTargetDatabase, requireSeedCredentials, seed } from "@/scripts/seed";
import { Rng } from "@/lib/demo/rng";
import { addDays, atEat, eatDayStart, isSunday } from "@/lib/demo/time";
import { FICTIONAL_PLACES } from "@/lib/demo/names";
import { SCALES, World, type Scale } from "@/lib/demo/world";
import { leaveInFlight, type Plan } from "@/lib/demo/supply";
import { buildWorld, importStatementForLastWeek } from "@/lib/demo/admin";
import { nightly, runDay, summary } from "@/lib/demo/day";
import { advanceLiveChains } from "@/lib/demo/live";
import { payoutsRound } from "@/lib/demo/payouts";

/** Live steps run once the history is in, so the first visitor finds deliveries already under way. */
const LIVE_WARM_UP_HOURS = 6;

/** DEMO_SCALE when set; a preview gets the full district (two areas, three hubs, 150 customers, six weeks, 250+ orders). */
function scaleFromEnv(): Scale {
  const v = process.env.DEMO_SCALE || (appEnv() === "preview" ? "full" : "small");
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
    w.allowLateBatches = true; // the backdated seed can wait two days; a real-clock tick cannot
    await buildWorld(w);

    const plans: Plan[] = [];
    const totalDays = 7 * params.weeks;
    const lastDay = totalDays - 1;
    const customersPerDay = params.customers / (totalDays * 0.8);

    for (let day = 0; day < totalDays; day++) {
      const dayStart = addDays(firstDay, day);
      await runDay(w, plans, {
        day,
        totalDays,
        dayStart,
        sunday: isSunday(dayStart),
        customersPerDay,
        adminSetPieces: true,
        peopleLifecycle: true,
        holdHandovers: day === lastDay,
        leaveInFlightChains: day >= lastDay - 2,
      });
      if (day === lastDay) {
        clock.advanceTo(atEat(dayStart, 18, 0));
        await leaveInFlight(w, plans);
        // Members withdraw part of their balances; two admins send most, one is turned down, two wait (Prompt L §2).
        clock.advanceTo(atEat(dayStart, 18, 45));
        await payoutsRound(w);
      }
      await nightly(w, dayStart);
      if (day % 7 === 6) console.log(`[demo] week ${Math.floor(day / 7) + 1} done (${plans.length} plans, ${w.customers.length} customers, ${Math.round((Date.now() - started) / 1000)}s)`);
    }

    // The provider statement for the last simulated week, with deliberate differences.
    clock.advanceTo(atEat(todayStart, 6, 30));
    await importStatementForLastWeek(w, addDays(todayStart, -7), todayStart);

    // The district is running when the preview opens: back on the real clock, a few hours of live steps put deliveries
    // at the factory, on the road and at the hubs, and an organisation's order on its way (lib/demo/live.ts).
    setClock(null);
    for (let i = 0; i < LIVE_WARM_UP_HOURS; i++) await advanceLiveChains(w);

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
