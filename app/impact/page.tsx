/**
 * Impact (Prompt L §4.3): what anyone may see — what was delivered, how fast, where the money went, and the public
 * record that proves the history was not rewritten. District totals only; counts under 10 are hidden, so no person
 * can be picked out. Funders and partners read this instead of asking for spreadsheets.
 */
import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { PublicShell } from "@/components/shell";
import { Card } from "@/components/ui";
import { publicImpact } from "@/lib/services/marketplace";
import { formatTzs } from "@/lib/money";
import { formatDateTime } from "@/lib/util/time";

export const dynamic = "force-dynamic";

export default async function ImpactPage() {
  const t = await getTranslations("impact");
  const tp = await getTranslations("public");
  const locale = (await getLocale()) as "sw" | "en";
  // The public page must not fail when the database is unreachable (e.g. a fresh preview).
  const d = await publicImpact().catch(() => null);
  const n = (v: number | null) => (v === null ? tp("fewerThan10") : v.toLocaleString(locale === "sw" ? "sw-TZ" : "en-GB"));
  const tzs = (v: number) => formatTzs(v, locale);
  return (
    <PublicShell path="/impact">
      <h1 className="text-2xl font-bold">{t("title")}</h1>
      <p>{t("intro")}</p>
      {!d ? (
        <p className="text-stone-500">{tp("statsUnavailable")}</p>
      ) : (
        <>
          <Card data-testid="impact-delivered">
            <h2 className="mb-2 text-lg font-semibold">{t("delivered")}</h2>
            <dl className="grid grid-cols-2 gap-2">
              <dt className="text-stone-600">{t("handoversAll")}</dt>
              <dd className="text-right font-semibold" data-testid="impact-handovers">
                {n(d.handovers.all)}
              </dd>
              <dt className="text-stone-600">{t("handovers30")}</dt>
              <dd className="text-right font-semibold">{n(d.handovers.last30)}</dd>
              {d.handovers.byCategory.map((c) => (
                <div key={c.category} className="contents">
                  <dt className="pl-3 text-sm text-stone-600">{t(`category.${c.category}`)}</dt>
                  <dd className="text-right text-sm">{n(c.n)}</dd>
                </div>
              ))}
              <dt className="text-stone-600">{t("orgPacks")}</dt>
              <dd className="text-right font-semibold">{n(d.organisations.packs)}</dd>
              <dt className="text-stone-600">{t("median")}</dt>
              <dd className="text-right font-semibold">{d.medianDaysToHandover === null ? "—" : t("days", { n: d.medianDaysToHandover })}</dd>
              <dt className="text-stone-600">{t("sellers")}</dt>
              <dd className="text-right font-semibold">{n(d.sellers)}</dd>
              <dt className="text-stone-600">{t("areas")}</dt>
              <dd className="text-right font-semibold">{d.areasServed}</dd>
            </dl>
          </Card>
          <Card data-testid="impact-money">
            <h2 className="mb-2 text-lg font-semibold">{t("money")}</h2>
            <dl className="grid grid-cols-2 gap-2">
              <dt className="text-stone-600">{t("paidByBuyers")}</dt>
              <dd className="text-right font-semibold">{tzs(d.money.paidByBuyersTzs)}</dd>
              <dt className="text-stone-600">{t("paidOut")}</dt>
              <dd className="text-right font-semibold">{d.money.paidOutToMembersTzs === null ? tp("fewerThan10") : tzs(d.money.paidOutToMembersTzs)}</dd>
              <dt className="text-stone-600">{t("fees")}</dt>
              <dd className="text-right font-semibold">{tzs(d.money.feesTzs)}</dd>
            </dl>
            <p className="mt-2 text-sm text-stone-600">{t("moneyNote")}</p>
          </Card>
          <Card data-testid="impact-record">
            <h2 className="mb-2 text-lg font-semibold">{t("record")}</h2>
            {d.record.anchors === 0 ? (
              <p className="text-sm text-stone-600">{t("recordNone")}</p>
            ) : (
              <p className="text-sm">
                {t("recordLine", { anchors: d.record.anchors, events: d.record.eventsAnchored })}
                {d.record.lastRoot ? <span className="mt-1 block break-all font-mono text-xs">{d.record.lastRoot}</span> : null}
                {d.record.lastAt ? <span className="block text-xs text-stone-500">{formatDateTime(d.record.lastAt, locale)}</span> : null}
              </p>
            )}
            <p className="mt-2 text-sm text-stone-600">{t("recordNote")}</p>
          </Card>
        </>
      )}
      <p className="text-sm text-stone-600">{t("privacy")}</p>
      <Link href="/shop" className="btn btn-secondary">
        {tp("shopCta")}
      </Link>
    </PublicShell>
  );
}
