/**
 * Areas and their sale paths (prompt §8.8.2). The ladder is always allowed;
 * anything else is a per-area switch that two admins turn on, because it
 * decides who earns. The request goes to the approvals inbox.
 */
import { getTranslations } from "next-intl/server";
import { Badge, Card, IdemKey, PrimaryButton } from "@/components/ui";
import { Notice } from "@/components/notice";
import { requireAdmin } from "@/lib/auth/current";
import { listAreasWithSales } from "@/lib/services/areas";
import { DIRECT_KINDS } from "@/lib/domain/sales";
import { flags, type SearchParams } from "@/lib/actions";
import { requestAreaSalesAction } from "../actions";

export const dynamic = "force-dynamic";

export default async function AreasPage({ searchParams }: { searchParams: SearchParams }) {
  const { actor } = await requireAdmin();
  const t = await getTranslations("admin.areas");
  const tk = await getTranslations("orderKinds");
  const { error, ok } = await flags(searchParams);
  const rows = await listAreasWithSales(actor);
  return (
    <>
      <h1 className="text-2xl font-bold">{t("title")}</h1>
      <p className="text-sm text-stone-600">{t("intro")}</p>
      <p className="text-sm text-stone-600">{t("decision")}</p>
      <Notice error={error} ok={ok} okNamespace="admin.areas" />
      {rows.map((a) => (
        <Card key={a.id} data-testid="area-card">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <h2 className="font-semibold">{a.name}</h2>
            <span className="text-sm text-stone-500">{a.region}</span>
            {a.pendingRequest ? <Badge tone="purple">{t("pending")}</Badge> : null}
          </div>
          <p className="mb-3 text-sm" data-testid="area-allowed">
            {t("allowed")}: {a.allowedSales.length ? a.allowedSales.map((k) => tk(k)).join(" · ") : t("ladderOnly")}
          </p>
          <form action={requestAreaSalesAction} className="flex flex-col gap-2">
            <IdemKey />
            <input type="hidden" name="serviceAreaId" value={a.id} />
            {DIRECT_KINDS.map((k) => (
              <label key={k} className="check">
                <input type="checkbox" name={`path_${k}`} value="true" defaultChecked={a.allowedSales.includes(k)} className="mt-0.5" />
                <span>
                  {t(`paths.${k}`)} <span className="block text-xs text-stone-500">{tk(k)}</span>
                </span>
              </label>
            ))}
            <div className="md:w-64">
              <PrimaryButton disabled={a.pendingRequest}>{t("request")}</PrimaryButton>
            </div>
          </form>
        </Card>
      ))}
    </>
  );
}
