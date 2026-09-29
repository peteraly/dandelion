"use server";

import { notFound, redirect } from "next/navigation";
import { currentAdminSession } from "@/lib/auth/current";
import { simulatorEnabled } from "@/lib/env";
import { simulate, type Scenario } from "@/lib/payments/simulator";
import { enqueueStalePolls, runDueVerificationJobs } from "@/lib/payments/verification";
import { str } from "@/lib/actions";

async function guard() {
  if (!simulatorEnabled()) notFound();
  const s = await currentAdminSession();
  if (!s?.mfaVerified) redirect("/admin/login");
}

export async function simulateAction(fd: FormData): Promise<void> {
  await guard();
  const amount = str(fd, "amountTzs");
  let result: string;
  try {
    const r = await simulate(str(fd, "scenario") as Scenario, str(fd, "orderRef"), { amountTzs: amount ? Number(amount) : undefined });
    result = JSON.stringify(r, null, 1);
  } catch (e) {
    result = `error: ${(e as Error).message}`;
  }
  redirect(`/dev/simulator?result=${encodeURIComponent(result)}`);
}

export async function runJobsAction(): Promise<void> {
  await guard();
  const enqueued = await enqueueStalePolls(0);
  const outcomes = await runDueVerificationJobs();
  redirect(`/dev/simulator?result=${encodeURIComponent(JSON.stringify({ enqueued, outcomes }))}`);
}
