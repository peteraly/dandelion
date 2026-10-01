/**
 * "Simulate one hour / one day" (Prompt B §2.5): generate a plausible slice of
 * new activity on the real clock through the real services, then run the jobs
 * a cron would run — previews have no crons. Non-production only, demo profile
 * only, rate-limited, logged.
 */
import { getDb } from "@/lib/db/client";
import { appEnv, simulatorEnabled } from "@/lib/env";
import { now, nowMs } from "@/lib/clock";
import { DomainError, getSetting, logAdminAction, putSetting } from "@/lib/services/core";
import { hitRateLimit } from "@/lib/security/rate-limit";
import { heartbeat } from "@/lib/security/cron";
import { enqueueStalePolls, runDueVerificationJobs } from "@/lib/payments/verification";
import { runDailyReconciliation } from "@/lib/services/reconciliation";
import { confirmSubmittedAnchors, runAnchor } from "@/lib/ledger/anchor";
import { Rng } from "./rng";
import { RealClock } from "./clock";
import { eatDayStart, isSunday } from "./time";
import { loadPlans, loadWorld } from "./load";
import { runDay, runHour, nightly } from "./day";
import { advanceLiveChains } from "./live";
import { tidyUp } from "./tidy";
import { passOnLateShopOrders } from "@/lib/services/shop";
import type { SkippedScenario } from "./manifest";

export type TickKind = "hour" | "day";

export interface TickResult {
  kind: TickKind;
  tick: number;
  seconds: number;
  counts: Record<string, number>;
  skipped: SkippedScenario[];
  jobs: { polled: number; verified: number; reconciled: boolean; anchor: string };
}

export async function demoStatus(): Promise<{ profile: string; scale: string; ticks: number; seed: string }> {
  return { profile: String(await getSetting("seedProfile")), scale: String(await getSetting("demoScale")), ticks: Number(await getSetting("demoTicks")), seed: String(await getSetting("demoSeed")) };
}

/** The live district (components/live-district.tsx) steps one hour every AUTO_PLAY_SECONDS while an admin watches; its own budget, so presenters' clicks still work. */
export const AUTO_PLAY_SECONDS = 60;

export async function simulateTick(kind: TickKind, adminId: string, opts: { auto?: boolean } = {}): Promise<TickResult> {
  if (appEnv() === "production" || !simulatorEnabled()) throw new DomainError("simulator_disabled");
  const status = await demoStatus();
  if (status.profile !== "demo") throw new DomainError("demo_profile_required");
  if (opts.auto && kind !== "hour") throw new DomainError("auto_play_hour_only");
  if (opts.auto) {
    // However many people watch, the district takes one live step a minute.
    const age = nowMs() - (Date.parse(String(await getSetting("demoLastLiveAt"))) || 0);
    if (age >= 0 && age < AUTO_PLAY_SECONDS * 800) throw new DomainError("live_recently_advanced");
    await putSetting(getDb(), "demoLastLiveAt", now().toISOString(), adminId);
  }
  const limit = opts.auto ? await hitRateLimit("demo:auto", 12, 600) : await hitRateLimit("demo:tick", 6, 600);
  if (!limit.allowed) throw new DomainError("rate_limited");

  const started = Date.now();
  const rng = new Rng(`${status.seed}:tick:${status.ticks}`);
  const w = await loadWorld(rng, new RealClock(), status.seed);
  const plans = await loadPlans(w);
  const customersPerDay = w.params.customers / (7 * w.params.weeks * 0.8);
  const today = eatDayStart(now());

  if (kind === "hour") {
    // A paid shop order not handed over in time passes to the next seller (Prompt M §3.1); runHour lets one take it.
    await passOnLateShopOrders();
    await runHour(w, plans, customersPerDay);
    // Deliveries move one step per hour so the map catches them on the way (lib/demo/live.ts).
    await advanceLiveChains(w);
    // Like a real team, the district handles what came up yesterday (Prompt M): the admin home stays short.
    await tidyUp(w);
  } else {
    await runDay(w, plans, { day: status.ticks + 1000, totalDays: 10_000, dayStart: today, sunday: isSunday(today), customersPerDay, adminSetPieces: false, peopleLifecycle: false, holdHandovers: false, leaveInFlightChains: false });
  }

  // What the crons would have done by now, done here; the heartbeat says so.
  const polled = await enqueueStalePolls();
  const verified = (await runDueVerificationJobs(50)).length;
  await heartbeat("poller", "ok (manual)", { enqueued: polled, ran: verified, source: "demo tick" });
  let reconciled = false;
  let anchor = "skipped";
  if (kind === "day") {
    await nightly(w, today);
    await heartbeat("reconciliation", "ok (manual)", { source: "demo tick" });
    reconciled = true;
    try {
      await confirmSubmittedAnchors();
      const r = await runAnchor();
      anchor = r.status;
      await heartbeat("anchor", r.status === "failed" ? "error" : "ok (manual)", { source: "demo tick", status: r.status });
    } catch (e) {
      anchor = `error: ${e instanceof Error ? e.message : String(e)}`;
    }
  }

  const tick = status.ticks + 1;
  await putSetting(getDb(), "demoTicks", tick, adminId);
  await logAdminAction(getDb(), adminId, "demo.tick", { type: "settings", id: "demoTicks" }, { kind, tick, auto: !!opts.auto, counts: w.manifest.counts, skipped: w.manifest.skipped.length });
  return { kind, tick, seconds: Math.round((Date.now() - started) / 1000), counts: w.manifest.counts, skipped: w.manifest.skipped, jobs: { polled, verified, reconciled, anchor } };
}
