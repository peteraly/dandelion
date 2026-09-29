/**
 * "Reset to demo dataset" (Prompt B §2.5). The backdated history needs the
 * clock override, which the app cannot import, so the reset is: guard, log,
 * wipe, and ask Vercel to rebuild through a Deploy Hook — the build then
 * migrates and seeds the demo profile (predeploy). Locally the note tells the
 * developer which command to run instead.
 */
import { appEnv, simulatorEnabled } from "@/lib/env";
import { getDb } from "@/lib/db/client";
import { DomainError, logAdminAction, logSecurityEvent } from "@/lib/services/core";
import { hitRateLimit } from "@/lib/security/rate-limit";
import { wipeDatabase } from "@/lib/seed-guards";

export interface ResetResult {
  wiped: boolean;
  redeployTriggered: boolean;
  note: string;
}

export function resetPreconditions(): { ok: boolean; problems: string[] } {
  const problems: string[] = [];
  if (appEnv() === "production") problems.push("never in production");
  if (!simulatorEnabled()) problems.push("SIMULATOR_ENABLED=true is required");
  if (appEnv() !== "development") {
    if (process.env.SEED_PROFILE !== "demo") problems.push("SEED_PROFILE=demo must be set in this environment (the rebuild seeds it)");
    if (process.env.SEED_ON_BUILD !== "true") problems.push("SEED_ON_BUILD=true must be set in this environment");
    if (!process.env.VERCEL_DEPLOY_HOOK_URL) problems.push("VERCEL_DEPLOY_HOOK_URL is not set — the rebuild would have to be started by hand (Vercel → Deployments → Redeploy)");
  }
  return { ok: problems.filter((p) => !p.startsWith("VERCEL_DEPLOY_HOOK_URL")).length === 0, problems };
}

export async function resetToDemoDataset(adminId: string, typed: string): Promise<ResetResult> {
  const pre = resetPreconditions();
  if (!pre.ok) throw new DomainError("reset_not_allowed");
  if (typed.trim() !== "demo") throw new DomainError("reset_confirm_required");
  const limit = await hitRateLimit("demo:reset", 1, 600);
  if (!limit.allowed) throw new DomainError("rate_limited");

  const db = getDb();
  // These rows die with the wipe; the console line survives in the platform logs.
  await logAdminAction(db, adminId, "demo.reset", { type: "database", id: "public" }, { env: appEnv() });
  await logSecurityEvent(db, "DEMO_RESET", "ALERT", { userId: adminId, details: { env: appEnv() } });
  console.warn(`[demo] database wiped by admin ${adminId} for a demo reset (${appEnv()})`);
  await wipeDatabase();

  const hook = process.env.VERCEL_DEPLOY_HOOK_URL;
  if (hook && appEnv() !== "development") {
    const r = await fetch(hook, { method: "POST" });
    if (!r.ok) return { wiped: true, redeployTriggered: false, note: `database wiped; the deploy hook answered ${r.status} — start a redeploy by hand (Vercel → Deployments → Redeploy)` };
    return { wiped: true, redeployTriggered: true, note: "database wiped; Vercel is rebuilding — the app is back with the demo dataset in about two minutes" };
  }
  return { wiped: true, redeployTriggered: false, note: appEnv() === "development" ? "database wiped; run: SIMULATOR_ENABLED=true SEED_PROFILE=demo npm run db:seed" : "database wiped; start a redeploy by hand (Vercel → Deployments → Redeploy)" };
}
