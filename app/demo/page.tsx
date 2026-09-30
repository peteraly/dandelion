/**
 * The open demo's front door (Prompt E): pick a role, you are in. Not found
 * unless the open demo is enabled (non-production, DEMO_OPEN_ACCESS=true,
 * fictional dataset). Everyone with the link shares the same district.
 */
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { PublicShell } from "@/components/shell";
import { Card } from "@/components/ui";
import { Notice } from "@/components/notice";
import { OPEN_DEMO_ROLES, openDemoEnabled } from "@/lib/demo/open";
import { flags, type SearchParams } from "@/lib/actions";
import { enterDemoAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function OpenDemoPage({ searchParams }: { searchParams: SearchParams }) {
  if (!(await openDemoEnabled())) notFound();
  const t = await getTranslations("openDemo");
  const { error } = await flags(searchParams);
  return (
    <PublicShell path="/demo">
      <div>
        <h1 className="text-2xl font-bold">{t("title")}</h1>
        <p className="mt-1 text-stone-700">{t("intro")}</p>
      </div>
      <p className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950" role="note">
        {t("shared")}
      </p>
      <Notice error={error} />
      <ul className="flex flex-col gap-3" data-testid="open-demo-roles">
        {OPEN_DEMO_ROLES.map((role) => (
          <li key={role}>
            <Card className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="font-semibold">{t(`roles.${role}.title`)}</p>
                <p className="text-sm text-stone-600">{t(`roles.${role}.what`)}</p>
              </div>
              <form action={enterDemoAction} className="shrink-0">
                <input type="hidden" name="role" value={role} />
                <button type="submit" className={`btn w-auto px-4 text-base ${role === "founder" ? "btn-primary" : "btn-secondary"}`} data-testid={`enter-${role}`}>
                  {t("enter")}
                </button>
              </form>
            </Card>
          </li>
        ))}
      </ul>
      <p className="text-xs text-stone-500">{t("limits")}</p>
    </PublicShell>
  );
}
