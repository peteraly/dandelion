import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { eq } from "drizzle-orm";
import { Card, LinkButton } from "@/components/ui";
import { OrderSummary } from "@/components/order-bits";
import { requireField } from "@/lib/auth/current";
import { homeFor } from "@/lib/services/home";
import { getDb } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import type { ActionKey } from "@/lib/domain/workflows";
import { formatTzs } from "@/lib/money";

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
      {others.length > 0 ? (
        <Card>
          <p className="mb-2 text-sm font-semibold text-stone-600">
            {others.length} {t("orderKinds.SUPPLIER_TO_RIDER").length ? "" : ""}
            {t("common.status")}
          </p>
          <ul className="divide-y divide-stone-100">
            {others.map((o) => (
              <li key={o.id}>
                <Link href={`/orders/${o.id}`} className="flex items-center justify-between py-3">
                  <span>
                    <span className="font-mono text-sm">{o.ref}</span>
                    <span className="block text-sm text-stone-600">{t(`orderKinds.${o.kind}`)}</span>
                  </span>
                  <span className="text-sm text-stone-500">→</span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
      <nav className="grid grid-cols-2 gap-2 text-sm">
        {actor.role === "FIELD_CHAMPION" ? (
          <Link href="/customers" className="btn btn-secondary">
            {t("field.customer.list")}
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
