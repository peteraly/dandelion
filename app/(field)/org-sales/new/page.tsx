/**
 * Sell to an organisation (prompt §8.8.4): a seller with stock — supplier,
 * hub manager or rider — creates a bulk order for an active organisation in
 * their area. The organisation pays the full amount by mobile money first;
 * delivery is confirmed on the order page.
 */
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { eq } from "drizzle-orm";
import { Card, Field, IdemKey, PrimaryButton } from "@/components/ui";
import { Notice } from "@/components/notice";
import { requireField } from "@/lib/auth/current";
import { can } from "@/lib/policy";
import { getDb } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import { directSalesFor, sellerAreaId } from "@/lib/services/areas";
import { organisationsForSale } from "@/lib/services/organisations";
import { flags, type SearchParams } from "@/lib/actions";
import { createOrgSaleAction } from "../../actions";

export const dynamic = "force-dynamic";

/** The area a seller works in: their hub's, their supplier's, or their own. */
export default async function NewOrgSalePage({ searchParams }: { searchParams: SearchParams }) {
  const { actor } = await requireField();
  if (!can(actor, "order.org_sale.create")) notFound();
  const t = await getTranslations("field.orgSale");
  const tk = await getTranslations("admin.organisations.kinds");
  const { error } = await flags(searchParams);
  const areaId = await sellerAreaId(actor);
  const allowed = await directSalesFor(getDb(), actor, areaId);
  if (!allowed.toOrganisations) notFound();
  const orgs = areaId ? await organisationsForSale(getDb(), areaId) : [];
  const products = await getDb().query.products.findMany({ where: eq(s.products.active, true), orderBy: s.products.name });
  return (
    <>
      <h1 className="text-2xl font-bold">{t("title")}</h1>
      <p className="text-sm text-stone-700">{t("note")}</p>
      <Notice error={error} />
      {orgs.length === 0 ? (
        <Card>
          <p className="text-stone-600" data-testid="no-organisations">
            {t("none")}
          </p>
        </Card>
      ) : (
        <Card>
          <form action={createOrgSaleAction} className="flex flex-col gap-3">
            <IdemKey />
            <Field label={t("organisation")} htmlFor="organisationId">
              <select id="organisationId" name="organisationId" className="field" required>
                {orgs.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name} · {tk(o.kind)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t("product")} htmlFor="productId">
              <select id="productId" name="productId" className="field" required>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t("quantity")} htmlFor="quantity">
              <input id="quantity" name="quantity" type="number" min={1} max={10000} defaultValue={20} className="field" required />
            </Field>
            <PrimaryButton>{t("create")}</PrimaryButton>
          </form>
        </Card>
      )}
    </>
  );
}
