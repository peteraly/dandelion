import { Field } from "@/components/ui";

type T = (key: string) => string;

/** The supplier reference-data fields, shared by "add" and "edit". Nothing about health; one optional business contact. */
export function SupplierFields({ t, areas, defaults }: { t: T; areas: { id: string; name: string }[]; defaults?: { businessName?: string; serviceAreaId?: string | null; contactName?: string | null; leadTimeDays?: number; paymentTermsNote?: string | null; notes?: string | null } }) {
  const d = defaults ?? {};
  return (
    <>
      <Field label={t("name")} htmlFor="businessName">
        <input id="businessName" name="businessName" className="field" required minLength={2} maxLength={120} defaultValue={d.businessName ?? ""} />
      </Field>
      <Field label={t("area")} htmlFor="serviceAreaId">
        <select id="serviceAreaId" name="serviceAreaId" className="field" required defaultValue={d.serviceAreaId ?? areas[0]?.id}>
          {areas.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label={t("contactName")} htmlFor="contactName">
        <input id="contactName" name="contactName" className="field" maxLength={80} defaultValue={d.contactName ?? ""} />
      </Field>
      <Field label={t("contactPhone")} htmlFor="contactPhone" hint={t("contactPhoneHint")}>
        <input id="contactPhone" name="contactPhone" className="field" inputMode="tel" maxLength={20} />
      </Field>
      <Field label={t("leadTime")} htmlFor="leadTimeDays">
        <input id="leadTimeDays" name="leadTimeDays" type="number" min={0} max={60} className="field" defaultValue={d.leadTimeDays ?? 2} required />
      </Field>
      <Field label={t("paymentTerms")} htmlFor="paymentTermsNote">
        <input id="paymentTermsNote" name="paymentTermsNote" className="field" maxLength={200} defaultValue={d.paymentTermsNote ?? ""} />
      </Field>
      <div className="md:col-span-2">
        <Field label={t("notes")} htmlFor="notes">
          <textarea id="notes" name="notes" className="field" rows={2} maxLength={1000} defaultValue={d.notes ?? ""} />
        </Field>
      </div>
    </>
  );
}
