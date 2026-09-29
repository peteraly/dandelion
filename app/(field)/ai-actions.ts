"use server";

import { actorFromCookies } from "@/lib/auth/current";
import { aiEnabled } from "@/lib/env";
import { aiProposeException } from "@/lib/services/ai-gateway";

/** Problem intake proposal (build prompt §7.1). Returns a draft; the user still submits the form. */
export async function proposeProblemAction(text: string): Promise<{ id: string; type: string; confidence: number; note: string } | null> {
  const actor = await actorFromCookies();
  if (!actor || actor.role === "SUPER_ADMIN" || !aiEnabled()) return null;
  try {
    const r = await aiProposeException(actor, text);
    return r.proposal ? { id: r.id, ...r.proposal } : null;
  } catch (e) {
    console.error("[ai] problem intake failed", (e as Error).message);
    return null;
  }
}
