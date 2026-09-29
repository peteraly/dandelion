/**
 * Champion education assistant (build prompt §7.5). Disabled until an admin
 * approves the content pack; answers only from the pack; symptoms → referral.
 */
import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { Card, Field, PrimaryButton } from "@/components/ui";
import { requireField } from "@/lib/auth/current";
import { aiEnabled, helpContacts } from "@/lib/env";
import { educationPackApproved, loadEducationPack } from "@/lib/services/ai-gateway";
import type { SearchParams } from "@/lib/actions";
import { askEducationAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function EducationPage({ searchParams }: { searchParams: SearchParams }) {
  const { actor } = await requireField();
  const t = await getTranslations("education");
  const locale = (await getLocale()) as "sw" | "en";
  const sp = await searchParams;
  const { pack } = loadEducationPack();
  const enabled = actor.role === "FIELD_CHAMPION" && aiEnabled() && (await educationPackApproved());
  const kind = typeof sp.kind === "string" ? sp.kind : null;
  const answer = typeof sp.answer === "string" ? sp.answer : null;
  const sources = typeof sp.sources === "string" ? sp.sources.split(",").filter(Boolean) : [];
  return (
    <>
      <h1 className="text-2xl font-bold">{t("title")}</h1>
      <p className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs font-bold uppercase text-amber-900">{t("draft")}</p>
      {kind === "refer" ? (
        <Card className="border-amber-300 bg-amber-50" data-testid="referral">
          <h2 className="font-semibold">{(await getTranslations("problems.referral"))("title")}</h2>
          <p className="mt-2">{(await getTranslations("problems.referral"))("body")}</p>
          <p className="mt-2 font-semibold">{(await getTranslations("problems.referral"))("helpline", { phone: helpContacts().phone })}</p>
        </Card>
      ) : null}
      {kind === "answer" && answer ? (
        <Card data-testid="education-answer">
          <p className="whitespace-pre-wrap">{answer}</p>
          <p className="mt-2 text-xs text-stone-500">
            {t("sources")}: {sources.map((id) => pack.sections.find((x) => x.id === id)?.title[locale] ?? id).join("; ")}
          </p>
        </Card>
      ) : null}
      {kind === "not_covered" ? <p className="rounded-xl bg-stone-100 p-3">{t("notCovered")}</p> : null}
      {enabled ? (
        <Card>
          <form action={askEducationAction} className="flex flex-col gap-3">
            <Field label={t("ask")} htmlFor="question">
              <textarea id="question" name="question" className="field" rows={3} maxLength={400} required />
            </Field>
            <PrimaryButton>{t("askButton")}</PrimaryButton>
          </form>
        </Card>
      ) : (
        <p className="rounded-xl bg-stone-100 p-3" data-testid="education-disabled">
          {t("disabled")}
        </p>
      )}
      <Card>
        <h2 className="mb-2 font-semibold">{t("packTitle")}</h2>
        <ul className="divide-y divide-stone-100">
          {pack.sections.map((sct) => (
            <li key={sct.id} className="py-2">
              <p className="font-semibold">{sct.title[locale]}</p>
              <p className="text-sm">{sct.body[locale]}</p>
              <p className="text-xs text-stone-500">{sct.source}</p>
            </li>
          ))}
        </ul>
      </Card>
      <Link href="/home" className="text-center text-sm underline">
        {(await getTranslations("common"))("back")}
      </Link>
    </>
  );
}
