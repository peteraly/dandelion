import { getTranslations } from "next-intl/server";
import { desc } from "drizzle-orm";
import { Badge, Card, KV, PrimaryButton } from "@/components/ui";
import { Notice } from "@/components/notice";
import { requireAdmin } from "@/lib/auth/current";
import { getDb } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import { activeChain, activeDeployment, explorerTxUrl, unanchoredCount, walletStatus } from "@/lib/ledger/anchor";
import { flags, type SearchParams } from "@/lib/actions";
import { anchorNowAction } from "../actions";
import { formatEther } from "viem";

export default async function LedgerPage({ searchParams }: { searchParams: SearchParams }) {
  await requireAdmin();
  const t = await getTranslations("admin.ledger");
  const { error, ok } = await flags(searchParams);
  const deployment = await activeDeployment();
  const wallet = await walletStatus();
  const anchors = await getDb().query.ledgerAnchors.findMany({ orderBy: desc(s.ledgerAnchors.createdAt), limit: 50 });
  const chain = activeChain();
  return (
    <>
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{t("title")}</h1>
        <form action={anchorNowAction} className="w-40">
          <PrimaryButton>{t("anchorNow")}</PrimaryButton>
        </form>
      </div>
      <Notice error={error} ok={ok} />
      <Card>
        <KV
          items={[
            [t("network"), `${chain.name} (chain ${chain.id})`],
            [t("contract"), deployment ? deployment.contractAddress : "—"],
            [t("unanchored"), String(await unanchoredCount())],
            ["Wallet", wallet.configured ? `${wallet.address} · ${wallet.balanceWei === null ? "?" : formatEther(wallet.balanceWei)} CELO` : "not configured"],
          ]}
        />
      </Card>
      <Card>
        <ul className="divide-y divide-stone-100 text-sm">
          {anchors.map((a) => (
            <li key={a.id} className="flex items-center justify-between gap-2 py-2">
              <span>
                <span className="font-mono">{a.root.slice(0, 18)}…</span> · events {a.fromEventId}–{a.toEventId} ({a.eventCount})
                {a.txHash ? (
                  <>
                    {" · "}
                    <a href={explorerTxUrl(a.txHash)} className="underline" rel="noreferrer noopener">
                      {t("txLink")}
                    </a>
                  </>
                ) : null}
                {a.error ? <span className="text-red-700"> · {a.error}</span> : null}
              </span>
              <Badge tone={a.status === "CONFIRMED" ? "green" : a.status === "FAILED" ? "red" : "amber"}>{a.status}</Badge>
            </li>
          ))}
          {anchors.length === 0 ? <li className="py-2 text-stone-500">—</li> : null}
        </ul>
      </Card>
    </>
  );
}
