/**
 * Supplier directory (Prompt B §8.3): every organisation that supplies the
 * pilot, what it supplies, who works there, how it is doing — and the form
 * that adds one (inactive until two admins approve).
 */
import Link from "next/link";
import { Name } from "@/components/name";
import { getLocale, getTranslations } from "next-intl/server";
import { Badge, Card, IdemKey, PrimaryButton } from "@/components/ui";
import { Notice } from "@/components/notice";
import { requireAdmin } from "@/lib/auth/current";
import { referenceData } from "@/lib/services/admin";
import { listSuppliers } from "@/lib/services/suppliers";
import { formatDay } from "@/lib/util/time";
import { flags, type SearchParams } from "@/lib/actions";
import { createSupplierAction } from "../../actions";
import { SupplierFields } from "../fields";

export const dynamic = "force-dynamic";

export default async function SuppliersPage({ searchParams }: { searchParams: SearchParams }) {
  const { actor } = await requireAdmin();
  const t = await getTranslations("admin.suppliers");
  const tc = await getTranslations("common");
  const locale = (await getLocale()) as "sw" | "en";
  const { error, ok } = await flags(searchParams);
  const rows = await listSuppliers(actor);
  const ref = await referenceData(actor);
  return (
    <>
      <h1 className="text-2xl font-bold">{t("title")}</h1>
      <p className="text-sm text-stone-600">{t("intro")}</p>
      <Notice error={error} ok={ok} okNamespace="admin.suppliers" />
      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-sm" data-testid="suppliers-table">
            <thead>
              <tr className="text-left text-stone-500">
                <th className="py-2">{t("name")}</th>
                <th>{t("area")}</th>
                <th>{tc("status")}</th>
                <th>{t("leadTime")}</th>
                <th>{t("products")}</th>
                <th>{t("users")}</th>
                <th>{t("lastPickup")}</th>
                <th>{t("openPickups")}</th>
                <th>{t("quality")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {rows.map((r) => (
                <tr key={r.id} data-testid="supplier-row">
                  <td className="py-2">
                    <Link href={`/admin/suppliers/${r.id}`} className="underline">
                      <Name value={r.businessName} />
                    </Link>
                  </td>
                  <td>{r.areaName}</td>
                  <td className="space-x-1">
                    <Badge tone={r.active ? "green" : "amber"}>{r.active ? t("active") : t("inactive")}</Badge>
                    {r.pendingActivation ? <Badge tone="purple">{t("pending")}</Badge> : null}
                  </td>
                  <td>{t("days", { n: r.leadTimeDays })}</td>
                  <td>{r.products.length ? r.products.join(", ") : "—"}</td>
                  <td>{r.users}</td>
                  <td>{r.lastPickupAt ? formatDay(r.lastPickupAt, locale) : "—"}</td>
                  <td className="space-x-1">
                    <span>{r.openPickups}</span>
                    {r.waitingPastLeadTime > 0 ? <Badge tone="red">{t("waiting", { n: r.waitingPastLeadTime })}</Badge> : null}
                  </td>
                  <td>{r.quality.batches ? `${Math.round(r.quality.share * 100)}% (${r.quality.withIssue}/${r.quality.batches})` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {rows.length === 0 ? <p className="text-stone-500">{t("none")}</p> : null}
      </Card>
      <Card>
        <h2 className="mb-2 font-semibold">{t("create")}</h2>
        <p className="mb-3 text-sm text-stone-600">{t("createNote")}</p>
        <form action={createSupplierAction} className="grid gap-3 md:grid-cols-2">
          <IdemKey />
          <SupplierFields t={t} areas={ref.areas} />
          <div className="md:col-span-2">
            <PrimaryButton>{t("create")}</PrimaryButton>
          </div>
        </form>
      </Card>
    </>
  );
}
