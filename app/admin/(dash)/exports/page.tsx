import { getTranslations } from "next-intl/server";
import { eq, and } from "drizzle-orm";
import { Card, IdemKey } from "@/components/ui";
import { Notice } from "@/components/notice";
import { requireAdmin } from "@/lib/auth/current";
import { EXPORT_DATASETS } from "@/lib/services/admin";
import { getSetting } from "@/lib/services/core";
import { getDb } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import { flags, type SearchParams } from "@/lib/actions";
import { largeExportRequestAction } from "../actions";

export default async function ExportsPage({ searchParams }: { searchParams: SearchParams }) {
  await requireAdmin();
  const t = await getTranslations("admin.exports");
  const { error, ok } = await flags(searchParams);
  const limit = await getSetting("largeExportRows");
  const approved = await getDb().query.approvalRequests.findMany({ where: and(eq(s.approvalRequests.type, "LARGE_EXPORT"), eq(s.approvalRequests.status, "EXECUTED")) });
  return (
    <>
      <h1 className="text-2xl font-bold">{t("title")}</h1>
      <p className="text-sm text-stone-600">{t("large", { rows: limit })}</p>
      <Notice error={error} ok={ok} />
      <Card>
        <ul className="divide-y divide-stone-100">
          {EXPORT_DATASETS.map((d) => {
            const appr = approved.find((a) => (a.payload as { dataset?: string }).dataset === d);
            return (
              <li key={d} className="flex flex-col gap-2 py-3 md:flex-row md:items-center md:justify-between">
                <span className="font-mono">{d}</span>
                <div className="flex gap-2">
                  <a href={`/api/admin/export?dataset=${d}${appr ? `&approval=${appr.id}` : ""}`} className="btn btn-secondary w-40">
                    {t("download")}
                  </a>
                  <form action={largeExportRequestAction}>
                    <IdemKey />
                    <input type="hidden" name="dataset" value={d} />
                    <input type="hidden" name="rows" value="0" />
                    <button type="submit" className="btn btn-secondary w-56">
                      Request large export
                    </button>
                  </form>
                </div>
              </li>
            );
          })}
        </ul>
      </Card>
    </>
  );
}
