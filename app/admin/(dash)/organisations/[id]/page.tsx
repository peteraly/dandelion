/** One buyer organisation: profile, activation request, orders and history (prompt §8.8.4). */
import Link from "next/link";
import { Name } from "@/components/name";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { Badge, Card, IdemKey, KV, PrimaryButton } from "@/components/ui";
import { Notice } from "@/components/notice";
import { requireAdmin } from "@/lib/auth/current";
import { referenceData } from "@/lib/services/admin";
import { organisationDetail } from "@/lib/services/organisations";
import { formatTzs } from "@/lib/money";
import { formatDateTime } from "@/lib/util/time";
import { flags, type SearchParams } from "@/lib/actions";
import { requestOrganisationActivationAction, updateOrganisationAction } from "../../actions";
import { OrganisationFields } from "../fields";

export const dynamic = "force-dynamic";

export default async function OrganisationPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SearchParams }) {
  const { id } = await params;
  const { actor } = await requireAdmin();
  const t = await getTranslations("admin.organisations");
  const tc = await getTranslations("common");
  const tk = await getTranslations("orderKinds");
  const ts = await getTranslations("orderStates");
  const locale = (await getLocale()) as "sw" | "en";
  const { error, ok } = await flags(searchParams);
  const d = await organisationDetail(actor, id);
  if (!d) notFound();
  const ref = await referenceData(actor);
  const o = d.summary;
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-bold">
          <Name value={o.name} />
        </h1>
        <Badge>{t(`kinds.${o.kind}`)}</Badge>
        {o.womenOwned ? <Badge tone="purple">{t("womenOwnedBadge")}</Badge> : null}
        <Badge tone={o.active ? "green" : "amber"}>{o.active ? t("active") : t("inactive")}</Badge>
        {o.pendingActivation ? <Badge tone="purple">{t("pending")}</Badge> : null}
      </div>
      <Notice error={error} ok={ok} okNamespace="admin.organisations" />
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <KV
            items={[
              [t("area"), o.areaName],
              [t("contactName"), o.contactName ?? "—"],
              [t("contactPhone"), o.contactPhoneMasked],
              [t("notes"), d.notes ?? "—"],
              [t("confirmed"), formatTzs(o.confirmedTzs, locale)],
            ]}
          />
        </Card>
        <Card>
          <h2 className="mb-2 font-semibold">{o.active ? t("requestDeactivation") : t("requestActivation")}</h2>
          {o.pendingActivation ? (
            <p className="rounded-lg bg-stone-100 p-2 text-sm" data-testid="activation-pending">
              {t("pendingNote")}
            </p>
          ) : (
            <form action={requestOrganisationActivationAction}>
              <IdemKey />
              <input type="hidden" name="organisationId" value={o.id} />
              <input type="hidden" name="active" value={o.active ? "false" : "true"} />
              <button type="submit" className={o.active ? "btn btn-danger" : "btn btn-primary"} data-testid="request-activation">
                {o.active ? t("requestDeactivation") : t("requestActivation")}
              </button>
            </form>
          )}
        </Card>
      </div>
      <Card>
        <h2 className="mb-2 font-semibold">{t("edit")}</h2>
        <form action={updateOrganisationAction} className="grid gap-3 md:grid-cols-2">
          <IdemKey />
          <input type="hidden" name="organisationId" value={o.id} />
          <OrganisationFields t={t} areas={ref.areas} defaults={{ name: o.name, kind: o.kind, serviceAreaId: o.areaId, contactName: o.contactName, womenOwned: o.womenOwned, notes: d.notes }} statusLocked={o.active} />
          <div className="md:col-span-2">
            <PrimaryButton>{t("save")}</PrimaryButton>
          </div>
        </form>
      </Card>
      <Card>
        <h2 className="mb-2 font-semibold">{t("ordersTitle")}</h2>
        <table className="w-full text-sm" data-testid="organisation-orders">
          <thead>
            <tr className="text-left text-stone-500">
              <th className="py-2">{tc("reference")}</th>
              <th>{tk("SUPPLIER_TO_ORG").slice(0, 0)}{t("seller")}</th>
              <th>{tc("product")}</th>
              <th>{tc("quantity")}</th>
              <th>{tc("amount")}</th>
              <th>{tc("status")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {d.orders.map((r) => (
              <tr key={r.id}>
                <td className="py-2">
                  <Link href={`/admin/orders/${r.id}`} className="font-mono underline">
                    {r.ref}
                  </Link>
                </td>
                <td>
                  {r.sellerName} <span className="text-xs text-stone-500">· {tk(r.kind)}</span>
                </td>
                <td>{r.productName}</td>
                <td className="tabular-nums">{r.quantity}</td>
                <td className="tabular-nums">
                  {formatTzs(r.confirmedTzs, locale)} / {formatTzs(r.totalTzs, locale)}
                </td>
                <td>{ts.has(r.state) ? ts(r.state) : r.state}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {d.orders.length === 0 ? <p className="text-stone-500">—</p> : null}
      </Card>
      <Card>
        <h2 className="mb-2 font-semibold">{t("history")}</h2>
        <ul className="divide-y divide-stone-100 text-sm">
          {d.history.map((h) => (
            <li key={h.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span>
                {h.active ? t("activate") : t("deactivate")} · {t("requestedBy")} {h.requestedBy}
              </span>
              <span className="text-stone-500">{formatDateTime(h.createdAt, locale)}</span>
              <Badge tone={h.status === "EXECUTED" ? "green" : h.status === "REJECTED" ? "red" : "amber"}>{h.status}</Badge>
            </li>
          ))}
        </ul>
        {d.history.length === 0 ? <p className="text-stone-500">—</p> : null}
      </Card>
    </>
  );
}
