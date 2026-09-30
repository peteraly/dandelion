import { getLocale, getTranslations } from "next-intl/server";
import { eq } from "drizzle-orm";
import { Badge, Card, LinkButton } from "@/components/ui";
import { Notice } from "@/components/notice";
import { requireAdmin } from "@/lib/auth/current";
import { listPriceLists } from "@/lib/services/pricing";
import { getDb } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import { formatTzs } from "@/lib/money";
import { flags, type SearchParams } from "@/lib/actions";

export default async function PricesPage({ searchParams }: { searchParams: SearchParams }) {
  const { actor } = await requireAdmin();
  const t = await getTranslations("admin.prices");
  const locale = (await getLocale()) as "sw" | "en";
  const { error, ok } = await flags(searchParams);
  const lists = await listPriceLists(actor);
  const db = getDb();
  return (
    <>
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{t("title")}</h1>
        <div className="w-56">
          <LinkButton href="/admin/prices/new">{t("draft")}</LinkButton>
        </div>
      </div>
      <Notice error={error} ok={ok} okNamespace="admin.prices" />
      {await Promise.all(
        lists.map(async (pl) => {
          const items = await db.select({ i: s.priceListItems, p: s.products.name }).from(s.priceListItems).innerJoin(s.products, eq(s.products.id, s.priceListItems.productId)).where(eq(s.priceListItems.priceListId, pl.id));
          return (
            <Card key={pl.id}>
              <div className="flex items-center justify-between">
                <p className="font-semibold">
                  {t("version")} {pl.version} · {t("effectiveFrom")} {pl.effectiveFrom}
                </p>
                <Badge tone={pl.status === "ACTIVE" ? "green" : pl.status === "PENDING_APPROVAL" ? "amber" : "neutral"}>{t(`status.${pl.status}`)}</Badge>
              </div>
              <table className="mt-2 w-full text-sm">
                <thead>
                  <tr className="text-left text-stone-500">
                    <th>Product</th>
                    <th>{t("supplierPrice")}</th>
                    <th>{t("hubPrice")}</th>
                    <th>{t("championPrice")}</th>
                    <th>{t("customerPrice")}</th>
                    <th>{t("organisationPrice")}</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map(({ i, p }) => (
                    <tr key={i.id}>
                      <td>{p}</td>
                      <td>{formatTzs(i.supplierPriceTzs, locale)}</td>
                      <td>{formatTzs(i.hubPriceTzs, locale)}</td>
                      <td>{formatTzs(i.championPriceTzs, locale)}</td>
                      <td>{formatTzs(i.customerPriceTzs, locale)}</td>
                      <td>{i.organisationPriceTzs === null || i.organisationPriceTzs === undefined ? "—" : formatTzs(i.organisationPriceTzs, locale)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          );
        }),
      )}
    </>
  );
}
