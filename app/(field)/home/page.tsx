import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { eq } from "drizzle-orm";
import { Badge, Card, IdemKey, LinkButton } from "@/components/ui";
import { OrderSummary } from "@/components/order-bits";
import { requireField } from "@/lib/auth/current";
import { homeFor } from "@/lib/services/home";
import { supplierHome, type SupplierHome } from "@/lib/services/suppliers";
import { directSalesFor, sellerAreaId } from "@/lib/services/areas";
import { earningsFor, type Earnings } from "@/lib/services/earnings";
import { myWallet, type Wallet } from "@/lib/services/wallets";
import { openRequestsFor } from "@/lib/services/shop";
import { acceptShopRequestAction } from "../actions";
import type { Actor } from "@/lib/policy";
import { getDb } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import { rowForOrder, type ActionKey } from "@/lib/domain/workflows";
import type { FieldRole } from "@/lib/domain/types";
import { formatTzs } from "@/lib/money";
import { formatDateTime } from "@/lib/util/time";

export const dynamic = "force-dynamic";

/** Where each next action leads. Order-bound actions open the order page, which renders the single form. */
export function actionHref(action: ActionKey, orderId: string | null): string {
  switch (action) {
    case "add_customer":
      return "/customers/new";
    case "start_plan":
    case "view_customers":
      return "/customers";
    case "request_stock":
      return "/stock/request";
    case "view_inventory":
    case "request_restock":
      return "/inventory";
    case "refresh":
    case "view_upcoming":
      return orderId ? `/orders/${orderId}` : "/home";
    default:
      return orderId ? `/orders/${orderId}` : "/home";
  }
}

export default async function HomePage() {
  const { actor } = await requireField();
  const t = await getTranslations();
  const locale = (await getLocale()) as "sw" | "en";
  const view = await homeFor(actor);
  const product = view.order ? await getDb().query.products.findFirst({ where: eq(s.products.id, (await getDb().query.orders.findFirst({ where: eq(s.orders.id, view.order.id) }))!.productId) }) : null;
  const others = view.snapshots.filter((o) => o.id !== view.order?.id && !["COMPLETED", "CANCELLED", "CLOSED"].includes(o.state));
  const margin = view.order && view.order.state === "COMPLETED" && view.order.side === "seller" ? await marginFor(view.order.id) : null;
  const supplier = actor.role === "SUPPLIER" ? await supplierHome(actor) : null;
  const direct = await directSalesFor(getDb(), actor, await sellerAreaId(actor));
  const earnings = await earningsFor(getDb(), actor.userId);
  const wallet = await myWallet(actor);

  return (
    <>
      <Card className="border-brand-100 bg-brand-50">
        <p className="text-xs uppercase tracking-wide text-stone-500">{t("common.status")}</p>
        <h1 className="text-2xl font-bold">{t(`home.status.${view.status}.title`)}</h1>
        <p className="mt-2 text-base text-stone-700">{t(`home.status.${view.status}.explain`)}</p>
      </Card>
      {view.order && product ? (
        <Card>
          <OrderSummary snap={view.order} product={product.name} />
          {margin !== null ? (
            <p className="mt-3 rounded-xl bg-green-50 p-3 text-green-900">
              {t("common.margin")}: <strong>{formatTzs(margin, locale)}</strong>
              <span className="block text-sm text-green-800">{t("common.marginNote")}</span>
            </p>
          ) : null}
        </Card>
      ) : null}
      <div>
        <p className="mb-1 text-xs uppercase tracking-wide text-stone-500">{t("common.nextAction")}</p>
        <LinkButton href={actionHref(view.action, view.order?.id ?? null)}>{t(`home.action.${view.action}`)}</LinkButton>
      </div>
      {actor.role === "BOSS_RIDER" || actor.role === "FIELD_CHAMPION" ? <ShopRequestsCard actor={actor} locale={locale} /> : null}
      {wallet.platformCollects ? <WalletCard wallet={wallet} locale={locale} /> : null}
      <EarningsCard earnings={earnings} locale={locale} />
      {supplier ? <SupplierCards data={supplier} locale={locale} /> : null}
      {others.length > 0 || (view.extras.riderStockUnits ?? 0) > 0 ? (
        // "My day" (Prompt C §5.1): the other open orders with one verb each; never a second primary action.
        <Card data-testid="my-day">
          <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="font-semibold">{t("home.myDay.title")}</h2>
            {(view.extras.riderStockUnits ?? 0) > 0 ? (
              <span className="text-sm text-stone-600" data-testid="rider-stock">
                {t("home.myDay.stock", { n: view.extras.riderStockUnits ?? 0 })}
              </span>
            ) : null}
          </div>
          {others.length === 0 ? <p className="text-sm text-stone-500">{t("home.myDay.none")}</p> : null}
          <ul className="divide-y divide-stone-100">
            {others.slice(0, 8).map((o) => {
              const row = rowForOrder(actor.role as FieldRole, o, view.extras);
              return (
                <li key={o.id} data-testid="my-day-row">
                  <Link href={`/orders/${o.id}`} className="flex items-center justify-between gap-2 py-3">
                    <span className="min-w-0">
                      <span className="font-mono text-sm">{o.ref}</span>
                      <span className="block text-sm text-stone-600">{t(`orderKinds.${o.kind}`)}</span>
                      <span className="mt-1 inline-block">
                        <Badge tone={o.batchState && ["LOCKED_DAMAGED", "LOCKED_DISPUTE", "LOCKED_QUARANTINE"].includes(o.batchState) ? "red" : "neutral"}>{t(`orderStates.${o.state}`)}</Badge>
                      </span>
                    </span>
                    <span className="shrink-0 text-right text-sm font-medium text-brand-800">{row ? t(`home.action.${row.action}`) : t(`orderStates.${o.state}`)} →</span>
                  </Link>
                </li>
              );
            })}
          </ul>
          {others.length > 8 ? <p className="mt-2 text-sm text-stone-500">{t("home.myDay.more", { n: others.length - 8 })}</p> : null}
        </Card>
      ) : null}
      <nav className="grid grid-cols-2 gap-2 text-sm">
        {actor.role === "FIELD_CHAMPION" || direct.toCustomers ? (
          <Link href="/customers" className="btn btn-secondary" data-testid="customers-link">
            {actor.role === "FIELD_CHAMPION" ? t("field.customer.list") : t("field.customer.directLink")}
          </Link>
        ) : null}
        {direct.toOrganisations ? (
          <Link href="/org-sales/new" className="btn btn-secondary" data-testid="org-sale-link">
            {t("field.orgSale.link")}
          </Link>
        ) : null}
        {actor.role === "FIELD_CHAMPION" ? (
          <Link href="/education" className="btn btn-secondary">
            {t("home.educationLink")}
          </Link>
        ) : null}
        {actor.role === "HUB_MANAGER" ? (
          <Link href="/inventory" className="btn btn-secondary">
            {t("field.inventory.title")}
          </Link>
        ) : null}
        <Link href="/notes" className="btn btn-secondary">
          {t("field.notes.title")}
        </Link>
        <Link href="/orders" className="btn btn-secondary">
          {t("admin.nav.orders")}
        </Link>
      </nav>
    </>
  );
}

async function marginFor(orderId: string): Promise<number> {
  const o = await getDb().query.orders.findFirst({ where: eq(s.orders.id, orderId) });
  return o ? (o.unitPriceTzs - o.unitCostTzs) * o.quantity : 0;
}

/**
 * Supplier organisation view (Prompt B §8.2), display only: this week's
 * pickups, money the provider confirmed to the organisation, and quality
 * issues raised downstream on its batches. Any user of the organisation sees
 * the same view; margins of other stakeholders are never shown here.
 */
async function SupplierCards({ data, locale }: { data: SupplierHome; locale: "sw" | "en" }) {
  const t = await getTranslations("field.supplier");
  const ts = await getTranslations("orderStates");
  const tp = await getTranslations("problems");
  return (
    <>
      <Card data-testid="supplier-pickups">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="font-semibold">{t("pickupsWeek")}</h2>
          <span className="text-sm text-stone-500">{t("today", { n: data.todayCount })}</span>
        </div>
        <ul className="divide-y divide-stone-100 text-sm">
          {data.pickups.map((p) => (
            <li key={p.id}>
              <Link href={`/orders/${p.id}`} className="flex items-center justify-between py-2">
                <span>
                  <span className="font-mono">{p.ref}</span> · {p.productName} × {p.quantity}
                  <span className="block text-stone-600">
                    {p.riderName} · {ts.has(p.state) ? ts(p.state) : p.state}
                  </span>
                </span>
                <span className="text-stone-500">→</span>
              </Link>
            </li>
          ))}
          {data.pickups.length === 0 ? <li className="py-2 text-stone-500">{t("noPickups")}</li> : null}
        </ul>
      </Card>
      <Card data-testid="supplier-payments">
        <h2 className="mb-2 font-semibold">{t("payments")}</h2>
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-xl bg-green-50 p-3">
            <p className="text-xs uppercase text-green-800">{t("thisWeek")}</p>
            <p className="text-xl font-bold text-green-900">{formatTzs(data.confirmedWeekTzs, locale)}</p>
          </div>
          <div className="rounded-xl bg-green-50 p-3">
            <p className="text-xs uppercase text-green-800">{t("thisMonth")}</p>
            <p className="text-xl font-bold text-green-900">{formatTzs(data.confirmedMonthTzs, locale)}</p>
          </div>
        </div>
        <p className="mt-2 text-xs text-stone-500">{t("confirmedOnly")}</p>
      </Card>
      <Card data-testid="supplier-quality">
        <h2 className="mb-2 font-semibold">{t("quality")}</h2>
        <ul className="divide-y divide-stone-100 text-sm">
          {data.quality.map((q) => (
            <li key={q.ref} className="flex items-center justify-between py-2">
              <span>
                <span className="font-mono">{q.ref}</span> · {tp.has(`${q.type}.label`) ? tp(`${q.type}.label`) : q.type}
              </span>
              <span className="text-stone-500">{q.status}</span>
            </li>
          ))}
          {data.quality.length === 0 ? <li className="py-2 text-stone-500">{t("noQuality")}</li> : null}
        </ul>
      </Card>
    </>
  );
}

/** Earned = received − paid, provider-confirmed only (prompt §8.8.1). Every field role sees their own. */
/** Dandelion holds the money from sales (Prompt L §2): what can be withdrawn now, what waits for a hand-over. */
/**
 * Customers who ordered in the shop, in this seller's area (Prompt L §3), grouped by meeting point so one trip — on
 * market day — serves several. Shown only when there are some.
 */
async function ShopRequestsCard({ actor, locale }: { actor: Actor; locale: "sw" | "en" }) {
  const rows = await openRequestsFor(actor);
  if (!rows.length) return null;
  const t = await getTranslations("field.shopRequests");
  const places = [...new Set(rows.map((r) => r.placeName))];
  return (
    <Card className="border-sky-200" data-testid="shop-requests">
      <h2 className="font-semibold">{t("title", { n: rows.length })}</h2>
      <p className="mb-2 text-sm text-stone-600">{t("hint")}</p>
      {places.map((place) => {
        const here = rows.filter((r) => r.placeName === place);
        return (
          <section key={place} className="mt-2" data-testid="shop-request-place">
            <h3 className="text-sm font-semibold text-sky-900">
              {t("place", { place })} · {t("waitingHere", { n: here.length })}
              {here[0]!.placeWhen ? <span className="block text-xs font-normal text-stone-600">{here[0]!.placeWhen}</span> : null}
            </h3>
            <ul className="divide-y divide-stone-100">
              {here.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-3" data-testid="shop-request-row">
                  <span className="min-w-0 text-sm">
                    <span className="font-medium">{r.customerName}</span> · {r.productName}
                    <span className="block text-stone-600">{formatDateTime(r.createdAt, locale)}</span>
                    {r.womenOnly ? <span className="block text-purple-900">{t("womenOnly")}</span> : null}
                    {!r.inStock ? <span className="block text-amber-900">{t("noStock")}</span> : null}
                  </span>
                  <form action={acceptShopRequestAction}>
                    <IdemKey />
                    <input type="hidden" name="requestId" value={r.id} />
                    <button type="submit" className="btn btn-primary w-auto px-4" disabled={!r.inStock} data-testid="shop-request-accept">
                      {t("accept")}
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </Card>
  );
}

async function WalletCard({ wallet, locale }: { wallet: Wallet; locale: "sw" | "en" }) {
  const t = await getTranslations("field.wallet");
  return (
    <Card className="flex flex-wrap items-center justify-between gap-3" data-testid="wallet-card">
      <div>
        <p className="text-xs uppercase tracking-wide text-stone-500">{t("available")}</p>
        <p className="text-2xl font-bold text-green-900" data-testid="wallet-card-available">
          {formatTzs(wallet.availableTzs, locale)}
        </p>
        <p className="text-xs text-stone-600">
          {t("onHold")} {formatTzs(wallet.onHoldTzs, locale)}
          {wallet.pendingWithdrawalTzs > 0 ? ` · ${t("pending")} ${formatTzs(wallet.pendingWithdrawalTzs, locale)}` : ""}
        </p>
      </div>
      <Link href="/wallet" className="btn btn-secondary w-auto px-4" data-testid="wallet-link">
        {wallet.availableTzs >= wallet.minTzs && wallet.pendingWithdrawalTzs === 0 ? t("withdraw") : t("open")}
      </Link>
    </Card>
  );
}

async function EarningsCard({ earnings, locale }: { earnings: Earnings; locale: "sw" | "en" }) {
  const t = await getTranslations("field.earnings");
  return (
    <Card data-testid="earnings">
      <h2 className="mb-2 font-semibold">{t("title")}</h2>
      <div className="grid grid-cols-2 gap-3">
        {(
          [
            ["thisWeek", earnings.receivedWeekTzs, earnings.paidWeekTzs, earnings.weekTzs, "earned-week"],
            ["thisMonth", earnings.receivedMonthTzs, earnings.paidMonthTzs, earnings.monthTzs, "earned-month"],
          ] as const
        ).map(([label, received, paid, net, testId]) => (
          <div key={label} className={`rounded-xl p-3 ${net < 0 ? "bg-amber-50" : "bg-green-50"}`}>
            <p className={`text-xs uppercase ${net < 0 ? "text-amber-900" : "text-green-800"}`}>{t(label)}</p>
            <p className={`text-xl font-bold ${net < 0 ? "text-amber-950" : "text-green-900"}`} data-testid={testId}>
              {t("net")} {formatTzs(net, locale)}
            </p>
            <p className="mt-1 text-xs text-stone-600">
              {t("received")} {formatTzs(received, locale)} · {t("paidOut")} {formatTzs(paid, locale)}
            </p>
          </div>
        ))}
      </div>
      {earnings.weekTzs < 0 ? <p className="mt-2 text-xs text-amber-900">{t("negativeNote")}</p> : null}
      <p className="mt-2 text-xs text-stone-500">{t("note")}</p>
    </Card>
  );
}

