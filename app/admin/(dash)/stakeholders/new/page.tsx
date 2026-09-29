import { getTranslations } from "next-intl/server";
import { Card, Field, IdemKey, PrimaryButton } from "@/components/ui";
import { Notice } from "@/components/notice";
import { requireAdmin } from "@/lib/auth/current";
import { referenceData } from "@/lib/services/admin";
import { LOGIN_ROLES } from "@/lib/domain/types";
import { flags, type SearchParams } from "@/lib/actions";
import { createUserAction } from "../../actions";

export default async function NewStakeholderPage({ searchParams }: { searchParams: SearchParams }) {
  const { actor } = await requireAdmin();
  const t = await getTranslations("admin.users");
  const tr = await getTranslations("roles");
  const { error } = await flags(searchParams);
  const ref = await referenceData(actor);
  return (
    <>
      <h1 className="text-2xl font-bold">{t("create")}</h1>
      <Notice error={error} />
      <Card>
        <form action={createUserAction} className="grid gap-3 md:grid-cols-2">
          <IdemKey />
          <Field label={t("name")} htmlFor="displayName">
            <input id="displayName" name="displayName" className="field" required minLength={2} maxLength={80} />
          </Field>
          <Field label={t("phone")} htmlFor="phone">
            <input id="phone" name="phone" className="field" inputMode="tel" required />
          </Field>
          <Field label={t("role")} htmlFor="role">
            <select id="role" name="role" className="field" required defaultValue="FIELD_CHAMPION">
              {LOGIN_ROLES.map((r) => (
                <option key={r} value={r}>
                  {tr(r)}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t("area")} htmlFor="serviceAreaId">
            <select id="serviceAreaId" name="serviceAreaId" className="field" defaultValue={ref.areas[0]?.id}>
              <option value="">—</option>
              {ref.areas.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t("hub")} htmlFor="hubId">
            <select id="hubId" name="hubId" className="field" defaultValue="">
              <option value="">—</option>
              {ref.hubs.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t("supplier")} htmlFor="supplierId">
            <select id="supplierId" name="supplierId" className="field" defaultValue="">
              <option value="">—</option>
              {ref.suppliers.map((sup) => (
                <option key={sup.id} value={sup.id}>
                  {sup.businessName}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t("payout")} htmlFor="payoutProvider">
            <select id="payoutProvider" name="payoutProvider" className="field" defaultValue="MPESA">
              {["MPESA", "AIRTEL", "MIXX", "HALOPESA"].map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t("payee")} htmlFor="payeeAccount">
            <input id="payeeAccount" name="payeeAccount" className="field" pattern="[A-Za-z0-9-]{4,32}" />
          </Field>
          <Field label={(await getTranslations("common"))("language")} htmlFor="preferredLocale">
            <select id="preferredLocale" name="preferredLocale" className="field" defaultValue="sw">
              <option value="sw">Kiswahili</option>
              <option value="en">English</option>
            </select>
          </Field>
          <div className="md:col-span-2">
            <PrimaryButton>{t("create")}</PrimaryButton>
          </div>
        </form>
      </Card>
    </>
  );
}
