/** Buyer organisations (prompt §8.8.4): directory and the form that adds one (inactive until two admins approve). */
import Link from "next/link";
import { Name } from "@/components/name";
import { getLocale, getTranslations } from "next-intl/server";
import { Badge, Card, IdemKey, PrimaryButton } from "@/components/ui";
import { Notice } from "@/components/notice";
import { requireAdmin } from "@/lib/auth/current";
import { referenceData } from "@/lib/services/admin";
import { listOrganisations } from "@/lib/services/organisations";
import { formatTzs } from "@/lib/money";
import { formatDay } from "@/lib/util/time";
import { flags, type SearchParams } from "@/lib/actions";
import { createOrganisationAction } from "../../actions";
import { OrganisationFields } from "../fields";

export const dynamic = "force-dynamic";

export default async function OrganisationsPage({ searchParams }: { searchParams: SearchParams }) {
  const { actor } = await requireAdmin();
  const t = await getTranslations("admin.organisations");
  const tc = await getTranslations("common");
  const locale = (await getLocale()) as "sw" | "en";
  const { error, ok } = await flags(searchParams);
  const rows = await listOrganisations(actor);
  const ref = await referenceData(actor);
  return (
    <>
      <h1 className="text-2xl font-bold">{t("title")}</h1>
      <p className="text-sm text-stone-600">{t("intro")}</p>
      <p className="text-sm text-stone-600">{t("privacy")}</p>
      <Notice error={error} ok={ok} okNamespace="admin.organisations" />
      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-sm" data-testid="organisations-table">
            <thead>
              <tr className="text-left text-stone-500">
                <th className="py-2">{t("name")}</th>
                <th>{t("kind")}</th>
                <th>{t("area")}</th>
                <th>{tc("status")}</th>
                <th>{t("orders")}</th>
                <th>{t("openOrders")}</th>
                <th>{t("confirmed")}</th>
                <th>{t("lastOrder")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {rows.map((r) => (
                <tr key={r.id} data-testid="organisation-row">
                  <td className="py-2">
                    <Link href={`/admin/organisations/${r.id}`} className="underline">
                      <Name value={r.name} />
                    </Link>
                  </td>
                  <td>
                    {t(`kinds.${r.kind}`)} {r.womenOwned ? <Badge tone="purple">{t("womenOwnedBadge")}</Badge> : null}
                  </td>
                  <td>{r.areaName}</td>
                  <td className="space-x-1">
                    <Badge tone={r.active ? "green" : "amber"}>{r.active ? t("active") : t("inactive")}</Badge>
                    {r.pendingActivation ? <Badge tone="purple">{t("pending")}</Badge> : null}
                  </td>
                  <td className="tabular-nums">{r.orders}</td>
                  <td className="tabular-nums">{r.openOrders}</td>
                  <td className="tabular-nums">{formatTzs(r.confirmedTzs, locale)}</td>
                  <td>{r.lastOrderAt ? formatDay(r.lastOrderAt, locale) : "—"}</td>
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
        <form action={createOrganisationAction} className="grid gap-3 md:grid-cols-2">
          <IdemKey />
          <OrganisationFields t={t} areas={ref.areas} />
          <div className="md:col-span-2">
            <PrimaryButton>{t("create")}</PrimaryButton>
          </div>
        </form>
      </Card>
    </>
  );
}
