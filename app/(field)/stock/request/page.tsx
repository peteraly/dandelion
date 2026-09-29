import { getLocale, getTranslations } from "next-intl/server";
import { and, eq } from "drizzle-orm";
import { Card, Field, IdemKey, PrimaryButton } from "@/components/ui";
import { Notice } from "@/components/notice";
import { requireField } from "@/lib/auth/current";
import { getDb } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import { flags, type SearchParams } from "@/lib/actions";
import { formatTzs } from "@/lib/money";
import { requestStockAction } from "../../actions";

export const dynamic = "force-dynamic";

export default async function RequestStockPage({ searchParams }: { searchParams: SearchParams }) {
  const { actor } = await requireField();
  const t = await getTranslations("field.requestStock");
  const locale = (await getLocale()) as "sw" | "en";
  const { error } = await flags(searchParams);
  const db = getDb();
  const me = await db.query.users.findFirst({ where: eq(s.users.id, actor.userId) });
  const hub = me?.hubId ? await db.query.hubs.findFirst({ where: eq(s.hubs.id, me.hubId) }) : null;
  const items = hub
    ? await db
        .select({ p: s.products, item: s.priceListItems })
        .from(s.priceListItems)
        .innerJoin(s.priceLists, and(eq(s.priceLists.id, s.priceListItems.priceListId), eq(s.priceLists.status, "ACTIVE"), eq(s.priceLists.serviceAreaId, hub.serviceAreaId)))
        .innerJoin(s.products, eq(s.products.id, s.priceListItems.productId))
    : [];
  return (
    <>
      <h1 className="text-2xl font-bold">{t("title")}</h1>
      <Notice error={error} />
      <Card>
        <form action={requestStockAction} className="flex flex-col gap-3">
          <IdemKey />
          {items.map((r) => (
            <label key={r.p.id} className="check">
              <input type="radio" name="productId" value={r.p.id} required className="mt-1" />
              <span>
                <span className="block font-semibold">{r.p.name}</span>
                <span className="block text-sm text-stone-600">{formatTzs(r.item.championPriceTzs, locale)} / unit</span>
              </span>
            </label>
          ))}
          <Field label={t("quantity")} htmlFor="quantity">
            <input id="quantity" name="quantity" className="field" type="number" inputMode="numeric" min={1} max={500} defaultValue={5} required />
          </Field>
          <PrimaryButton disabled={items.length === 0}>{(await getTranslations("home.action"))("request_stock")}</PrimaryButton>
        </form>
      </Card>
    </>
  );
}
