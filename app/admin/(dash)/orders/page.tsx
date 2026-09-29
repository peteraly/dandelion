import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { Badge, Card, LinkButton } from "@/components/ui";
import { Notice } from "@/components/notice";
import { requireAdmin } from "@/lib/auth/current";
import { recentOrders } from "@/lib/services/admin";
import { formatTzs } from "@/lib/money";
import { flags, type SearchParams } from "@/lib/actions";

export default async function AdminOrdersPage({ searchParams }: { searchParams: SearchParams }) {
  const { actor } = await requireAdmin();
  const t = await getTranslations();
  const locale = (await getLocale()) as "sw" | "en";
  const { error, ok } = await flags(searchParams);
  const rows = await recentOrders(actor);
  return (
    <>
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{t("admin.nav.orders")}</h1>
        <div className="w-56">
          <LinkButton href="/admin/orders/new">{t("admin.pickups.title")}</LinkButton>
        </div>
      </div>
      <Notice error={error} ok={ok} okNamespace="admin.pickups" />
      <Card>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-stone-500">
              <th className="py-2">{t("common.reference")}</th>
              <th>{t("orderKinds.SUPPLIER_TO_RIDER").slice(0, 0)}Kind</th>
              <th>{t("common.product")}</th>
              <th>{t("common.status")}</th>
              <th className="text-right">{t("common.amount")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {rows.map(({ o, product }) => (
              <tr key={o.id}>
                <td className="py-2 font-mono">
                  <Link href={`/admin/orders/${o.id}`} className="underline">
                    {o.ref}
                  </Link>
                </td>
                <td>{t(`orderKinds.${o.kind}`)}</td>
                <td>
                  {product} × {o.quantity}
                </td>
                <td>
                  <Badge tone={o.state === "COMPLETED" ? "green" : o.state === "ON_HOLD" ? "red" : "neutral"}>{o.state.replace(/_/g, " ")}</Badge>
                </td>
                <td className="text-right">{formatTzs(o.totalTzs, locale)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </>
  );
}
