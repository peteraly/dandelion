/**
 * One supplier organisation (Prompt B §8.3): profile and reference data,
 * users, products, price lists, pickups, payments the provider confirmed,
 * quality issues traced to its batches, and the activation history.
 */
import Link from "next/link";
import { Name } from "@/components/name";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { Badge, Card, IdemKey, KV, PrimaryButton } from "@/components/ui";
import { Notice } from "@/components/notice";
import { requireAdmin } from "@/lib/auth/current";
import { referenceData } from "@/lib/services/admin";
import { supplierDetail } from "@/lib/services/suppliers";
import { formatTzs } from "@/lib/money";
import { formatDateTime, formatDay } from "@/lib/util/time";
import { flags, type SearchParams } from "@/lib/actions";
import { requestSupplierActivationAction, setSupplierProductAction, updateSupplierAction } from "../../actions";
import { SupplierFields } from "../fields";

export const dynamic = "force-dynamic";

export default async function SupplierPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SearchParams }) {
  const { id } = await params;
  const { actor } = await requireAdmin();
  const t = await getTranslations("admin.suppliers");
  const tc = await getTranslations("common");
  const tu = await getTranslations("admin.users");
  const ts = await getTranslations("orderStates");
  const tp = await getTranslations("problems");
  const locale = (await getLocale()) as "sw" | "en";
  const { error, ok } = await flags(searchParams);
  const d = await supplierDetail(actor, id);
  if (!d) notFound();
  const ref = await referenceData(actor);
  const sup = d.supplier;
  const problemLabel = (type: string) => (tp.has(`${type}.label`) ? tp(`${type}.label`) : type.replace(/_/g, " "));
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-bold">
          <Name value={sup.businessName} />
        </h1>
        <Badge tone={sup.active ? "green" : "amber"}>{sup.active ? t("active") : t("inactive")}</Badge>
        {d.summary.pendingActivation ? <Badge tone="purple">{t("pending")}</Badge> : null}
      </div>
      <Notice error={error} ok={ok} okNamespace="admin.suppliers" />

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <h2 className="mb-2 font-semibold">{t("profile")}</h2>
          <KV
            items={[
              [t("area"), d.summary.areaName],
              [t("contactName"), sup.contactName ?? "—"],
              [t("contactPhone"), sup.contactPhoneMasked ?? "—"],
              [t("leadTime"), t("days", { n: sup.leadTimeDays })],
              [t("paymentTerms"), sup.paymentTermsNote ?? "—"],
              [t("notes"), sup.notes ?? "—"],
              [t("quality"), d.summary.quality.batches ? `${Math.round(d.summary.quality.share * 100)}% (${d.summary.quality.withIssue}/${d.summary.quality.batches})` : "—"],
            ]}
          />
        </Card>
        <Card>
          <h2 className="mb-2 font-semibold">{sup.active ? t("requestDeactivation") : t("requestActivation")}</h2>
          <p className="mb-3 text-sm text-stone-600">{t("activationNote")}</p>
          {d.summary.pendingActivation ? (
            <p className="rounded-lg bg-stone-100 p-2 text-sm" data-testid="activation-pending">
              {t("pendingNote")}
            </p>
          ) : (
            <form action={requestSupplierActivationAction}>
              <IdemKey />
              <input type="hidden" name="supplierId" value={sup.id} />
              <input type="hidden" name="active" value={sup.active ? "false" : "true"} />
              <button type="submit" className={sup.active ? "btn btn-danger" : "btn btn-primary"} data-testid="request-activation">
                {sup.active ? t("requestDeactivation") : t("requestActivation")}
              </button>
            </form>
          )}
        </Card>
      </div>

      <Card>
        <h2 className="mb-2 font-semibold">{t("edit")}</h2>
        <form action={updateSupplierAction} className="grid gap-3 md:grid-cols-2">
          <IdemKey />
          <input type="hidden" name="supplierId" value={sup.id} />
          <SupplierFields t={t} areas={ref.areas} defaults={sup} />
          <div className="md:col-span-2">
            <PrimaryButton>{t("save")}</PrimaryButton>
          </div>
        </form>
      </Card>

      <Card>
        <h2 className="mb-2 font-semibold">{t("productsTitle")}</h2>
        <p className="mb-3 text-sm text-stone-600">{t("productsNote")}</p>
        <table className="w-full text-sm" data-testid="supplier-products">
          <thead>
            <tr className="text-left text-stone-500">
              <th className="py-2">{tc("product")}</th>
              <th>{t("offered")}</th>
              <th>{t("sku")}</th>
              <th></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {d.products.map((p) => (
              <tr key={p.productId}>
                <td className="py-2">{p.name}</td>
                <td colSpan={3}>
                  <form action={setSupplierProductAction} className="flex flex-wrap items-center gap-2">
                    <IdemKey />
                    <input type="hidden" name="supplierId" value={sup.id} />
                    <input type="hidden" name="productId" value={p.productId} />
                    <label className="flex items-center gap-1">
                      <input type="checkbox" name="offered" defaultChecked={p.offered} /> {t("offered")}
                    </label>
                    <input name="supplierSku" className="field w-40" placeholder={t("sku")} maxLength={40} defaultValue={p.supplierSku ?? ""} />
                    <button type="submit" className="btn btn-secondary">
                      {t("save")}
                    </button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <div className="mb-2 flex items-center justify-between">
            <h2 className="font-semibold">{t("usersTitle")}</h2>
            <Link href="/admin/stakeholders/new" className="text-sm underline">
              {t("addUser")}
            </Link>
          </div>
          <ul className="divide-y divide-stone-100 text-sm">
            {d.users.map((u) => (
              <li key={u.id} className="flex items-center justify-between py-2">
                <Link href={`/admin/stakeholders/${u.id}`} className="underline">
                  <Name value={u.displayName} />
                </Link>
                <span className="font-mono text-stone-500">{u.phoneMasked}</span>
                <Badge tone={u.status === "ACTIVE" ? "green" : "amber"}>{tu(`status.${u.status}`)}</Badge>
              </li>
            ))}
            {d.users.length === 0 ? <li className="py-2 text-stone-500">—</li> : null}
          </ul>
        </Card>
        <Card>
          <h2 className="mb-2 font-semibold">{t("priceLists")}</h2>
          <ul className="divide-y divide-stone-100 text-sm">
            {d.priceLists.map((p) => (
              <li key={p.id} className="flex items-center justify-between py-2">
                <span>
                  {p.areaName} · {t("version")} {p.version}
                </span>
                <span className="text-stone-500">{formatDay(p.effectiveFrom, locale)}</span>
                <Badge tone={p.status === "ACTIVE" ? "green" : "neutral"}>{p.status}</Badge>
              </li>
            ))}
            {d.priceLists.length === 0 ? <li className="py-2 text-stone-500">—</li> : null}
          </ul>
        </Card>
      </div>

      <Card>
        <h2 className="mb-2 font-semibold">{t("pickups")}</h2>
        <table className="w-full text-sm" data-testid="supplier-pickups">
          <thead>
            <tr className="text-left text-stone-500">
              <th className="py-2">{tc("reference")}</th>
              <th>{tc("product")}</th>
              <th>{tc("quantity")}</th>
              <th>{t("rider")}</th>
              <th>{tc("status")}</th>
              <th>{t("pickupDate")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {d.pickups.map((p) => (
              <tr key={p.id}>
                <td className="py-2">
                  <Link href={`/admin/orders/${p.id}`} className="font-mono underline">
                    {p.ref}
                  </Link>
                </td>
                <td>{p.productName}</td>
                <td>{p.quantity}</td>
                <td>{p.riderName}</td>
                <td>{ts.has(p.state) ? ts(p.state) : p.state}</td>
                <td>{p.pickupDate ? formatDay(p.pickupDate, locale) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {d.pickups.length === 0 ? <p className="text-stone-500">{t("noPickups")}</p> : null}
      </Card>

      <Card>
        <h2 className="mb-2 font-semibold">{t("paymentsTitle")}</h2>
        <p className="mb-3 text-sm text-stone-600">{t("confirmedOnly")}</p>
        <div className="mb-3 grid grid-cols-2 gap-3">
          <div className="rounded-xl bg-green-50 p-3">
            <p className="text-xs uppercase text-green-800">{t("thisWeek")}</p>
            <p className="text-xl font-bold text-green-900" data-testid="confirmed-week">
              {formatTzs(d.payments.confirmedWeekTzs, locale)}
            </p>
          </div>
          <div className="rounded-xl bg-green-50 p-3">
            <p className="text-xs uppercase text-green-800">{t("thisMonth")}</p>
            <p className="text-xl font-bold text-green-900" data-testid="confirmed-month">
              {formatTzs(d.payments.confirmedMonthTzs, locale)}
            </p>
          </div>
        </div>
        <table className="w-full text-sm" data-testid="supplier-payments">
          <thead>
            <tr className="text-left text-stone-500">
              <th className="py-2">{t("confirmedAt")}</th>
              <th>{tc("reference")}</th>
              <th>{tc("amount")}</th>
              <th>{t("providerRef")}</th>
              <th>{t("statement")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {d.payments.rows.map((r) => (
              <tr key={r.id}>
                <td className="py-2">{formatDateTime(r.confirmedAt, locale)}</td>
                <td className="font-mono">{r.orderRef}</td>
                <td>{formatTzs(r.amountTzs, locale)}</td>
                <td className="font-mono text-xs">{r.providerTxRef}</td>
                <td>{r.statementMatched ? <Badge tone="green">{t("statementMatched")}</Badge> : <Badge>{t("statementUnmatched")}</Badge>}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {d.payments.rows.length === 0 ? <p className="text-stone-500">{t("noPayments")}</p> : null}
      </Card>

      <Card>
        <h2 className="mb-2 font-semibold">{t("qualityTitle")}</h2>
        <ul className="divide-y divide-stone-100 text-sm" data-testid="supplier-quality">
          {d.quality.map((q) => (
            <li key={q.ref} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span>
                <span className="font-mono">{q.ref}</span> · {problemLabel(q.type)} {q.batchCode ? <span className="text-stone-500">· {q.batchCode}</span> : null}
              </span>
              <span className="text-stone-500">{formatDay(q.createdAt, locale)}</span>
              <Badge tone={q.status === "RESOLVED" ? "green" : "amber"}>{q.status}</Badge>
            </li>
          ))}
        </ul>
        {d.quality.length === 0 ? <p className="text-stone-500">{t("noQuality")}</p> : null}
      </Card>

      <Card>
        <h2 className="mb-2 font-semibold">{t("history")}</h2>
        <ul className="divide-y divide-stone-100 text-sm" data-testid="activation-history">
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
