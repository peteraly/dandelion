/**
 * Message drafting (build prompt §7.3). Deterministic template fill, adapted
 * by AI when enabled. Nothing is sent until an admin approves the exact text.
 */
import { getTranslations } from "next-intl/server";
import { and, eq, ne } from "drizzle-orm";
import { Card, Field, IdemKey, PrimaryButton } from "@/components/ui";
import { Notice } from "@/components/notice";
import { requireAdmin } from "@/lib/auth/current";
import { getDb } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import { MESSAGE_TEMPLATES } from "@/lib/ai/messages";
import { toneCheck } from "@/lib/ai/guards";
import { aiEnabled } from "@/lib/env";
import { flags, type SearchParams } from "@/lib/actions";
import { draftMessageAction, sendMessageAction } from "./actions";

export default async function MessagesPage({ searchParams }: { searchParams: SearchParams }) {
  await requireAdmin();
  const t = await getTranslations("admin.messages");
  const sp = await searchParams;
  const { error, ok } = await flags(searchParams);
  const users = await getDb().query.users.findMany({ where: and(ne(s.users.role, "SUPER_ADMIN"), eq(s.users.status, "ACTIVE")), orderBy: s.users.displayName });
  const draft = typeof sp.draft === "string" ? sp.draft : null;
  const recipient = typeof sp.to === "string" ? sp.to : "";
  const interaction = typeof sp.ai === "string" ? sp.ai : "";
  const tone = draft ? toneCheck(draft) : null;
  return (
    <>
      <h1 className="text-2xl font-bold">{t("title")}</h1>
      <p className="text-sm text-stone-600">{aiEnabled() ? t("introAi") : t("introNoAi")}</p>
      <Notice error={error} ok={ok} okNamespace="admin.messages" />
      <Card>
        <form action={draftMessageAction} className="grid gap-3 md:grid-cols-2">
          <IdemKey />
          <Field label={t("recipient")} htmlFor="userId">
            <select id="userId" name="userId" className="field" required defaultValue={recipient}>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.displayName} ({u.role})
                </option>
              ))}
            </select>
          </Field>
          <Field label={t("template")} htmlFor="template">
            <select id="template" name="template" className="field" defaultValue="general_notice">
              {MESSAGE_TEMPLATES.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t("values")} htmlFor="values" hint="key=value per line, e.g. paid=6,000 TZS">
            <textarea id="values" name="values" className="field" rows={3} defaultValue={"body=\nhelp=+255 700 000 000"} />
          </Field>
          <Field label={t("context")} htmlFor="context">
            <textarea id="context" name="context" className="field" rows={3} maxLength={500} />
          </Field>
          <div className="md:col-span-2">
            <PrimaryButton>{t("draft")}</PrimaryButton>
          </div>
        </form>
      </Card>
      {draft ? (
        <Card className="border-2 border-brand-100" data-testid="message-draft">
          <h2 className="font-semibold">{t("review")}</h2>
          <p className="my-2 whitespace-pre-wrap rounded-xl bg-stone-50 p-3">{draft}</p>
          <p className={`text-sm ${tone?.ok ? "text-green-800" : "text-red-700"}`}>{tone?.ok ? t("toneOk") : t("toneBad")}</p>
          <form action={sendMessageAction} className="mt-3 flex flex-col gap-2">
            <input type="hidden" name="userId" value={recipient} />
            <input type="hidden" name="ai" value={interaction} />
            <textarea name="text" className="field" rows={4} defaultValue={draft} maxLength={320} />
            <PrimaryButton disabled={!tone?.ok}>{t("approveSend")}</PrimaryButton>
          </form>
        </Card>
      ) : null}
    </>
  );
}
