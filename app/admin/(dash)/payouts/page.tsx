/**
 * Money → Payouts (Prompt L §2): Dandelion's collection account at a glance — what came in, what went out, what
 * should be there, how much of it is members' money and how much is Dandelion's fee — and the withdrawals waiting.
 * One admin approves; a different admin sends the money with the provider's own tools and records its reference.
 */
import { getLocale, getTranslations } from "next-intl/server";
import { Badge, Card, IdemKey } from "@/components/ui";
import { Notice } from "@/components/notice";
import { Name } from "@/components/name";
import { requireAdmin } from "@/lib/auth/current";
import { moneyOverview } from "@/lib/services/wallets";
import { getSetting } from "@/lib/services/core";
import { formatTzs } from "@/lib/money";
import { formatDateTime } from "@/lib/util/time";
import { appEnv } from "@/lib/env";
import { flags, type SearchParams } from "@/lib/actions";
import { approveWithdrawalAction, rejectWithdrawalAction, sendWithdrawalAction } from "../actions";

export const dynamic = "force-dynamic";

export default async function PayoutsPage({ searchParams }: { searchParams: SearchParams }) {
  const { actor } = await requireAdmin();
  const t = await getTranslations("admin.payouts");
  const tr = await getTranslations("roles");
  const locale = (await getLocale()) as "sw" | "en";
  const { error, ok } = await flags(searchParams);
  const m = await moneyOverview(actor);
  const route = String(await getSetting("paymentRoute"));
  const account = String(await getSetting("platformPayeeAccount"));
  const fee = Number(await getSetting("platformFeeTzs"));
  const perPack = String(await getSetting("platformFeeBasis")) !== "ORDER";
  const tzs = (n: number) => formatTzs(n, locale);
  const canSimulate = appEnv() !== "production";
  const tiles: [string, number, string][] = [
    ["inAccount", m.expectedInAccountTzs, "tile-in-account"],
    ["owed", m.owedTzs, "tile-owed"],
    ["fees", m.feesTzs, "tile-fees"],
    ["paidOut", m.paidOutTzs, "tile-paid-out"],
  ];
  return (
    <>
      <header>
        <h1 className="text-2xl font-bold">{t("title")}</h1>
        <p className="text-sm text-stone-600">{t("intro")}</p>
        <p className="mt-1 text-xs text-stone-500" data-testid="payout-settings">
          {route === "PLATFORM" ? t(perPack ? "routePlatformPack" : "routePlatform", { account: account || "—", fee: tzs(fee) }) : t("routeDirect")}
        </p>
      </header>
      <Notice error={error} ok={ok} okNamespace="admin.payouts" />

      <section className="grid grid-cols-2 gap-3 md:grid-cols-4" aria-label={t("summary")}>
        {tiles.map(([k, v, id]) => (
          <Card key={k} className="flex flex-col gap-1">
            <p className="text-xs uppercase tracking-wide text-stone-500">{t(`tiles.${k}`)}</p>
            <p className="text-xl font-bold tabular-nums" data-testid={id}>
              {tzs(v)}
            </p>
            <p className="text-xs text-stone-600">{t(`tilesHint.${k}`)}</p>
          </Card>
        ))}
      </section>

      <Card data-testid="payouts-waiting">
        <h2 className="mb-1 font-semibold">{t("waitingTitle", { approve: m.waiting.toApprove, send: m.waiting.toSend })}</h2>
        <p className="mb-3 text-sm text-stone-600">{t("waitingHint")}</p>
        {m.open.length === 0 ? (
          <p className="rounded-xl bg-green-50 p-3 text-sm text-green-900" data-testid="payouts-none">
            {t("noneWaiting")}
          </p>
        ) : null}
        <ul className="flex flex-col gap-3">
          {m.open.map((w) => (
            <li key={w.id} className="rounded-xl border border-stone-200 p-3" data-testid="payout-row" data-state={w.state}>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="font-medium">
                  <Name value={w.name} /> <span className="text-sm text-stone-500">· {w.role ? tr(w.role) : ""}</span>
                </p>
                <p className="text-lg font-bold tabular-nums">{tzs(w.amountTzs)}</p>
              </div>
              <p className="text-sm text-stone-600">
                <span className="font-mono">{w.ref}</span> · {t("to")} <span className="font-mono">{w.payeeAccount}</span> · {formatDateTime(w.createdAt, locale)}
              </p>
              {w.state === "REQUESTED" ? (
                <div className="mt-2 flex flex-wrap items-end gap-2">
                  <form action={approveWithdrawalAction}>
                    <IdemKey />
                    <input type="hidden" name="withdrawalId" value={w.id} />
                    <button type="submit" className="btn btn-primary w-auto px-4" data-testid="payout-approve">
                      {t("approve")}
                    </button>
                  </form>
                  <RejectForm id={w.id} label={t("reject")} placeholder={t("reasonPlaceholder")} />
                </div>
              ) : w.approvedBy === actor.userId ? (
                <p className="mt-2 rounded-xl bg-brand-50 p-2 text-sm text-brand-900" data-testid="payout-needs-other">
                  {t("needsOther")}
                </p>
              ) : (
                <div className="mt-2 flex flex-wrap items-end gap-2">
                  <form action={sendWithdrawalAction} className="flex flex-wrap items-end gap-2">
                    <IdemKey />
                    <input type="hidden" name="withdrawalId" value={w.id} />
                    <label className="text-sm">
                      <span className="label">{t("providerRef")}</span>
                      <input name="providerRef" className="field" pattern="[A-Za-z0-9-]{4,40}" placeholder="e.g. QK7H2M9P" />
                    </label>
                    <button type="submit" className="btn btn-primary w-auto px-4" data-testid="payout-send">
                      {t("send")}
                    </button>
                    {canSimulate ? (
                      <button type="submit" name="simulate" value="true" className="btn btn-secondary w-auto px-4" data-testid="payout-simulate">
                        {t("simulate")}
                      </button>
                    ) : null}
                  </form>
                  <RejectForm id={w.id} label={t("reject")} placeholder={t("reasonPlaceholder")} />
                </div>
              )}
            </li>
          ))}
        </ul>
      </Card>

      <Card>
        <h2 className="mb-2 font-semibold">{t("membersTitle")}</h2>
        <p className="mb-2 text-sm text-stone-600">{t("membersHint")}</p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm" data-testid="member-balances">
            <thead>
              <tr className="text-left text-stone-500">
                <th className="py-2">{t("member")}</th>
                <th>{t("available")}</th>
                <th>{t("onHold")}</th>
                <th>{t("pending")}</th>
                <th>{t("withdrawn")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {m.members.slice(0, 50).map((x) => (
                <tr key={x.userId}>
                  <td className="py-2">
                    <Name value={x.name} /> <span className="text-xs text-stone-500">{x.role ? tr(x.role) : ""}</span>
                    {x.balance.overdrawn ? (
                      <span className="ml-1">
                        <Badge tone="red">{t("overdrawn")}</Badge>
                      </span>
                    ) : null}
                  </td>
                  <td className="tabular-nums">{tzs(x.balance.availableTzs)}</td>
                  <td className="tabular-nums">{tzs(x.balance.onHoldTzs)}</td>
                  <td className="tabular-nums">{tzs(x.balance.pendingWithdrawalTzs)}</td>
                  <td className="tabular-nums">{tzs(x.balance.withdrawnTzs)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card>
        <h2 className="mb-2 font-semibold">{t("recentTitle")}</h2>
        {m.recent.length === 0 ? <p className="text-sm text-stone-500">{t("noneRecent")}</p> : null}
        <ul className="divide-y divide-stone-100 text-sm">
          {m.recent.map((w) => (
            <li key={w.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span>
                <Name value={w.name} /> · <span className="font-mono">{w.ref}</span> · {tzs(w.amountTzs)}
                <span className="block text-xs text-stone-500">
                  {w.state === "SENT" ? `${t("sentRef")} ${w.providerRef ?? ""} · ${w.sentAt ? formatDateTime(w.sentAt, locale) : ""}` : (w.decidedReason ?? "")}
                </span>
              </span>
              <Badge tone={w.state === "SENT" ? "green" : "red"}>{t(`states.${w.state}`)}</Badge>
            </li>
          ))}
        </ul>
      </Card>
    </>
  );
}

function RejectForm({ id, label, placeholder }: { id: string; label: string; placeholder: string }) {
  return (
    <form action={rejectWithdrawalAction} className="flex flex-wrap items-end gap-2">
      <IdemKey />
      <input type="hidden" name="withdrawalId" value={id} />
      <input name="reason" className="field" minLength={3} maxLength={300} required placeholder={placeholder} aria-label={placeholder} />
      <button type="submit" className="btn btn-secondary w-auto px-4" data-testid="payout-reject">
        {label}
      </button>
    </form>
  );
}
