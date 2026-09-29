/**
 * Public record check (build prompt §6). Shows only event types, day-granularity
 * dates, the Merkle proof and anchor link — never payee, roles, or anything
 * person-linked. With the receipt token (from the customer's SMS) it also shows
 * the amount and product: the customer's own receipt.
 */
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { headers } from "next/headers";
import { asc, eq, or } from "drizzle-orm";
import { PublicShell } from "@/components/shell";
import { DemoBanner } from "@/components/demo-banner";
import { Badge, Card, KV } from "@/components/ui";
import { getDb } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import { proofForEvent, explorerTxUrl } from "@/lib/ledger/anchor";
import { orderUnderReview } from "@/lib/services/reconciliation";
import { hitRateLimit } from "@/lib/security/rate-limit";
import { clientIpFrom } from "@/lib/security/request";
import { safeEqual, sha256Hex } from "@/lib/crypto/random";
import { formatDay } from "@/lib/util/time";
import { formatTzs } from "@/lib/money";
import type { SearchParams } from "@/lib/actions";

export const dynamic = "force-dynamic";

export default async function VerifyPage({ params, searchParams }: { params: Promise<{ ref: string }>; searchParams: SearchParams }) {
  const { ref } = await params;
  const t = await getTranslations("verify");
  const locale = (await getLocale()) as "sw" | "en";
  const h = await headers();
  const rl = await hitRateLimit(`verify:${sha256Hex(clientIpFrom(h)).slice(0, 16)}`, 20, 60);
  if (!rl.allowed) {
    return (
      <PublicShell path={`/verify/${ref}`}>
        <p className="rounded-xl bg-amber-50 p-3" data-testid="rate-limited">
          {t("rateLimited")}
        </p>
      </PublicShell>
    );
  }
  if (!/^[A-Za-z0-9_-]{22}$/.test(ref)) notFound();
  const db = getDb();
  const order = await db.query.orders.findFirst({ where: eq(s.orders.verifyRef, ref) });
  const batch = order ? null : await db.query.batches.findFirst({ where: eq(s.batches.verifyRef, ref) });
  if (!order && !batch) {
    return (
      <PublicShell path={`/verify/${ref}`}>
        <h1 className="text-2xl font-bold">{t("title")}</h1>
      <DemoBanner />
        <p>{t("notFound")}</p>
      </PublicShell>
    );
  }
  const sp = await searchParams;
  const token = typeof sp.t === "string" ? sp.t : "";
  const receiptOk = !!order?.receiptTokenHash && token.length > 20 && safeEqual(sha256Hex(token), order.receiptTokenHash);
  const events = await db.query.ledgerEvents.findMany({
    where: order ? or(eq(s.ledgerEvents.orderId, order.id), order.batchId ? eq(s.ledgerEvents.batchId, order.batchId) : eq(s.ledgerEvents.orderId, order.id)) : eq(s.ledgerEvents.batchId, batch!.id),
    orderBy: asc(s.ledgerEvents.id),
  });
  const proofs = await Promise.all(events.map((e) => proofForEvent(e.id)));
  const underReview = order ? await orderUnderReview(order.id) : false;
  const firstDate = events[0]?.eventDate ?? (order ?? batch)!.createdAt.toISOString().slice(0, 10);
  const receipt = receiptOk && order ? await db.query.receipts.findFirst({ where: eq(s.receipts.orderId, order.id) }) : null;
  const product = receiptOk && order ? await db.query.products.findFirst({ where: eq(s.products.id, order.productId) }) : null;

  return (
    <PublicShell path={`/verify/${ref}`}>
      <h1 className="text-2xl font-bold">{t("title")}</h1>
      <DemoBanner />
      <p className="rounded-xl bg-brand-50 p-3" data-testid="verify-statement">
        {t("statement", { date: formatDay(firstDate, locale) })}
      </p>
      {underReview ? (
        <p className="rounded-xl bg-amber-50 p-3 text-amber-950" data-testid="under-review">
          {t("underReview")}
        </p>
      ) : null}
      {receipt && product && order ? (
        <Card className="border-2 border-green-300" data-testid="receipt">
          <h2 className="font-semibold">{t("receipt")}</h2>
          <KV
            items={[
              [t("receiptNo"), receipt.receiptNo],
              [(await getTranslations("common"))("product"), `${product.name} × ${order.quantity}`],
              [(await getTranslations("common"))("amount"), formatTzs(order.totalTzs, locale)],
            ]}
          />
        </Card>
      ) : null}
      <Card>
        <h2 className="mb-2 font-semibold">{t("events")}</h2>
        <ul className="divide-y divide-stone-100">
          {events.map((e, i) => {
            const p = proofs[i];
            const anchored = !!p?.anchor && p.anchor.status !== "FAILED";
            return (
              <li key={e.id} className="py-3" data-testid="ledger-event" data-anchored={anchored ? "1" : "0"} data-valid={p?.valid === null ? "" : String(p?.valid)}>
                <div className="flex items-center justify-between">
                  <span className="font-semibold">{t(`eventTypes.${e.type}`)}</span>
                  <span className="text-sm text-stone-600">{formatDay(e.eventDate, locale)}</span>
                </div>
                <div className="mt-1 flex items-center gap-2 text-sm">
                  {anchored ? <Badge tone="green">{t("anchored")}</Badge> : <Badge tone="amber">{t("pending")}</Badge>}
                  {p?.anchor?.txHash ? (
                    <a href={explorerTxUrl(p.anchor.txHash)} className="underline" rel="noreferrer noopener">
                      {t("anchorTx")}
                    </a>
                  ) : null}
                </div>
                <details className="mt-1 text-xs">
                  <summary className="cursor-pointer text-stone-500">{t("showProof")}</summary>
                  <pre className="overflow-x-auto rounded bg-stone-50 p-2">
                    {JSON.stringify({ leaf: e.leafHash, root: p?.root ?? null, proof: p?.proof ?? [], valid: p?.valid, contract: p?.anchor?.contractAddress ?? null, chainId: p?.anchor?.chainId ?? null }, null, 1)}
                  </pre>
                </details>
              </li>
            );
          })}
          {events.length === 0 ? <li className="py-3 text-stone-500">—</li> : null}
        </ul>
      </Card>
      <Card>
        <h2 className="font-semibold">{t("whatThisMeans")}</h2>
        <p className="mt-1 text-sm">{t("honest")}</p>
      </Card>
    </PublicShell>
  );
}
