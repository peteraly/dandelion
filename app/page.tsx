import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { PublicShell } from "@/components/shell";
import { Card } from "@/components/ui";
import { publicWeeklyStats } from "@/lib/services/public-stats";
import { openDemoEnabled } from "@/lib/demo/open";

export const dynamic = "force-dynamic";

export default async function LandingPage() {
  const t = await getTranslations("public");
  // The public page must not fail when the database is unreachable or not yet configured (e.g. a fresh preview).
  const stats = await publicWeeklyStats().catch((e: unknown) => {
    console.error("[public] stats unavailable:", e instanceof Error ? e.message : e);
    return null;
  });
  const openDemo = await openDemoEnabled();
  return (
    <PublicShell path="/">
      <h1 className="text-2xl font-bold">{t("title")}</h1>
      <p className="text-lg">{t("hero")}</p>
      {openDemo ? (
        <Link href="/demo" className="btn btn-primary" data-testid="try-demo">
          {(await getTranslations("openDemo"))("landingCta")}
        </Link>
      ) : null}
      <Card>
        <h2 className="mb-2 text-lg font-semibold">{t("howItWorks")}</h2>
        <ol className="list-decimal space-y-2 pl-5">
          {(["1", "2", "3", "4", "5"] as const).map((k) => (
            <li key={k}>{t(`steps.${k}`)}</li>
          ))}
        </ol>
      </Card>
      <Card>
        <h2 className="mb-2 text-lg font-semibold">{t("ledgerTitle")}</h2>
        <p>{t("ledgerHonest")}</p>
      </Card>
      <Card>
        <h2 className="mb-2 text-lg font-semibold">{t("stats")}</h2>
        {stats ? (
          <>
            <dl className="grid grid-cols-2 gap-2">
              <dt className="text-stone-600">{t("handovers")}</dt>
              <dd className="text-right font-semibold">{stats.handovers === null ? t("fewerThan10") : stats.handovers}</dd>
              <dt className="text-stone-600">{t("activeChampions")}</dt>
              <dd className="text-right font-semibold">{stats.activeChampions === null ? t("fewerThan10") : stats.activeChampions}</dd>
            </dl>
            <p className="mt-2 text-sm text-stone-500">{t("statsNote")}</p>
          </>
        ) : (
          <p className="text-stone-500">{t("statsUnavailable")}</p>
        )}
      </Card>
      <nav className="flex flex-col gap-2">
        <Link href="/safety" className="btn btn-secondary">
          {t("safety")}
        </Link>
        <Link href="/privacy" className="btn btn-secondary">
          {t("privacy")}
        </Link>
        <Link href="/login" className={openDemo ? "btn btn-secondary" : "btn btn-primary"}>
          {t("title")} — {(await getTranslations("auth"))("loginTitle")}
        </Link>
      </nav>
    </PublicShell>
  );
}
