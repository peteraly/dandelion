import Link from "next/link";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { asc, eq } from "drizzle-orm";
import { Badge, Card, KV } from "@/components/ui";
import { requireAdmin } from "@/lib/auth/current";
import { getDb } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import { paidTotals } from "@/lib/services/payments";
import { formatTzs } from "@/lib/money";
import { formatDateTime } from "@/lib/util/time";

export default async function AdminOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireAdmin();
  const t = await getTranslations();
  const locale = (await getLocale()) as "sw" | "en";
  const db = getDb();
  const o = await db.query.orders.findFirst({ where: eq(s.orders.id, id) });
  if (!o) notFound();
  const product = await db.query.products.findFirst({ where: eq(s.products.id, o.productId) });
  const totals = await paidTotals(db, o);
  const intents = await db.query.paymentIntents.findMany({ where: eq(s.paymentIntents.orderId, o.id), orderBy: asc(s.paymentIntents.createdAt) });
  const batch = o.batchId ? await db.query.batches.findFirst({ where: eq(s.batches.id, o.batchId) }) : null;
  const events = o.batchId ? await db.query.custodyEvents.findMany({ where: eq(s.custodyEvents.batchId, o.batchId), orderBy: asc(s.custodyEvents.id) }) : [];
  const ledger = await db.query.ledgerEvents.findMany({ where: eq(s.ledgerEvents.orderId, o.id), orderBy: asc(s.ledgerEvents.id) });
  return (
    <>
      <h1 className="font-mono text-2xl font-bold">{o.ref}</h1>
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <KV
            items={[
              ["Kind", t(`orderKinds.${o.kind}`)],
              [t("common.status"), <Badge key="b">{o.state.replace(/_/g, " ")}</Badge>],
              [t("common.product"), `${product?.name} × ${o.quantity}`],
              [t("common.price"), formatTzs(o.totalTzs, locale)],
              [t("common.paid"), formatTzs(totals.confirmedTzs, locale)],
              ["Donor", formatTzs(totals.donorTzs, locale)],
              [t("common.remaining"), formatTzs(totals.remainingTzs, locale)],
              ["Payment ref", <span key="p" className="font-mono">{o.paymentRef}</span>],
              ["Batch", batch ? `${batch.code} (${batch.custodyState})` : "—"],
              ["Verify", <Link key="v" href={`/verify/${o.verifyRef}`} className="underline">/verify/…</Link>],
            ]}
          />
          {o.kind === "CHAMPION_TO_CUSTOMER" && o.state === "PLAN_ACTIVE" ? (
            <Link href={`/admin/orders/${o.id}/donor`} className="btn btn-secondary mt-3">
              {t("admin.donor.title")}
            </Link>
          ) : null}
        </Card>
        <Card>
          <h2 className="mb-2 font-semibold">Payments</h2>
          <ul className="divide-y divide-stone-100 text-sm">
            {intents.map((i) => (
              <li key={i.id} className="py-2">
                <div className="flex justify-between">
                  <Badge tone={i.status === "PAYMENT_CONFIRMED" ? "green" : i.status === "PAYMENT_PENDING" ? "amber" : "red"}>{t(`payment.${i.status}`)}</Badge>
                  <span>{formatTzs(i.confirmedAmountTzs ?? i.amountTzs, locale)}</span>
                </div>
                <p className="text-xs text-stone-500">
                  {i.providerTxRef ?? "—"} · {i.payeeAccount} · {i.reviewReason ?? ""} · {formatDateTime(i.updatedAt, locale)}
                </p>
              </li>
            ))}
          </ul>
        </Card>
        <Card>
          <h2 className="mb-2 font-semibold">Custody</h2>
          <ul className="text-sm">
            {events.map((e) => (
              <li key={e.id} className="py-1">
                {formatDateTime(e.createdAt, locale)} · {e.event} · {e.fromState ?? "∅"} → {e.toState} · {e.actorKind}
              </li>
            ))}
          </ul>
        </Card>
        <Card>
          <h2 className="mb-2 font-semibold">Ledger events</h2>
          <ul className="text-sm">
            {ledger.map((e) => (
              <li key={e.id} className="py-1">
                #{e.id} · {e.type} · {e.eventDate}
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </>
  );
}
