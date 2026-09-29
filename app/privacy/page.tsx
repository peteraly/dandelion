import { getTranslations } from "next-intl/server";
import { PublicShell } from "@/components/shell";
import { Card } from "@/components/ui";
import { helpContacts } from "@/lib/env";
import { PRIVACY_NOTICE_VERSION } from "@/lib/services/customers";

export const dynamic = "force-dynamic";

export default async function PrivacyPage() {
  const t = await getTranslations("privacy");
  return (
    <PublicShell path="/privacy">
      <h1 className="text-2xl font-bold">{t("title")}</h1>
      <p className="text-sm text-stone-500">{t("version", { version: PRIVACY_NOTICE_VERSION })}</p>
      <p className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm font-bold uppercase text-amber-900">{t("draft")}</p>
      <Card className="space-y-3">
        <p>{t("p1")}</p>
        <p>{t("p2")}</p>
        <p>{t("p3")}</p>
        <p>{t("p4")}</p>
        <p>{t("p5", { phone: helpContacts().phone })}</p>
      </Card>
    </PublicShell>
  );
}
