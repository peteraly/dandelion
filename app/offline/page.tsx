import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { PublicShell } from "@/components/shell";

export const dynamic = "force-dynamic";

export default async function OfflinePage() {
  const t = await getTranslations("common");
  const tn = await getTranslations("field.notes");
  return (
    <PublicShell path="/offline">
      <h1 className="text-2xl font-bold">{t("offline")}</h1>
      <p>{tn("rule")}</p>
      <Link href="/notes" className="btn btn-primary">
        {tn("title")}
      </Link>
    </PublicShell>
  );
}
