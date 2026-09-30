"use server";

import { notFound, redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth/current";
import { simulatorEnabled } from "@/lib/env";
import { DomainError } from "@/lib/services/core";
import { JOURNEY_STEPS, advanceJourney, startJourney } from "@/lib/demo/journey";

async function adminId(): Promise<string> {
  if (!simulatorEnabled()) notFound();
  const { session } = await requireAdmin();
  return session.user.id;
}

const code = (e: unknown) => (e instanceof DomainError ? e.code : "journey_failed");

export async function journeyStartAction(): Promise<void> {
  const id = await adminId();
  let error = "";
  try {
    await startJourney(id);
  } catch (e) {
    error = code(e);
  }
  redirect(error ? `/admin/demo/journey?error=${error}` : "/admin/demo/journey");
}

export async function journeyStepAction(): Promise<void> {
  const id = await adminId();
  let error = "";
  try {
    await advanceJourney(id);
  } catch (e) {
    error = code(e);
  }
  redirect(error ? `/admin/demo/journey?error=${error}` : "/admin/demo/journey");
}

/** For the auto-advance switch: one step, no redirect; the page refreshes itself. */
export async function journeyAutoAction(): Promise<{ ok: boolean; done: boolean; code?: string }> {
  const id = await adminId();
  try {
    const st = await advanceJourney(id);
    return { ok: !st.error, done: st.step >= JOURNEY_STEPS.length, code: st.error };
  } catch (e) {
    return { ok: false, done: false, code: code(e) };
  }
}
