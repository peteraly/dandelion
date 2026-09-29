/**
 * Health check (build prompt §8): DB reachable, poller and anchor ran within
 * 2× their interval, anchor wallet balance above the alert threshold.
 * Point an external uptime monitor at this (see README).
 */
import { sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import { appEnv, paymentProviderId, smsProviderId, chainNetwork, aiEnabled } from "@/lib/env";
import { getSetting } from "@/lib/services/core";
import { walletStatus } from "@/lib/ledger/anchor";

export const dynamic = "force-dynamic";

const INTERVALS_MS: Record<string, number> = { poller: 5 * 60_000, anchor: 60 * 60_000, reconciliation: 24 * 60 * 60_000 };

export async function GET() {
  const checks: Record<string, { ok: boolean; detail?: string }> = {};
  let ok = true;
  try {
    await getDb().execute(sql`select 1`);
    checks.db = { ok: true };
  } catch (e) {
    checks.db = { ok: false, detail: (e as Error).message };
    ok = false;
  }
  if (checks.db?.ok) {
    let beats: (typeof s.jobHeartbeats.$inferSelect)[] = [];
    try {
      beats = await getDb().select().from(s.jobHeartbeats);
    } catch (e) {
      checks.migrations = { ok: false, detail: `schema not migrated: ${(e as Error).message.slice(0, 120)}` };
      ok = false;
    }
    for (const [name, interval] of Object.entries(INTERVALS_MS)) {
      const b = beats.find((x) => x.name === name);
      const fresh = !!b && Date.now() - b.lastRunAt.getTime() < 2 * interval && b.lastStatus === "ok";
      checks[name] = { ok: fresh, detail: b ? `last ${b.lastStatus} at ${b.lastRunAt.toISOString()}` : "never ran" };
      // Missing heartbeats degrade the check but do not fail a fresh deploy.
      if (b && !fresh) ok = false;
    }
    try {
      const w = await walletStatus();
      const threshold = BigInt(await getSetting("walletLowBalanceWei"));
      const low = w.configured && w.balanceWei !== null && w.balanceWei < threshold;
      checks.wallet = { ok: !low, detail: w.configured ? `${w.address} balance ${w.balanceWei?.toString() ?? "?"} wei on ${w.network}` : "not configured" };
      if (low) ok = false;
    } catch (e) {
      checks.wallet = { ok: false, detail: (e as Error).message };
    }
  }
  return Response.json(
    {
      ok,
      env: appEnv(),
      providers: { payment: paymentProviderId(), sms: smsProviderId(), chain: chainNetwork(), ai: aiEnabled() },
      checks,
    },
    { status: ok ? 200 : 503 },
  );
}
