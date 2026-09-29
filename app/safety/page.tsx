import { getTranslations } from "next-intl/server";
import { PublicShell } from "@/components/shell";
import { Card } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function SafetyPage() {
  const t = await getTranslations("public");
  return (
    <PublicShell path="/safety">
      <h1 className="text-2xl font-bold">{t("safety")}</h1>
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
