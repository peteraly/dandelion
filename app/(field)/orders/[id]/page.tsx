import Link from "next/link";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { asc, eq, or } from "drizzle-orm";
import { Card, Check, Field, IdemKey, KV, PrimaryButton } from "@/components/ui";
import { Notice } from "@/components/notice";
import { OrderSummary } from "@/components/order-bits";
import { requireField } from "@/lib/auth/current";
import { isOrgKind, isPlanKind } from "@/lib/domain/sales";
import { can } from "@/lib/policy";
import { getDb } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import { viewForOrder } from "@/lib/services/home";
import { orderResource, pickupNeedsRainCover, revealDeliveryCode } from "@/lib/services/orders";
import { openIntent, paidTotals } from "@/lib/services/payments";
import { formatTzs } from "@/lib/money";
import { formatDateTime } from "@/lib/util/time";
import { flags, type SearchParams } from "@/lib/actions";
import * as a from "../../actions";

import { shopRequestForOrder } from "@/lib/services/shop";

export const dynamic = "force-dynamic";

export default async function OrderPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SearchParams }) {
  const { id } = await params;
  const { actor } = await requireField();
  const db = getDb();
  const order = await db.query.orders.findFirst({ where: eq(s.orders.id, id) });
  if (!order) notFound();
  const res = await orderResource(db, order);
  if (!can(actor, "order.view", { type: "order", order: res })) notFound();
  const t = await getTranslations();
  const locale = (await getLocale()) as "sw" | "en";
  const { error, ok } = await flags(searchParams);
  const product = (await db.query.products.findFirst({ where: eq(s.products.id, order.productId) }))!;
  const view = await viewForOrder(actor, order);
  const snap = view.snapshot;
  const intent = await openIntent(db, order.id);
  const totals = await paidTotals(db, order);
  const shop = order.customerId ? await shopRequestForOrder(db, order.id) : null;
  const idem = <IdemKey />;
  const hidden = <input type="hidden" name="orderId" value={order.id} />;
  // The decision table speaks for the user's current order; a finished order gets a plain terminal status.
  const TERMINAL: Partial<Record<string, string>> = { COMPLETED: "order_completed", CANCELLED: "order_cancelled", CLOSED: "order_closed" };
  const status = view.order?.id === order.id ? view.status : (TERMINAL[order.state] ?? null);
  const action = view.order?.id === order.id ? view.action : null;
  const needsRainCover = action === "accept_pickup" ? await pickupNeedsRainCover(db, order) : false;

  const payBlock = intent ? (
    <div className="rounded-xl bg-amber-50 p-3 text-amber-950">
      <p>{t("payment.howToPay", { payee: intent.payeeAccount, reference: order.paymentRef })}</p>
      <p className="mt-1 font-semibold">
        {intent.amountRule === "EXACT_REMAINING" ? t("payment.payExactly", { amount: formatTzs(totals.remainingTzs, locale) }) : t("payment.payUpTo", { amount: formatTzs(totals.remainingTzs, locale) })}
      </p>
    </div>
  ) : null;

  const cancelOrg =
    order.organisationId && order.state === "AWAITING_PAYMENT" && !totals.hasConfirmed && can(actor, "order.org_sale.deliver", { type: "order", order: res }) ? (
      <form action={a.cancelOrgSaleAction} className="mt-2">
        <IdemKey />
        <input type="hidden" name="orderId" value={order.id} />
        <button type="submit" className="btn btn-secondary">
          {t("field.orgSale.cancel")}
        </button>
      </form>
    ) : null;
  let form: React.ReactNode = null;
  switch (action) {
    case "confirm_batch_ready":
      form = (
        <form action={a.confirmBatchReadyAction} className="flex flex-col gap-3">
          {idem}
          {hidden}
          <Field label={t("field.sealId")} htmlFor="sealId">
            <input id="sealId" name="sealId" className="field" required pattern="[A-Za-z0-9-]+" autoComplete="off" />
          </Field>
          <label className="check">
            <input type="checkbox" name="packedWaterproof" value="true" required className="mt-0.5" />
            <span>{t("field.packedWaterproof")}</span>
          </label>
          <PrimaryButton>{t("home.action.confirm_batch_ready")}</PrimaryButton>
        </form>
      );
      break;
    case "accept_pickup":
      form = (
        <form action={a.acceptPickupAction} className="flex flex-col gap-3">
          {idem}
          {hidden}
          {needsRainCover ? (
            <label className="check" data-testid="rain-cover">
              <input type="checkbox" name="rainCover" value="true" required className="mt-0.5" />
              <span>{t("field.rainCover")}</span>
            </label>
          ) : null}
          <PrimaryButton>{t("home.action.accept_pickup")}</PrimaryButton>
        </form>
      );
      break;
    case "i_have_paid":
      form = (
        <form action={a.claimPaidAction} className="flex flex-col gap-3">
          {idem}
          {hidden}
          {payBlock}
          <PrimaryButton>{t("home.action.i_have_paid")}</PrimaryButton>
          <p className="text-sm text-stone-600">{t("payment.claimNote")}</p>
        </form>
      );
      break;
    case "refresh_payment":
    case "refresh_delivery":
    case "view_payment_status":
    case "refresh":
    case "view_upcoming":
      form = (
        <div className="flex flex-col gap-3">
          {snap.latestPaymentStatus === "PAYMENT_PENDING" ? <p className="rounded-xl bg-amber-50 p-3 text-amber-950">{t("payment.checking")}</p> : null}
          {intent && snap.side === "buyer" ? payBlock : null}
          <Link href={`/orders/${order.id}`} className="btn btn-primary">
            {t(`home.action.${action}`)}
          </Link>
        </div>
      );
      break;
    case "confirm_release":
    case "confirm_handover_to_hub":
      form = (
        <form action={a.confirmReleaseAction} className="flex flex-col gap-3">
          {idem}
          {hidden}
          <Check name="quantityOk" label={t("field.receiptChecks.quantityOk")} />
          <PrimaryButton>{t(`home.action.${action}`)}</PrimaryButton>
        </form>
      );
      break;
    case "confirm_receipt":
      form = (
        <form action={a.confirmReceiptAction} className="flex flex-col gap-3">
          {idem}
          {hidden}
          <Check name="quantityOk" label={t("field.receiptChecks.quantityOk")} />
          <Check name="sealOk" label={t("field.receiptChecks.sealOk")} />
          <PrimaryButton>{t("home.action.confirm_receipt")}</PrimaryButton>
        </form>
      );
      break;
    case "open_delivery_code": {
      const code = await revealDeliveryCode(actor, order.id).catch(() => null);
      form = (
        <div className="rounded-xl bg-brand-50 p-4 text-center">
          <p className="text-sm text-stone-600">{t("field.deliveryCode")}</p>
          <p className="my-2 font-mono text-4xl font-bold tracking-widest" data-testid="delivery-code">
            {code ?? "—"}
          </p>
          <p className="text-sm">{t("field.showCodeToHub")}</p>
        </div>
      );
      break;
    }
    case "start_inspection":
      form = (
        <form action={a.startInspectionAction} className="flex flex-col gap-3">
          {idem}
          {hidden}
          <Field label={t("field.enterDeliveryCode")} htmlFor="code">
            <input id="code" name="code" className="field" inputMode="numeric" pattern="\d{6}" maxLength={6} required autoComplete="one-time-code" />
          </Field>
          <PrimaryButton>{t("home.action.start_inspection")}</PrimaryButton>
        </form>
      );
      break;
    case "inspect_stock":
      form = (
        <div className="flex flex-col gap-3">
          <form action={a.passInspectionAction} className="flex flex-col gap-3">
            {idem}
            {hidden}
            <h2 className="font-semibold">{t("field.inspection.title")}</h2>
            {(["correctRider", "correctProduct", "correctCount", "correctBatch", "sealIntact", "goodCondition", "noWaterDamage"] as const).map((k) => (
              <Check key={k} name={k} label={t(`field.inspection.${k}`)} />
            ))}
            <PrimaryButton>{t("field.inspection.accept")}</PrimaryButton>
          </form>
          <div className="grid grid-cols-2 gap-2">
            <Link href={`/problem?orderId=${order.id}&type=STOCK_SHORT`} className="btn btn-danger">
              {t("field.inspection.reportShortage")}
            </Link>
            <Link href={`/problem?orderId=${order.id}&type=DAMAGED_OR_WET`} className="btn btn-danger">
              {t("field.inspection.reportDamage")}
            </Link>
          </div>
        </div>
      );
      break;
    case "prepare_transfer":
      form = (
        <div className="flex flex-col gap-3">
          <form action={a.prepareTransferAction} className="flex flex-col gap-3">
            {idem}
            {hidden}
            <PrimaryButton>{t("home.action.prepare_transfer")}</PrimaryButton>
          </form>
          <form action={a.declineRequestAction}>
            <IdemKey />
            {hidden}
            <button type="submit" className="btn btn-secondary">
              {t("common.cancel")}
            </button>
          </form>
        </div>
      );
      break;
    case "record_payment":
    case "contact_or_close":
      form = (
        <div className="flex flex-col gap-3">
          <div className="rounded-xl bg-stone-100 p-3">
            <div className="mb-1 flex justify-between text-sm">
              <span>{t("common.paid")}</span>
              <span>
                {formatTzs(totals.confirmedTzs + totals.donorTzs, locale)} / {formatTzs(totals.totalTzs, locale)}
              </span>
            </div>
            <div className="h-3 w-full overflow-hidden rounded-full bg-white">
              <div className="h-3 bg-brand-600" style={{ width: `${Math.round(((totals.confirmedTzs + totals.donorTzs) / totals.totalTzs) * 100)}%` }} />
            </div>
            <p className="mt-2 text-sm font-semibold">{t("common.noPressure")}</p>
          </div>
          {payBlock}
          <form action={a.expectPaymentAction} className="flex flex-col gap-3">
            {idem}
            {hidden}
            <PrimaryButton>{t("home.action.record_payment")}</PrimaryButton>
            <p className="text-sm text-stone-600">{t("payment.claimNote")}</p>
          </form>
          {!totals.hasConfirmed && totals.donorTzs === 0 ? (
            <form action={a.closePlanAction}>
              <IdemKey />
              {hidden}
              <button type="submit" className="btn btn-secondary">
                {t("field.closePlan")}
              </button>
            </form>
          ) : null}
          <details className="card">
            <summary className="cursor-pointer font-semibold">{t("field.refund.title")}</summary>
            <form action={a.refundReviewAction} className="mt-3 flex flex-col gap-3">
              <IdemKey />
              {hidden}
              <Field label={t("field.refund.reason")} htmlFor="reason">
                <textarea id="reason" name="reason" className="field" rows={3} required minLength={3} />
              </Field>
              <p className="text-sm text-stone-600">{t("field.refund.note")}</p>
              <button type="submit" className="btn btn-secondary">
                {t("field.refund.title")}
              </button>
            </form>
          </details>
        </div>
      );
      break;
    case "complete_handover":
      form = (
        <form action={a.startHandoverAction} className="flex flex-col gap-3">
          {idem}
          {hidden}
          <PrimaryButton>{t("home.action.complete_handover")}</PrimaryButton>
        </form>
      );
      break;
    case "request_stock":
      form = (
        <Link href="/stock/request" className="btn btn-primary">
          {t("home.action.request_stock")}
        </Link>
      );
      break;
    case "confirm_customer_handover": {
      const eduKeys = product.category === "REUSABLE" ? (["wash", "dry", "store", "whenNotToUse", "whenToSeekCare"] as const) : (["safeUse", "disposal"] as const);
      form = (
        <div className="flex flex-col gap-3">
          <p className="rounded-xl bg-brand-50 p-3">{t("field.handover.codeSent")}</p>
          <form action={a.completeHandoverAction} className="flex flex-col gap-3">
            {idem}
            {hidden}
            <h2 className="font-semibold">{t("field.handover.education")}</h2>
            {eduKeys.map((k) => (
              <Check key={k} name={k} label={t(`field.handover.${product.category === "REUSABLE" ? "reusable" : "disposable"}.${k}`)} />
            ))}
            <Field label={t("field.handover.enterCode")} htmlFor="code">
              <input id="code" name="code" className="field" inputMode="numeric" pattern="\d{6}" maxLength={6} required autoComplete="one-time-code" />
            </Field>
            <PrimaryButton>{t("field.handover.complete")}</PrimaryButton>
          </form>
          <form action={a.resendHandoverCodeAction}>
            <IdemKey />
            {hidden}
            <button type="submit" className="btn btn-secondary">
              {t("field.handover.resend")}
            </button>
          </form>
        </div>
      );
      break;
    }
    case "deliver_org":
      form = (
        <div className="flex flex-col gap-3">
          <form action={a.deliverOrgAction} className="flex flex-col gap-3">
            {idem}
            {hidden}
            <p className="text-sm text-stone-700">{t("field.orgSale.deliverNote")}</p>
            <PrimaryButton>{t("field.orgSale.deliver")}</PrimaryButton>
          </form>
        </div>
      );
      break;
    case "report_problem":
      form = (
        <Link href={`/problem?orderId=${order.id}`} className="btn btn-warn">
          {t("common.reportProblem")}
        </Link>
      );
      break;
    default:
      form = null;
  }

  const receipt = order.state === "COMPLETED" && (isPlanKind(order.kind) || isOrgKind(order.kind)) ? await db.query.receipts.findFirst({ where: eq(s.receipts.orderId, order.id) }) : null;
  const margin = order.state === "COMPLETED" && snap.side === "seller" ? (order.unitPriceTzs - order.unitCostTzs) * order.quantity : null;
  const HANDLED_OK = ["checking", "refundOpened", "receiptSent", "codeSent", "done", "delivered"];
  // The order's timeline (Prompt C §5.2): the ledger's own events, labelled by type and by the role that acted — never by name.
  const timeline = (
    await db.query.ledgerEvents.findMany({
      where: order.batchId ? or(eq(s.ledgerEvents.orderId, order.id), eq(s.ledgerEvents.batchId, order.batchId)) : eq(s.ledgerEvents.orderId, order.id),
      orderBy: asc(s.ledgerEvents.id),
      columns: { id: true, type: true, canonical: true, createdAt: true },
    })
  ).map((e) => {
    let role: string | null = null;
    try {
      role = (JSON.parse(e.canonical) as { role?: string | null }).role ?? null;
    } catch {
      role = null;
    }
    return { id: e.id, type: e.type, at: e.createdAt, role };
  });
  const roleLabel = (role: string | null) => (role && t.has(`roles.${role}`) ? t(`roles.${role}`) : t("field.timeline.system"));

  return (
    <>
      <Notice error={error} ok={HANDLED_OK.includes(ok ?? "") ? undefined : ok} />
      {ok === "checking" ? <p className="rounded-xl bg-amber-50 p-3 text-amber-950">{t("payment.checking")}</p> : null}
      {ok === "refundOpened" ? <p className="rounded-xl bg-green-50 p-3 text-green-900">{t("field.refund.title")} ✓</p> : null}
      {ok === "codeSent" ? <p className="rounded-xl bg-green-50 p-3 text-green-900">{t("field.handover.codeSent")}</p> : null}
      {(ok === "receiptSent" || ok === "delivered") && receipt ? (
        <p className="rounded-xl bg-green-50 p-3 text-green-900" data-testid="receipt-sent">
          {ok === "delivered" ? t("field.orgSale.delivered", { receiptNo: receipt.receiptNo }) : t("field.handover.receiptSent", { receiptNo: receipt.receiptNo })}
        </p>
      ) : null}
      {status ? (
        <Card className="border-brand-100 bg-brand-50">
          <p className="text-xs uppercase tracking-wide text-stone-500">{t("common.status")}</p>
          <h1 className="text-2xl font-bold">{t(`home.status.${status}.title`)}</h1>
          <p className="mt-2 text-stone-700">{t(`home.status.${status}.explain`)}</p>
        </Card>
      ) : null}
      {shop ? (
        <p className="rounded-xl bg-sky-50 p-3 text-sky-950" data-testid="shop-meeting">
          {t("field.shopRequests.meetAt", { ref: shop.ref, place: shop.placeWhen ? `${shop.placeName} (${shop.placeWhen})` : shop.placeName })}
          {shop.dueAt ? (
            <strong className="mt-1 block" data-testid="shop-due">
              {t("field.shopRequests.handOverBy", { due: formatDateTime(shop.dueAt, locale) })}
            </strong>
          ) : null}
        </p>
      ) : null}
      <Card>
        <OrderSummary snap={snap} product={product.name} />
        {margin !== null ? (
          <p className="mt-3 rounded-xl bg-green-50 p-3 text-green-900">
            {t("common.margin")}: <strong>{formatTzs(margin, locale)}</strong>
            <span className="block text-sm text-green-800">{t("common.marginNote")}</span>
          </p>
        ) : null}
      </Card>
      {form ? <Card>{form}</Card> : null}
      {receipt ? (
        <Card>
          <h2 className="font-semibold">{t("verify.receipt")}</h2>
          <KV items={[[t("verify.receiptNo"), receipt.receiptNo]]} />
        </Card>
      ) : null}
      <Card data-testid="timeline">
        <h2 className="mb-2 font-semibold">{t("field.timeline.title")}</h2>
        {timeline.length === 0 ? <p className="text-sm text-stone-500">{t("field.timeline.empty")}</p> : null}
        <ol className="divide-y divide-stone-100 text-sm">
          {timeline.map((e) => (
            <li key={e.id} className="flex items-start justify-between gap-3 py-2" data-testid="timeline-item">
              <span>
                <span className="font-medium">{t(`verify.eventTypes.${e.type}`)}</span>
                <span className="block text-xs text-stone-500">{t("field.timeline.by", { role: roleLabel(e.role) })}</span>
              </span>
              <time dateTime={e.at.toISOString()} className="shrink-0 text-xs text-stone-500">
                {formatDateTime(e.at, locale)}
              </time>
            </li>
          ))}
        </ol>
      </Card>
      <Link href="/home" className="text-center text-sm underline">
        {t("common.back")}
      </Link>
    </>
  );
}
