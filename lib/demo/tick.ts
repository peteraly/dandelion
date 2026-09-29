/**
 * "Simulate one hour / one day" (Prompt B §2.5): generate a plausible slice of
 * new activity on the real clock through the real services, then run the jobs
 * a cron would run — previews have no crons. Non-production only, demo profile
 * only, rate-limited, logged.
 */
import { getDb } from "@/lib/db/client";
import { appEnv, simulatorEnabled } from "@/lib/env";
import { now } from "@/lib/clock";
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

export async function simulateTick(kind: TickKind, adminId: string): Promise<TickResult> {
  if (appEnv() === "production" || !simulatorEnabled()) throw new DomainError("simulator_disabled");
  const status = await demoStatus();
  if (status.profile !== "demo") throw new DomainError("demo_profile_required");
  const limit = await hitRateLimit("demo:tick", 6, 600);
  if (!limit.allowed) throw new DomainError("rate_limited");

  const started = Date.now();
  const rng = new Rng(`${status.seed}:tick:${status.ticks}`);
  const w = await loadWorld(rng, new RealClock(), status.seed);
  const plans = await loadPlans(w);
  const customersPerDay = w.params.customers / (7 * w.params.weeks * 0.8);
  const today = eatDayStart(now());

  if (kind === "hour") {
    await runHour(w, plans, customersPerDay);
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
  await logAdminAction(getDb(), adminId, "demo.tick", { type: "settings", id: "demoTicks" }, { kind, tick, counts: w.manifest.counts, skipped: w.manifest.skipped.length });
  return { kind, tick, seconds: Math.round((Date.now() - started) / 1000), counts: w.manifest.counts, skipped: w.manifest.skipped, jobs: { polled, verified, reconciled, anchor } };
}
