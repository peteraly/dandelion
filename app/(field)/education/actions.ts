"use server";

import { redirect } from "next/navigation";
import { getLocale } from "next-intl/server";
import { str } from "@/lib/actions";
import { actorFromCookies } from "@/lib/auth/current";
import { aiEducation } from "@/lib/services/ai-gateway";

export async function askEducationAction(fd: FormData): Promise<void> {
  const actor = await actorFromCookies();
  if (!actor || actor.role !== "FIELD_CHAMPION") redirect("/login?expired=1");
  const locale = ((await getLocale()) as "sw" | "en") ?? "sw";
  try {
    const r = await aiEducation(actor, str(fd, "question"), locale);
    if (r.answer.kind === "answer") redirect(`/education?kind=answer&answer=${encodeURIComponent(r.answer.text)}&sources=${r.answer.sources.join(",")}`);
    redirect(`/education?kind=${r.answer.kind}`);
  } catch (e) {
    if (typeof e === "object" && e !== null && "digest" in e) throw e; // redirect
    redirect("/education?kind=not_covered");
  }
}
