/**
 * Shop health (Prompt L §4): is each area's marketplace working? Orders taken and how fast, orders that lapsed
 * (demand nobody met), customers who came back, and sellers holding stock — with one plain sentence on what to do.
 * Below, the customers waiting right now, oldest first, so an admin can call a seller with stock nearby.
 */
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Badge, Card } from "@/components/ui";
import { requireAdmin } from "@/lib/auth/current";
import { marketplaceHealth, type AreaHealth } from "@/lib/services/marketplace";

export const dynamic = "force-dynamic";

const TONE: Record<AreaHealth["verdict"], "green" | "amber" | "red" | "neutral"> = { healthy: "green", quiet: "neutral", unmet: "amber", slow: "amber", noSellers: "red" };

export default async function ShopHealthPage() {
  const { actor } = await requireAdmin();
  const t = await getTranslations("admin.shop");
  const h = await marketplaceHealth(actor);
  const hours = (n: number | null) => (n === null ? "—" : t("hours", { n }));
  return (
    <>
      <header>
        <h1 className="text-2xl font-bold">{t("title")}</h1>
        <p className="text-sm text-stone-600">{t("intro", { days: h.days })}</p>
      </header>
      {h.areas.map((a) => (
        <Card key={a.id} data-testid="shop-area" data-verdict={a.verdict}>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <h2 className="font-semibold">{a.name}</h2>
            <Badge tone={a.shopOpen ? "green" : "neutral"}>{a.shopOpen ? t("open") : t("closed")}</Badge>
            {a.shopOpen ? <span className="text-xs text-stone-500">{a.ridersSell ? t("sellersBoth") : t("sellersWomen")}</span> : null}
          </div>
          <p className={`mb-3 rounded-xl p-2 text-sm ${TONE[a.verdict] === "green" ? "bg-green-50 text-green-900" : TONE[a.verdict] === "red" ? "bg-red-50 text-red-900" : TONE[a.verdict] === "amber" ? "bg-amber-50 text-amber-950" : "bg-stone-50 text-stone-700"}`} data-testid="shop-verdict">
            {a.shopOpen ? t(`verdict.${a.verdict}`) : a.places === 0 ? t("noPlaces") : t("verdict.noSellers")}
          </p>
          <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            {(
              [
                ["requests", String(a.requests)],
                ["accepted", a.acceptedPct === null ? "—" : `${a.acceptedPct}%`],
                ["median", hours(a.medianHoursToAccept)],
                ["expired", String(a.expired)],
                ["waiting", a.waitingNow ? `${a.waitingNow} · ${t("oldest", { h: hours(a.oldestWaitingHours) })}` : "0"],
                ["sellers", String(a.sellersWithStock)],
                ["repeat", a.buyers ? `${a.repeatBuyers} / ${a.buyers}` : "—"],
                ["womenOnly", String(a.womenOnly)],
              ] as const
            ).map(([k, v]) => (
              <div key={k} data-testid={`shop-${k}`}>
                <dt className="text-xs text-stone-600">{t(`stat.${k}`)}</dt>
                <dd className="text-lg font-bold tabular-nums">{v}</dd>
              </div>
            ))}
          </dl>
        </Card>
      ))}
      <Card data-testid="shop-waiting">
        <h2 className="mb-1 font-semibold">{t("waitingTitle", { n: h.waiting.length })}</h2>
        <p className="mb-2 text-sm text-stone-600">{t("waitingHint")}</p>
        {h.waiting.length === 0 ? <p className="text-sm text-stone-500">{t("noneWaiting")}</p> : null}
        <ul className="divide-y divide-stone-100 text-sm">
          {h.waiting.map((w) => (
            <li key={w.id} className="flex flex-wrap items-center justify-between gap-2 py-2" data-testid="shop-waiting-row">
              <span>
                <span className="font-mono">{w.ref}</span> · {w.customerName} · {w.productName}
                <span className="block text-xs text-stone-500">
                  {w.areaName} · {w.placeName}
                  {w.womenOnly ? ` · ${t("womenOnly")}` : ""}
                </span>
              </span>
              <Badge tone={w.hours > 24 ? "red" : w.hours > 12 ? "amber" : "neutral"}>{hours(w.hours)}</Badge>
            </li>
          ))}
        </ul>
      </Card>
      <p className="text-sm">
        <Link href="/admin/areas" className="underline">
          {t("placesLink")}
        </Link>{" "}
        ·{" "}
        <Link href="/admin/exceptions" className="underline">
          {t("reportsLink")}
        </Link>
      </p>
    </>
  );
}
