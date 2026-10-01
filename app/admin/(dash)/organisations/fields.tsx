import { Field } from "@/components/ui";
import { ORGANISATION_KINDS } from "@/lib/domain/types";

type T = (key: string) => string;

/** Organisation reference data (prompt §8.8.4): a name, a type, an area, one contact. Nothing about the people it serves. */
export function OrganisationFields({ t, areas, defaults, statusLocked }: { t: T; areas: { id: string; name: string }[]; defaults?: { name?: string; kind?: string; serviceAreaId?: string | null; contactName?: string | null; womenOwned?: boolean; notes?: string | null }; statusLocked?: boolean }) {
  const d = defaults ?? {};
  return (
    <>
      <Field label={t("name")} htmlFor="name">
        <input id="name" name="name" className="field" required minLength={2} maxLength={120} defaultValue={d.name ?? ""} />
      </Field>
      <Field label={t("kind")} htmlFor="kind">
        <select id="kind" name="kind" className="field" required defaultValue={d.kind ?? "NGO"}>
          {ORGANISATION_KINDS.map((k) => (
            <option key={k} value={k}>
              {t(`kinds.${k}`)}
            </option>
          ))}
        </select>
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
      <Field label={t("contactPhone")} htmlFor="contactPhone">
        <input id="contactPhone" name="contactPhone" className="field" inputMode="tel" required maxLength={20} />
      </Field>
      <div className="md:col-span-2">
        <label className="check">
          {/* A confirmed status cannot change while the organisation is active; the box keeps its value so the form still submits it. */}
          <input type="checkbox" name="womenOwned" value="true" defaultChecked={d.womenOwned ?? false} className="mt-0.5" disabled={statusLocked} />
          {statusLocked && d.womenOwned ? <input type="hidden" name="womenOwned" value="true" /> : null}
          <span>
            {t("womenOwned")} <span className="block text-xs text-stone-500">{statusLocked ? t("womenOwnedLocked") : t("womenOwnedHint")}</span>
          </span>
        </label>
      </div>
      <div className="md:col-span-2">
        <Field label={t("notes")} htmlFor="notes">
          <textarea id="notes" name="notes" className="field" rows={2} maxLength={1000} defaultValue={d.notes ?? ""} />
        </Field>
      </div>
    </>
  );
}
