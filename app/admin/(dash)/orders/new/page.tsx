import { getTranslations } from "next-intl/server";
import { Card, Field, IdemKey, PrimaryButton } from "@/components/ui";
import { Notice } from "@/components/notice";
import { requireAdmin } from "@/lib/auth/current";
import { referenceData } from "@/lib/services/admin";
import { tzDay } from "@/lib/util/time";
import { flags, type SearchParams } from "@/lib/actions";
import { createPickupAction } from "../../actions";

export default async function NewPickupPage({ searchParams }: { searchParams: SearchParams }) {
  const { actor } = await requireAdmin();
  const t = await getTranslations("admin.pickups");
  const tc = await getTranslations("common");
  const { error } = await flags(searchParams);
  const ref = await referenceData(actor);
  return (
    <>
      <h1 className="text-2xl font-bold">{t("title")}</h1>
      <Notice error={error} />
      <Card>
        <form action={createPickupAction} className="grid gap-3 md:grid-cols-2">
          <IdemKey />
          <Field label={(await getTranslations("admin.users"))("supplier")} htmlFor="supplierId">
            <select id="supplierId" name="supplierId" className="field" required defaultValue={ref.suppliers[0]?.id}>
              {ref.suppliers.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.businessName}
                </option>
              ))}
            </select>
          </Field>
          <Field label={tc("product")} htmlFor="productId">
            <select id="productId" name="productId" className="field" required defaultValue={ref.products[0]?.id}>
              {ref.products.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label={(await getTranslations("admin.users"))("hub")} htmlFor="hubId">
            <select id="hubId" name="hubId" className="field" required defaultValue={ref.hubs[0]?.id}>
              {ref.hubs.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t("rider")} htmlFor="riderId">
            <select id="riderId" name="riderId" className="field" required defaultValue={ref.riders[0]?.id}>
              {ref.riders.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.displayName}
                </option>
              ))}
            </select>
          </Field>
          <Field label={tc("quantity")} htmlFor="quantity">
            <input id="quantity" name="quantity" type="number" min={1} max={10000} defaultValue={10} className="field" required />
          </Field>
          <Field label={t("date")} htmlFor="pickupDate">
            <input id="pickupDate" name="pickupDate" type="date" defaultValue={tzDay()} className="field" required />
          </Field>
          <div className="md:col-span-2">
            <PrimaryButton>{t("title")}</PrimaryButton>
          </div>
        </form>
      </Card>
    </>
  );
}
