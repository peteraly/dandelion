"use server";

import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { act, str, withParam } from "@/lib/actions";
import { actorFromCookies } from "@/lib/auth/current";
import { getDb } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import { decryptString } from "@/lib/crypto/envelope";
import { getSmsProvider } from "@/lib/sms";
import { aiEnabled, helpContacts } from "@/lib/env";
import { fillTemplate, MESSAGE_TEMPLATES, type MessageTemplate } from "@/lib/ai/messages";
import { toneCheck } from "@/lib/ai/guards";
import { containsPhone } from "@/lib/ai/scrub";
import { aiDraftMessage, recordDecision } from "@/lib/services/ai-gateway";
import { DomainError, logAdminAction, withTx } from "@/lib/services/core";
import type { Actor } from "@/lib/policy";

async function admin(): Promise<Actor> {
  const a = await actorFromCookies();
  if (!a || a.role !== "SUPER_ADMIN" || !a.mfa) redirect("/admin/login");
  return a;
}

function parseValues(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of raw.split(/\r?\n/)) {
    const i = line.indexOf("=");
    if (i > 0) out[line.slice(0, i).trim()] = line.slice(i + 1).trim().slice(0, 120);
  }
  return out;
}

export async function draftMessageAction(fd: FormData): Promise<void> {
  const actor = await admin();
  const userId = str(fd, "userId");
  const template = str(fd, "template") as MessageTemplate;
  if (!MESSAGE_TEMPLATES.includes(template)) redirect(withParam("/admin/messages", "error", "invalid_input"));
  const user = await getDb().query.users.findFirst({ where: eq(s.users.id, userId) });
  if (!user) redirect(withParam("/admin/messages", "error", "not_found"));
  const values = { help: helpContacts().phone, ...parseValues(str(fd, "values")), name: user.displayName };
  const input = { template, locale: user.preferredLocale, values, context: str(fd, "context") || undefined };
  let text = fillTemplate(input);
  let ai = "";
  if (aiEnabled()) {
    try {
      const r = await aiDraftMessage(actor, input);
      if (r.draft) {
        text = r.draft.text;
        ai = r.id;
      }
    } catch (e) {
      console.error("[ai] draft failed; using the plain template", (e as Error).message);
    }
  }
  redirect(`/admin/messages?to=${userId}&ai=${ai}&draft=${encodeURIComponent(text)}`);
}

export async function sendMessageAction(fd: FormData): Promise<void> {
  const actor = await admin();
  const userId = str(fd, "userId");
  const text = str(fd, "text").slice(0, 320);
  const ai = str(fd, "ai");
  await act(
    "/admin/messages",
    async () => {
      if (!toneCheck(text).ok) throw new DomainError("message_tone");
      if (containsPhone(text.replace(helpContacts().phone, "")) && !text.includes(helpContacts().phone)) throw new DomainError("message_has_phone");
      const user = await getDb().query.users.findFirst({ where: eq(s.users.id, userId) });
      if (!user) throw new DomainError("not_found");
      await withTx(async (tx) => {
        await getSmsProvider().send(await decryptString(user.phoneEnc), text, "NOTICE", tx);
        await logAdminAction(tx, actor.userId, "message.send", { type: "user", id: userId }, { chars: text.length, ai: ai || null });
      });
      if (ai) await recordDecision(ai, true);
    },
    "/admin/messages",
    "sent",
  );
}
