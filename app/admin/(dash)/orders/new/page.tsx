import { getTranslations } from "next-intl/server";
import { Card, Field, IdemKey, PrimaryButton } from "@/components/ui";
import { Notice } from "@/components/notice";
import { requireAdmin } from "@/lib/auth/current";
import { referenceData } from "@/lib/services/admin";
import { pickupPairs } from "@/lib/services/suppliers";
import { tzDay } from "@/lib/util/time";
import { flags, type SearchParams } from "@/lib/actions";
import { createPickupAction } from "../../actions";

export default async function NewPickupPage({ searchParams }: { searchParams: SearchParams }) {
  const { actor } = await requireAdmin();
  const t = await getTranslations("admin.pickups");
  const tc = await getTranslations("common");
  const tr = await getTranslations("roles");
  const { error } = await flags(searchParams);
  const ref = await referenceData(actor);
  const pairs = await pickupPairs(actor);
  // "Assign pickup" from a restock suggestion (Stock page) arrives with the hub, product and quantity filled in.
  const sp = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
  const hubDefault = ref.hubs.find((h) => h.id === one(sp.hub));
  const areaSuppliers = hubDefault ? new Set(ref.suppliers.filter((x) => x.serviceAreaId === hubDefault.serviceAreaId).map((x) => x.id)) : null;
  const pairDefault = pairs.find((x) => x.productId === one(sp.product) && (!areaSuppliers || areaSuppliers.has(x.supplierId))) ?? pairs[0];
  const qtyDefault = Math.min(10000, Math.max(1, Math.floor(Number(one(sp.qty))) || 10));
  return (
    <>
      <h1 className="text-2xl font-bold">{t("title")}</h1>
      <Notice error={error} />
      <Card>
        <form action={createPickupAction} className="grid gap-3 md:grid-cols-2">
          <IdemKey />
          <Field label={t("pair")} htmlFor="pair" hint={pairs.length === 0 ? t("noPairs") : undefined}>
            <select id="pair" name="pair" className="field md:col-span-2" required defaultValue={pairDefault ? `${pairDefault.supplierId}|${pairDefault.productId}` : ""}>
              {pairs.map((x) => (
                <option key={`${x.supplierId}|${x.productId}`} value={`${x.supplierId}|${x.productId}`}>
                  {x.supplierName} · {x.productName}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t("buyer")} htmlFor="buyerUserId">
            <select id="buyerUserId" name="buyerUserId" className="field" required defaultValue={ref.riders[0]?.id}>
              {ref.riders.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.displayName} · {tr("BOSS_RIDER")}
                </option>
              ))}
              {ref.collectors.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.displayName} · {tr(x.role)}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t("hubOrRiderStock")} htmlFor="hubId">
            <select id="hubId" name="hubId" className="field" defaultValue={hubDefault?.id ?? ref.hubs[0]?.id}>
              {ref.hubs.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
              <option value="">{t("riderKeeps")}</option>
            </select>
          </Field>
          <Field label={tc("quantity")} htmlFor="quantity">
            <input id="quantity" name="quantity" type="number" min={1} max={10000} defaultValue={qtyDefault} className="field" required />
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
