import { getTranslations } from "next-intl/server";
import { Card, Field, IdemKey, PrimaryButton } from "@/components/ui";
import { Notice } from "@/components/notice";
import { requireAdmin } from "@/lib/auth/current";
import { referenceData } from "@/lib/services/admin";
import { tzDay } from "@/lib/util/time";
import { flags, type SearchParams } from "@/lib/actions";
import { draftPriceListAction } from "../../actions";

export default async function NewPriceListPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const { actor } = await requireAdmin();
  const t = await getTranslations("admin.prices");
  const tu = await getTranslations("admin.users");
  const { error } = await flags(searchParams);
  const ref = await referenceData(actor);
  return (
    <>
      <h1 className="text-2xl font-bold">{t("draft")}</h1>
      <Notice error={error} />
      <Card>
        <form action={draftPriceListAction} className="flex flex-col gap-3">
          <IdemKey />
          <div className="grid gap-3 md:grid-cols-3">
            <Field label={tu("area")} htmlFor="serviceAreaId">
              <select
                id="serviceAreaId"
                name="serviceAreaId"
                className="field"
                required
                defaultValue={ref.areas[0]?.id}
              >
                {ref.areas.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={tu("supplier")} htmlFor="supplierId">
              <select
                id="supplierId"
                name="supplierId"
                className="field"
                required
                defaultValue={ref.suppliers[0]?.id}
              >
                {ref.suppliers.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.businessName}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t("effectiveFrom")} htmlFor="effectiveFrom">
              <input
                id="effectiveFrom"
                name="effectiveFrom"
                type="date"
                className="field"
                required
                defaultValue={tzDay()}
              />
            </Field>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
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
                {ref.products.map((p) => (
                  <tr key={p.id}>
                    <td>
                      {p.name}
                      <input type="hidden" name="productId" value={p.id} />
                    </td>
                    {(
                      [
                        "supplierPriceTzs",
                        "hubPriceTzs",
                        "championPriceTzs",
                        "customerPriceTzs",
                      ] as const
                    ).map((k) => (
                      <td key={k} className="p-1">
                        <input
                          name={k}
                          type="number"
                          min={0}
                          step={1}
                          className="field"
                          required
                          aria-label={`${p.name} ${k}`}
                        />
                      </td>
                    ))}
                    {/* Optional: organisations can only be sold to once the area has decided what they pay (prompt §8.8.6). */}
                    <td className="p-1">
                      <input
                        name="organisationPriceTzs"
                        type="number"
                        min={0}
                        step={1}
                        className="field"
                        aria-label={`${p.name} organisationPriceTzs`}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <PrimaryButton>{t("draft")}</PrimaryButton>
        </form>
      </Card>
    </>
  );
}
