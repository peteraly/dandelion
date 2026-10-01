/**
 * A member's wallet (Prompt L §2): what Dandelion holds for them — available to withdraw, on hold until the goods
 * are handed over, waiting to be sent — and their withdrawals. They choose when to withdraw; admins send the money
 * to the payout number an admin registered for them.
 */
import { getLocale, getTranslations } from "next-intl/server";
import { Badge, Card, Field, IdemKey, PrimaryButton } from "@/components/ui";
import { Notice } from "@/components/notice";
import { requireField } from "@/lib/auth/current";
import { myWallet } from "@/lib/services/wallets";
import { formatTzs } from "@/lib/money";
import { formatDateTime } from "@/lib/util/time";
import { flags, type SearchParams } from "@/lib/actions";
import { requestWithdrawalAction } from "../actions";

export const dynamic = "force-dynamic";

const TONE = { REQUESTED: "amber", APPROVED: "purple", SENT: "green", REJECTED: "red" } as const;

export default async function WalletPage({ searchParams }: { searchParams: SearchParams }) {
  const { actor } = await requireField();
  const t = await getTranslations("field.wallet");
  const locale = (await getLocale()) as "sw" | "en";
  const { error, ok } = await flags(searchParams);
  const w = await myWallet(actor);
  const tzs = (n: number) => formatTzs(n, locale);
  const canAsk = w.platformCollects && w.pendingWithdrawalTzs === 0 && w.availableTzs >= w.minTzs && !!w.payoutTo;
  return (
    <>
      <header>
        <h1 className="text-2xl font-bold">{t("title")}</h1>
        <p className="text-sm text-stone-600">{t("intro")}</p>
      </header>
      <Notice error={error} ok={ok} okNamespace="field.wallet" />
      <Card className="border-green-200 bg-green-50" data-testid="wallet-balance">
        <p className="text-xs uppercase tracking-wide text-green-800">{t("available")}</p>
        <p className="text-3xl font-bold text-green-900" data-testid="wallet-available">
          {tzs(w.availableTzs)}
        </p>
        <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
          <div>
            <dt className="text-stone-600">{t("onHold")}</dt>
            <dd className="font-semibold" data-testid="wallet-on-hold">
              {tzs(w.onHoldTzs)}
            </dd>
          </div>
          <div>
            <dt className="text-stone-600">{t("pending")}</dt>
            <dd className="font-semibold">{tzs(w.pendingWithdrawalTzs)}</dd>
          </div>
          <div>
            <dt className="text-stone-600">{t("withdrawn")}</dt>
            <dd className="font-semibold">{tzs(w.withdrawnTzs)}</dd>
          </div>
          <div>
            <dt className="text-stone-600">{t("fees")}</dt>
            <dd className="font-semibold">{tzs(w.feesTzs)}</dd>
          </div>
        </dl>
        <p className="mt-3 text-xs text-stone-600">{t("howItWorks")}</p>
      </Card>

      <Card>
        <h2 className="mb-2 font-semibold">{t("ask")}</h2>
        {!w.platformCollects ? (
          <p className="text-sm text-stone-600">{t("direct")}</p>
        ) : w.pendingWithdrawalTzs > 0 ? (
          <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-950" data-testid="wallet-waiting">
            {t("waiting")}
          </p>
        ) : !w.payoutTo ? (
          <p className="text-sm text-amber-900">{t("noPayout")}</p>
        ) : w.availableTzs < w.minTzs ? (
          <p className="text-sm text-stone-600">{t("belowMin", { min: tzs(w.minTzs) })}</p>
        ) : null}
        {canAsk ? (
          <form action={requestWithdrawalAction} className="flex flex-col gap-3" data-testid="withdraw-form">
            <IdemKey />
            <Field label={t("amount")} htmlFor="amountTzs" hint={t("amountHint", { min: tzs(w.minTzs), max: tzs(w.availableTzs) })}>
              <input id="amountTzs" name="amountTzs" type="number" inputMode="numeric" min={w.minTzs} max={w.availableTzs} step={1} defaultValue={w.availableTzs} required className="field" />
            </Field>
            <p className="text-sm text-stone-700">{t("payoutTo", { number: w.payoutTo ?? "" })}</p>
            <PrimaryButton>{t("submit")}</PrimaryButton>
          </form>
        ) : null}
      </Card>

      <Card>
        <h2 className="mb-2 font-semibold">{t("history")}</h2>
        {w.withdrawals.length === 0 ? <p className="text-sm text-stone-500">{t("none")}</p> : null}
        <ul className="divide-y divide-stone-100" data-testid="wallet-history">
          {w.withdrawals.map((x) => (
            <li key={x.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm" data-testid="withdrawal-row" data-state={x.state}>
              <span>
                <span className="font-mono">{x.ref}</span> · {tzs(x.amountTzs)}
                <span className="block text-xs text-stone-500">{formatDateTime(x.createdAt, locale)}</span>
                {x.state === "REJECTED" && x.decidedReason ? <span className="block text-xs text-red-800">{x.decidedReason}</span> : null}
              </span>
              <Badge tone={TONE[x.state]}>{t(`states.${x.state}`)}</Badge>
            </li>
          ))}
        </ul>
      </Card>
    </>
  );
}
