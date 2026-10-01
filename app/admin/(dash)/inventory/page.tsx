import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Badge, Card } from "@/components/ui";
import { Name } from "@/components/name";
import { requireAdmin } from "@/lib/auth/current";
import { inventoryByCustodian } from "@/lib/services/admin";
import { restockSuggestions, WINDOW_DAYS } from "@/lib/services/replenishment";
import { isLocked } from "@/lib/domain/custody";

export default async function AdminInventoryPage() {
  const { actor } = await requireAdmin();
  const t = await getTranslations();
  const tr = await getTranslations("admin.restock");
  const troads = await getTranslations("admin.roads");
  const rows = await inventoryByCustodian(actor);
  const restock = await restockSuggestions(actor);
  const due = restock.filter((r) => r.suggested > 0);
  return (
    <>
      <h1 className="text-2xl font-bold">{t("admin.nav.inventory")}</h1>
      <Card data-testid="restock">
        <h2 className="font-semibold">{tr("title")}</h2>
        <p className="mb-2 text-sm text-stone-600">{tr("intro", { days: WINDOW_DAYS })}</p>
        {due.length === 0 ? (
          <p className="rounded-xl bg-green-50 p-3 text-sm text-green-900" data-testid="restock-none">
            {tr("none")}
          </p>
        ) : null}
        <ul className="divide-y divide-stone-100">
          {restock.map((r) => (
            <li key={`${r.hubId}|${r.productId}`} className="flex flex-wrap items-center justify-between gap-2 py-2" data-testid="restock-row" data-reason={r.reason}>
              <div className="min-w-0 text-sm">
                <p className="font-medium">
                  <Name value={r.hubName} /> · {r.productName}
                </p>
                <p className="text-stone-600">
                  {tr("line", { onHand: r.onHand, onTheWay: r.onTheWay, perDay: r.dailyDemand.toFixed(1), lead: r.leadTimeDays })} ·{" "}
                  {r.daysOfCover === null ? tr("noSales") : tr("daysLeft", { n: r.daysOfCover })}
                </p>
                {r.road.road || r.road.distanceKm !== null || r.road.lead.source === "measured" ? (
                  <p className="text-xs text-stone-500" data-testid="restock-road">
                    {[r.road.road ? troads(`roadTypes.${r.road.road}`) : null, r.road.distanceKm !== null ? tr("km", { n: r.road.distanceKm }) : null, r.road.rainyNow && r.road.slowInRains ? tr("rainsNow") : null, r.road.lead.source === "measured" ? tr("measuredLead") : null]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                ) : null}
                {r.daysOutOfStock > 0 ? (
                  <p className="text-xs text-amber-800" data-testid="restock-empty-days">
                    {tr("outOfStock", { n: r.daysOutOfStock, window: WINDOW_DAYS })}
                  </p>
                ) : null}
                {r.waiting > 0 ? (
                  <p className="text-xs text-amber-800" data-testid="restock-waiting">
                    {tr("waiting", { n: r.waiting })}
                  </p>
                ) : null}
              </div>
              {r.suggested > 0 ? (
                <Link href={`/admin/orders/new?hub=${r.hubId}&product=${r.productId}&qty=${r.suggested}`} className="btn btn-primary w-auto px-4 text-sm" data-testid="restock-assign">
                  {tr(r.reason === "below_minimum" ? "assignUrgent" : "assign", { n: r.suggested })}
                </Link>
              ) : (
                <Badge tone="green">{tr("ok")}</Badge>
              )}
            </li>
          ))}
        </ul>
      </Card>
      <Card>
        <h2 className="mb-2 font-semibold">{tr("lots")}</h2>
        <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-stone-500">
              <th className="py-2">Batch</th>
              <th>{t("common.product")}</th>
              <th>Custodian</th>
              <th>{t("common.quantity")}</th>
              <th>{t("common.status")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {rows.map(({ batch, product, custodian, role }) => (
              <tr key={batch.id}>
                <td className="py-2 font-mono">{batch.code}</td>
                <td>{product}</td>
                <td>
                  {custodian ?? "—"} {role ? <span className="text-xs text-stone-500">({t(`roles.${role}`)})</span> : null}
                </td>
                <td>{batch.quantity}</td>
                <td>
                  <Badge tone={isLocked(batch.custodyState) ? "red" : "green"}>{batch.custodyState.replace(/_/g, " ")}</Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </Card>
    </>
  );
}
