import type { ShopArea } from "@/lib/services/shop";

/** Public meeting points, grouped by area — never an address (Prompt L §3, §3.9). */
export function PlaceSelect({ areas, id, defaultValue, label }: { areas: ShopArea[]; id: string; defaultValue?: string | null; label?: string }) {
  return (
    <select id={id} name="meetingPointId" className="field" required defaultValue={defaultValue ?? ""} aria-label={label}>
      <option value="" disabled>
        —
      </option>
      {areas.map((a) => (
        <optgroup key={a.id} label={`${a.name} (${a.region})`}>
          {a.places.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}
