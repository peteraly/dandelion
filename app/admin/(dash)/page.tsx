/**
 * The admin home, built like the field apps' home: answer first. Three parts —
 * what needs you (only what is above zero, each with a plain sentence and one
 * button), what is happening right now (a few live counts and the way into
 * the live map), and everything else as cards with one line each. Nothing is
 * hidden: every number opens its full list, every page is one click away.
 */
import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { formatEther } from "viem";
import { Card } from "@/components/ui";
import { Name } from "@/components/name";
import { adminNavGroups } from "@/components/admin-nav-groups";
import { requireAdmin } from "@/lib/auth/current";
import { liveSummary, priorities } from "@/lib/services/admin";
import { formatTzs } from "@/lib/money";

/** Most urgent first: a second signature blocks another admin; money questions come before stock. */
const NEEDS = [
  ["pendingApprovals", "/admin/approvals"],
  ["paymentsReview", "/admin/exceptions"],
  ["openExceptions", "/admin/exceptions"],
  ["reconFlags", "/admin/reconciliation"],
  ["lowStockHubs", "/admin/inventory"],
  ["deliveriesInspection", "/admin/orders"],
  ["alerts24h", "/admin/logs"],
] as const;

export default async function AdminHome() {
  const { actor, session } = await requireAdmin();
  const t = await getTranslations("admin.home");
  const locale = (await getLocale()) as "sw" | "en";
  const [p, live, groups] = await Promise.all([priorities(actor), liveSummary(actor), adminNavGroups()]);
  const needs = NEEDS.map(([k, href]) => ({ k, href, n: p[k] })).filter((x) => x.n > 0);
  const stats: [string, string][] = [
    ["road", String(live.road)],
    ["leaving", String(live.leaving)],
    ["paying", String(live.paying)],
    ["paidHour", formatTzs(live.paidHourTzs, locale)],
    ["plans", String(live.plans)],
    ["events", String(live.events)],
  ];
  return (
    <>
      <header>
        <h1 className="text-2xl font-bold">{t("title")}</h1>
        <p className="text-sm text-stone-600">
          <Name value={session.user.displayName} /> · {t("intro")}
        </p>
      </header>

      <section aria-labelledby="needs-you" data-testid="needs-you">
        <h2 id="needs-you" className="mb-2 text-lg font-semibold">
          {t("needsYou")}
        </h2>
        {needs.length === 0 ? (
          <p className="rounded-2xl border border-green-200 bg-green-50 p-4 text-green-900" data-testid="needs-all-clear">
            <span aria-hidden="true">✓ </span>
            {t("allClear")}
          </p>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {needs.map(({ k, href, n }) => (
              <li key={k}>
                <Card className="flex h-full items-center justify-between gap-3 border-amber-200 bg-amber-50" data-testid={`need-${k}`}>
                  <div className="min-w-0">
                    <p className="font-semibold">
                      <span className="mr-2 text-2xl font-bold tabular-nums" data-testid={`need-${k}-count`}>
                        {n}
                      </span>
                      {t(`need.${k}.title`)}
                    </p>
                    <p className="text-sm text-stone-700">{t(`need.${k}.hint`)}</p>
                  </div>
                  <Link href={href} className="btn btn-primary w-auto shrink-0 px-4 text-base">
                    {t("open")}
                  </Link>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="live-now" data-testid="live-now">
        <h2 id="live-now" className="mb-2 text-lg font-semibold">
          {t("liveNow")}
        </h2>
        <Card className="flex flex-col gap-3">
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {stats.map(([k, v]) => (
              <div key={k} data-testid={`live-${k}`}>
                <dt className="text-xs text-stone-600">{t(`stat.${k}`)}</dt>
                <dd className="text-xl font-bold tabular-nums">{v}</dd>
              </div>
            ))}
          </dl>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-stone-100 pt-3">
            <p className="text-sm text-stone-700">{t("mapWhat")}</p>
            <Link href="/admin/ecosystem" className="btn btn-primary w-auto px-5 text-base" data-testid="open-live-map">
              {t("openMap")} →
            </Link>
          </div>
        </Card>
      </section>

      <section aria-labelledby="everything" data-testid="everything">
        <h2 id="everything" className="mb-2 text-lg font-semibold">
          {t("everything")}
        </h2>
        <div className="flex flex-col gap-4">
          {groups.map((g) => {
            const items = g.items.filter((it) => it.href !== "/admin");
            if (!items.length) return null;
            return (
              <div key={g.heading}>
                <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-stone-500">{g.heading}</h3>
                <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {items.map((it) => (
                    <li key={it.href}>
                      <Link href={it.href} className="flex h-full flex-col rounded-2xl border border-stone-200 bg-white p-3 hover:border-brand-600 hover:bg-brand-50" data-testid="home-card">
                        <span className="font-semibold">{it.label} →</span>
                        <span className="text-sm text-stone-600">{it.hint}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      </section>

      <p className="text-xs text-stone-600" data-testid="record-status">
        <span className="font-medium">{t("record")}:</span> {t("recordLine", { count: p.ledgerUnanchored })} ·{" "}
        {t("wallet", { status: p.wallet.configured ? `${p.wallet.balanceWei === null ? "?" : formatEther(p.wallet.balanceWei)} CELO (${p.wallet.network})` : t("walletOff") })}
      </p>
    </>
  );
}
