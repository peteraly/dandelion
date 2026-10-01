import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { PublicShell } from "@/components/shell";
import { Card } from "@/components/ui";
import { getSetting } from "@/lib/services/core";

export const dynamic = "force-dynamic";

export default async function SafetyPage() {
  const t = await getTranslations("public");
  const ts = await getTranslations("shop");
  // Shown only once the safeguarding leads have checked each number (founders, 2026-10-01); the page never fails without a database.
  const helpline = String(await getSetting("helplineText").catch(() => ""));
  return (
    <PublicShell path="/safety">
      <h1 className="text-2xl font-bold">{t("safety")}</h1>
      <Card data-testid="safety-buying">
        <h2 className="mb-1 font-semibold">{ts("safetyTitle")}</h2>
        <ul className="list-disc space-y-1 pl-5 text-sm">
          {(["1", "2", "3", "4"] as const).map((k) => (
            <li key={k}>{ts(`safety.${k}`)}</li>
          ))}
        </ul>
        <p className="mt-2 text-sm">{t("safetyReport")}</p>
        {helpline ? (
          <p className="mt-2 text-sm font-semibold" data-testid="safety-helpline">
            {ts("helpline", { numbers: helpline })}
          </p>
        ) : null}
        <Link href="/shop" className="mt-2 inline-block text-sm underline">
          {t("shopCta")}
        </Link>
      </Card>
      <h2 className="text-lg font-semibold">{t("safetyProducts")}</h2>
      <p className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm font-bold uppercase text-amber-900">{t("safetyDraft")}</p>
      <Card>
        <p>{t("safetyReusable")}</p>
      </Card>
      <Card>
        <p>{t("safetyDisposable")}</p>
      </Card>
      <p className="text-sm text-stone-500">{t("safetySource")}</p>
    </PublicShell>
  );
}
