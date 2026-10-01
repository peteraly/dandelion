/**
 * Areas and their sale paths (prompt §8.8.2). The ladder is always allowed;
 * anything else is a per-area switch that two admins turn on, because it
 * decides who earns. The request goes to the approvals inbox.
 *
 * Roads and rains (Prompt I §2.1): per area, the months the rains slow the
 * roads; per hub, its distance from the district town, the worst stretch of
 * road and whether the rains slow it — with the lead time restocking now plans
 * for, and what real trips took.
 *
 * Meeting points (Prompt L §3): the named public places where delivery partners hand over shop orders.
 */
import { getLocale, getTranslations } from "next-intl/server";
import { Badge, Card, IdemKey, PrimaryButton } from "@/components/ui";
import { Notice } from "@/components/notice";
import { Name } from "@/components/name";
import { requireAdmin } from "@/lib/auth/current";
import { getDb } from "@/lib/db/client";
import { listAreasWithSales, meetingPointsFor } from "@/lib/services/areas";
import { hubRoads } from "@/lib/services/replenishment";
import { DIRECT_KINDS } from "@/lib/domain/sales";
import { ROAD_TYPES } from "@/lib/domain/types";
import { flags, type SearchParams } from "@/lib/actions";
import { addMeetingPointAction, requestAreaSalesAction, setMeetingPointActiveAction, setMeetingPointWhenAction, updateAreaRainsAction, updateHubRoadAction } from "../actions";

const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);
const monthName = (m: number, locale: string) => new Intl.DateTimeFormat(locale === "sw" ? "sw-TZ" : "en-GB", { month: "short", timeZone: "UTC" }).format(new Date(Date.UTC(2026, m - 1, 15)));

export const dynamic = "force-dynamic";

export default async function AreasPage({ searchParams }: { searchParams: SearchParams }) {
  const { actor } = await requireAdmin();
  const t = await getTranslations("admin.areas");
  const tk = await getTranslations("orderKinds");
  const tr = await getTranslations("admin.roads");
  const locale = await getLocale();
  const { error, ok } = await flags(searchParams);
  const rows = await listAreasWithSales(actor);
  const areas = await getDb().query.serviceAreas.findMany();
  const roads = [...(await hubRoads()).values()];
  const places = await meetingPointsFor(getDb(), undefined, true);
  const tp = await getTranslations("admin.places");
  // Days to whole days or hours, in plain words.
  const span = (days: number) => (days < 1 ? tr("hours", { n: Math.max(1, Math.round(days * 24)) }) : tr("days", { n: Math.round(days * 10) / 10 }));
  return (
    <>
      <h1 className="text-2xl font-bold">{t("title")}</h1>
      <p className="text-sm text-stone-600">{t("intro")}</p>
      <p className="text-sm text-stone-600">{t("decision")}</p>
      <Notice error={error} ok={ok} okNamespace="admin.areas" />
      {rows.map((a) => (
        <Card key={a.id} data-testid="area-card">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <h2 className="font-semibold">{a.name}</h2>
            <span className="text-sm text-stone-500">{a.region}</span>
            {a.pendingRequest ? <Badge tone="purple">{t("pending")}</Badge> : null}
          </div>
          <p className="mb-3 text-sm" data-testid="area-allowed">
            {t("allowed")}: {a.allowedSales.length ? a.allowedSales.map((k) => tk(k)).join(" · ") : t("ladderOnly")}
          </p>
          <form action={requestAreaSalesAction} className="flex flex-col gap-2">
            <IdemKey />
            <input type="hidden" name="serviceAreaId" value={a.id} />
            {DIRECT_KINDS.map((k) => (
              <label key={k} className="check">
                <input type="checkbox" name={`path_${k}`} value="true" defaultChecked={a.allowedSales.includes(k)} className="mt-0.5" />
                <span>
                  {t(`paths.${k}`)} <span className="block text-xs text-stone-500">{tk(k)}</span>
                </span>
              </label>
            ))}
            <div className="md:w-64">
              <PrimaryButton disabled={a.pendingRequest}>{t("request")}</PrimaryButton>
            </div>
          </form>

          <div className="mt-4 border-t border-stone-200 pt-3" data-testid="area-places">
            <h3 className="font-semibold">{tp("title")}</h3>
            <p className="mb-2 text-sm text-stone-600">{tp("intro")} {a.allowedSales.includes("RIDER_TO_CUSTOMER") ? tp("ridersOn") : tp("ridersOff")}</p>
            <ul className="mb-2 flex flex-col gap-2">
              {places
                .filter((p) => p.serviceAreaId === a.id)
                .map((p) => (
                  <li key={p.id} className="flex flex-wrap items-center gap-2 rounded-xl border border-stone-200 p-2 text-sm" data-testid="meeting-point" data-active={p.active}>
                    <span className={`min-w-0 flex-1 ${p.active ? "font-medium" : "text-stone-400 line-through"}`}>
                      {p.name}
                      <span className="block text-xs font-normal text-stone-500">{p.whenText ?? tp("noWhen")}</span>
                    </span>
                    <form action={setMeetingPointWhenAction} className="flex items-center gap-1">
                      <IdemKey />
                      <input type="hidden" name="meetingPointId" value={p.id} />
                      <input name="when" className="field w-48 py-1 text-xs" maxLength={60} defaultValue={p.whenText ?? ""} placeholder={tp("whenPlaceholder")} aria-label={tp("when")} />
                      <button type="submit" className="rounded-full px-2 py-0.5 text-xs text-brand-800 underline">
                        {tp("saveWhen")}
                      </button>
                    </form>
                    <form action={setMeetingPointActiveAction}>
                      <IdemKey />
                      <input type="hidden" name="meetingPointId" value={p.id} />
                      <input type="hidden" name="active" value={p.active ? "false" : "true"} />
                      <button type="submit" className="rounded-full px-2 py-0.5 text-xs text-brand-800 underline">
                        {p.active ? tp("retire") : tp("restore")}
                      </button>
                    </form>
                  </li>
                ))}
            </ul>
            <form action={addMeetingPointAction} className="flex flex-wrap items-end gap-2" data-testid="place-form">
              <IdemKey />
              <input type="hidden" name="serviceAreaId" value={a.id} />
              <label className="text-sm">
                <span className="label">{tp("name")}</span>
                <input name="name" className="field" minLength={3} maxLength={60} required placeholder={tp("placeholder")} />
              </label>
              <label className="text-sm">
                <span className="label">{tp("when")}</span>
                <input name="when" className="field" maxLength={60} placeholder={tp("whenPlaceholder")} />
              </label>
              <button type="submit" className="btn btn-secondary w-auto px-4 text-sm">
                {tp("add")}
              </button>
            </form>
            <p className="mt-1 text-xs text-stone-500">{tp("rule")}</p>
          </div>

          <div className="mt-4 border-t border-stone-200 pt-3" data-testid="area-roads">
            <h3 className="font-semibold">{tr("title")}</h3>
            <p className="mb-2 text-sm text-stone-600">{tr("intro")}</p>
            <form action={updateAreaRainsAction} className="flex flex-col gap-2" data-testid="rains-form">
              <IdemKey />
              <input type="hidden" name="serviceAreaId" value={a.id} />
              <fieldset>
                <legend className="label">{tr("rainyMonths")}</legend>
                <div className="grid grid-cols-4 gap-1 sm:grid-cols-6 md:grid-cols-12">
                  {MONTHS.map((m) => (
                    <label key={m} className="check text-sm">
                      <input type="checkbox" name={`month_${m}`} value="true" defaultChecked={(areas.find((x) => x.id === a.id)?.rainyMonths ?? []).includes(m)} className="mt-0.5" />
                      <span>{monthName(m, locale)}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
              <div className="md:w-64">
                <PrimaryButton>{tr("saveRains")}</PrimaryButton>
              </div>
            </form>
            <ul className="mt-3 flex flex-col gap-3">
              {roads
                .filter((h) => h.areaId === a.id)
                .map((h) => (
                  <li key={h.hubId} className="rounded-xl border border-stone-200 p-3" data-testid="hub-road" data-source={h.lead.source}>
                    <p className="font-medium">
                      <Name value={h.hubName} />
                    </p>
                    <p className="text-sm text-stone-700" data-testid="hub-lead">
                      {tr("plansFor", { n: h.lead.days })} {h.rainyNow && h.slowInRains ? <Badge tone="amber">{tr("rainsNow")}</Badge> : null}
                    </p>
                    <p className="text-xs text-stone-600">
                      {h.lead.measuredDays === null ? tr("tooFewTrips", { n: h.lead.trips }) : tr("measured", { trips: h.lead.trips, span: span(h.lead.measuredDays) })}
                      {h.roadDaysTypical !== null ? ` · ${tr("onTheRoad", { span: span(h.roadDaysTypical) })}` : ""}
                      {h.lead.source === "measured" ? ` · ${tr("slowerThanPlan", { n: h.lead.plannedDays })}` : ""}
                    </p>
                    <form action={updateHubRoadAction} className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-[8rem_10rem_1fr_auto] sm:items-end">
                      <IdemKey />
                      <input type="hidden" name="hubId" value={h.hubId} />
                      <label className="text-sm">
                        <span className="label">{tr("distance")}</span>
                        <input type="number" name="distanceKm" min={0} max={2000} step={1} inputMode="numeric" defaultValue={h.distanceKm ?? ""} className="field" />
                      </label>
                      <label className="text-sm">
                        <span className="label">{tr("road")}</span>
                        <select name="road" defaultValue={h.road ?? ""} className="field">
                          <option value="">{tr("roadUnknown")}</option>
                          {ROAD_TYPES.map((r) => (
                            <option key={r} value={r}>
                              {tr(`roadTypes.${r}`)}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="check text-sm sm:pb-2">
                        <input type="checkbox" name="slowInRains" value="true" defaultChecked={h.slowInRains} className="mt-0.5" />
                        <span>{tr("slowInRains")}</span>
                      </label>
                      <button type="submit" className="btn btn-secondary w-auto px-4 text-sm">
                        {tr("save")}
                      </button>
                    </form>
                  </li>
                ))}
            </ul>
          </div>
        </Card>
      ))}
    </>
  );
}
