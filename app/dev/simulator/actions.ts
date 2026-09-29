"use server";

import { notFound, redirect } from "next/navigation";
import { currentAdminSession } from "@/lib/auth/current";
import type { LoadedSession } from "@/lib/auth/session";
import { simulatorEnabled } from "@/lib/env";
import { simulate, type Scenario } from "@/lib/payments/simulator";
import { enqueueStalePolls, runDueVerificationJobs } from "@/lib/payments/verification";
import { simulateTick, type TickKind } from "@/lib/demo/tick";
import { resetToDemoDataset } from "@/lib/demo/reset";
import { DomainError } from "@/lib/services/core";
import { str } from "@/lib/actions";

async function guard(): Promise<LoadedSession> {
  if (!simulatorEnabled()) notFound();
  const s = await currentAdminSession();
  if (!s?.mfaVerified) redirect("/admin/login");
  return s;
}

function describe(e: unknown): string {
  return `error: ${e instanceof DomainError ? e.code : e instanceof Error ? e.message : String(e)}`;
}

/** Query strings are not for novels; the admin log has the full record. */
function clip(result: string): string {
  return result.length > 4000 ? `${result.slice(0, 4000)}\n… (truncated)` : result;
}

export async function simulateAction(fd: FormData): Promise<void> {
  await guard();
  const amount = str(fd, "amountTzs");
  let result: string;
  try {
    const r = await simulate(str(fd, "scenario") as Scenario, str(fd, "orderRef"), { amountTzs: amount ? Number(amount) : undefined });
    result = JSON.stringify(r, null, 1);
  } catch (e) {
    result = describe(e);
  }
  redirect(`/dev/simulator?result=${encodeURIComponent(result)}`);
}

export async function runJobsAction(): Promise<void> {
  await guard();
  const enqueued = await enqueueStalePolls(0);
  const outcomes = await runDueVerificationJobs();
  redirect(`/dev/simulator?result=${encodeURIComponent(JSON.stringify({ enqueued, outcomes }))}`);
}

/** Prompt B §2.5 — "Simulate one hour / one day" on the demo dataset. */
export async function tickAction(fd: FormData): Promise<void> {
  const session = await guard();
  const kind: TickKind = str(fd, "kind") === "day" ? "day" : "hour";
  let result: string;
  try {
    result = JSON.stringify(await simulateTick(kind, session.user.id), null, 1);
  } catch (e) {
    result = describe(e);
  }
  redirect(`/dev/simulator?result=${encodeURIComponent(clip(result))}#living-demo`);
}

/**
 * Prompt B §2.5 — "Reset to demo dataset". On success the database is empty,
 * which ends this admin's session too, so the outcome is shown on a page that
 * needs no login (it shows nothing but the outcome).
 */
export async function resetDemoAction(fd: FormData): Promise<void> {
  const session = await guard();
  let result: string;
  let ok = false;
  try {
    result = JSON.stringify(await resetToDemoDataset(session.user.id, str(fd, "confirm")), null, 1);
    ok = true;
  } catch (e) {
    result = describe(e);
  }
  if (!ok) redirect(`/dev/simulator?result=${encodeURIComponent(result)}#living-demo`);
  redirect(`/dev/simulator/reset?result=${encodeURIComponent(result)}`);
}
