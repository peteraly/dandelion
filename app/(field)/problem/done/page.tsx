import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Card } from "@/components/ui";
import { requireField } from "@/lib/auth/current";
import type { SearchParams } from "@/lib/actions";

export const dynamic = "force-dynamic";

export default async function ProblemDonePage({ searchParams }: { searchParams: SearchParams }) {
  await requireField();
  const t = await getTranslations("problems");
  const sp = await searchParams;
  const ref = typeof sp.ref === "string" ? sp.ref : "";
  const locked = sp.locked === "1";
  return (
    <>
      <Card className="border-green-300 bg-green-50">
        <p className="text-lg font-semibold" data-testid="problem-ref">
          {t("reported", { ref })}
        </p>
        {locked ? <p className="mt-2 text-red-800">{t("lockedBatch")}</p> : null}
      </Card>
      <Link href="/home" className="btn btn-primary">
        {(await getTranslations("common"))("back")}
      </Link>
    </>
  );
}
