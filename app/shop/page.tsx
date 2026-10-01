/**
 * The shop (Prompt L §3). Signed out: what is on sale where, and how it works. Signed in: ask for a pack at a public
 * meeting point, see who accepted it, what to pay and how, and where to meet.
 */
import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { PublicShell } from "@/components/shell";
import { Badge, Card, Field, IdemKey, PrimaryButton } from "@/components/ui";
import { Notice } from "@/components/notice";
import { currentCustomer } from "@/lib/auth/current";
import { shopAreas, shopHome, type ShopOrderRow } from "@/lib/services/shop";
import { formatTzs } from "@/lib/money";
import { formatDateTime } from "@/lib/util/time";
import { flags, type SearchParams } from "@/lib/actions";
import { cancelRequestAction, requestOrderAction, setShopPlaceAction, signOutShopAction } from "./actions";
import { PlaceSelect } from "./place-select";

export const dynamic = "force-dynamic";

const TONE = { OPEN: "amber", ACCEPTED: "purple", CANCELLED: "neutral", EXPIRED: "neutral" } as const;

export default async function ShopPage({ searchParams }: { searchParams: SearchParams }) {
  const t = await getTranslations("shop");
  const locale = (await getLocale()) as "sw" | "en";
  const { error, ok } = await flags(searchParams);
  const tzs = (n: number) => formatTzs(n, locale);
  const customer = await currentCustomer();

  if (!customer) {
    // The public catalogue must not fail when the database is unreachable (e.g. a fresh preview).
    const areas = await shopAreas().catch(() => []);
    return (
      <PublicShell path="/shop">
        <h1 className="text-2xl font-bold">{t("title")}</h1>
        <p className="text-lg">{t("hero")}</p>
        <Notice error={error} ok={ok} okNamespace="shop" />
        <div className="grid grid-cols-2 gap-2">
          <Link href="/shop/join" className="btn btn-primary" data-testid="shop-join">
            {t("join")}
          </Link>
          <Link href="/shop/sign-in" className="btn btn-secondary" data-testid="shop-sign-in">
            {t("signIn")}
          </Link>
        </div>
        <Card>
          <h2 className="mb-2 text-lg font-semibold">{t("howTitle")}</h2>
          <ol className="list-decimal space-y-2 pl-5">
            {(["1", "2", "3", "4"] as const).map((k) => (
              <li key={k}>{t(`how.${k}`)}</li>
            ))}
          </ol>
        </Card>
        <SafetyNote />
        <Card data-testid="shop-catalogue">
          <h2 className="mb-2 text-lg font-semibold">{t("whereTitle")}</h2>
          {areas.length === 0 ? <p className="text-stone-600">{t("nowhereYet")}</p> : null}
          {areas.map((a) => (
            <div key={a.id} className="mb-3">
              <p className="font-medium">
                {a.name} <span className="text-sm text-stone-500">· {a.region}</span>
              </p>
              <ul className="text-sm">
                {a.products.map((p) => (
                  <li key={p.id} className="flex justify-between gap-2 py-1">
                    <span>{p.name}</span>
                    <span className="font-semibold tabular-nums">{tzs(p.priceTzs)}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </Card>
      </PublicShell>
    );
  }

  const home = await shopHome(customer);
  return (
    <PublicShell path="/shop">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-2xl font-bold">{t("hello", { name: customer.displayName })}</h1>
        <form action={signOutShopAction}>
          <button type="submit" className="text-sm text-stone-600 underline" data-testid="shop-sign-out">
            {t("signOut")}
          </button>
        </form>
      </div>
      <Notice error={error} ok={ok} okNamespace="shop" />

      {!home.home ? (
        <Card data-testid="shop-choose-place">
          <h2 className="mb-1 font-semibold">{t("choosePlace")}</h2>
          <p className="mb-2 text-sm text-stone-600">{home.areas.length ? t("choosePlaceHint") : t("nowhereYet")}</p>
          {home.areas.length ? (
            <form action={setShopPlaceAction} className="flex flex-col gap-3">
              <IdemKey />
              <Field label={t("place")} htmlFor="meetingPointId">
                <PlaceSelect areas={home.areas} id="meetingPointId" />
              </Field>
              <PrimaryButton>{t("savePlace")}</PrimaryButton>
            </form>
          ) : null}
        </Card>
      ) : home.canOrder ? (
        <Card data-testid="shop-order">
          <h2 className="mb-1 font-semibold">{t("orderTitle")}</h2>
          <p className="mb-3 text-sm text-stone-600">{t("orderHint", { area: home.home.name })}</p>
          <form action={requestOrderAction} className="flex flex-col gap-3">
            <IdemKey />
            <fieldset className="flex flex-col gap-2">
              <legend className="label">{t("product")}</legend>
              {home.home.products.map((p, i) => (
                <label key={p.id} className="check rounded-xl border border-stone-200 p-3">
                  <input type="radio" name="productId" value={p.id} defaultChecked={i === 0} required className="mt-0.5" />
                  <span className="flex flex-1 justify-between gap-2">
                    <span>
                      {p.name}
                      <span className="block text-xs text-stone-500">{p.unitDescription}</span>
                    </span>
                    <span className="font-semibold tabular-nums">{tzs(p.priceTzs)}</span>
                  </span>
                </label>
              ))}
            </fieldset>
            <Field label={t("place")} htmlFor="meetingPointId" hint={t("placeHint")}>
              <PlaceSelect areas={[home.home]} id="meetingPointId" defaultValue={customer.meetingPointId} />
            </Field>
            <PrimaryButton>{t("submit")}</PrimaryButton>
          </form>
        </Card>
      ) : null}

      <Card data-testid="shop-orders">
        <h2 className="mb-2 font-semibold">{t("myOrders")}</h2>
        {home.orders.length === 0 ? <p className="text-sm text-stone-500">{t("noOrders")}</p> : null}
        <ul className="flex flex-col gap-3">
          {home.orders.map((o) => (
            <OrderRow key={o.id} o={o} locale={locale} />
          ))}
        </ul>
      </Card>
      <SafetyNote />
      {home.home ? (
        <details className="text-sm">
          <summary className="cursor-pointer text-stone-600">{t("changePlace")}</summary>
          <form action={setShopPlaceAction} className="mt-2 flex flex-col gap-2">
            <IdemKey />
            <PlaceSelect areas={home.areas} id="newPlace" defaultValue={customer.meetingPointId} label={t("place")} />
            <button type="submit" className="btn btn-secondary">
              {t("savePlace")}
            </button>
          </form>
        </details>
      ) : null}
    </PublicShell>
  );
}

async function OrderRow({ o, locale }: { o: ShopOrderRow; locale: "sw" | "en" }) {
  const t = await getTranslations("shop");
  const tzs = (n: number) => formatTzs(n, locale);
  const step = o.order ? orderStep(o.order) : null;
  return (
    <li className="rounded-xl border border-stone-200 p-3" data-testid="shop-order-row" data-state={o.state} data-order-state={o.order?.state ?? ""}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="font-medium">
          {o.productName} <span className="font-mono text-xs text-stone-500">{o.ref}</span>
        </p>
        <Badge tone={step === "done" ? "green" : TONE[o.state]}>{step ? t(`steps.${step}`) : t(`states.${o.state}`)}</Badge>
      </div>
      <p className="text-sm text-stone-600">
        {t("meetAt", { place: o.placeName })} · {formatDateTime(o.createdAt, locale)}
      </p>
      {o.state === "OPEN" ? (
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-amber-950">{t("waiting")}</p>
          <form action={cancelRequestAction}>
            <IdemKey />
            <input type="hidden" name="requestId" value={o.id} />
            <button type="submit" className="btn btn-secondary w-auto px-4 text-sm" data-testid="shop-cancel">
              {t("cancel")}
            </button>
          </form>
        </div>
      ) : null}
      {o.state === "EXPIRED" ? <p className="mt-2 text-sm text-stone-600">{t("expired")}</p> : null}
      {o.order ? (
        <div className="mt-2 flex flex-col gap-2 text-sm">
          {o.sellerName ? <p>{t("acceptedBy", { name: o.sellerName })}</p> : null}
          {step === "pay" && o.order.payee ? (
            <p className="rounded-xl bg-amber-50 p-3 text-amber-950" data-testid="shop-pay">
              {t("payNow", { amount: tzs(o.order.remainingTzs), payee: o.order.payee, reference: o.order.paymentRef })}
              {o.order.paidTzs > 0 ? <span className="block">{t("paidSoFar", { paid: tzs(o.order.paidTzs), total: tzs(o.order.totalTzs) })}</span> : null}
              <span className="mt-1 block text-xs">{t("payNote")}</span>
            </p>
          ) : null}
          {step === "meet" ? (
            <p className="rounded-xl bg-green-50 p-3 text-green-900" data-testid="shop-meet">
              {t("paidMeet", { name: o.sellerName ?? "", place: o.placeName })}
            </p>
          ) : null}
          {step === "done" ? <p className="text-green-900">{t("handedOver")}</p> : null}
          {step === "stopped" ? <p className="text-stone-600">{t("stopped")}</p> : null}
        </div>
      ) : null}
    </li>
  );
}

function orderStep(o: NonNullable<ShopOrderRow["order"]>): "pay" | "meet" | "done" | "stopped" {
  if (o.state === "COMPLETED") return "done";
  if (o.state === "FULLY_PAID" || o.state === "HANDOVER_PENDING") return "meet";
  if (o.state === "PLAN_ACTIVE") return "pay";
  return "stopped";
}

async function SafetyNote() {
  const t = await getTranslations("shop");
  return (
    <Card className="border-sky-200 bg-sky-50" data-testid="shop-safety">
      <h2 className="mb-1 font-semibold">{t("safetyTitle")}</h2>
      <ul className="list-disc space-y-1 pl-5 text-sm">
        {(["1", "2", "3", "4"] as const).map((k) => (
          <li key={k}>{t(`safety.${k}`)}</li>
        ))}
      </ul>
      <Link href="/safety" className="mt-2 inline-block text-sm underline">
        {t("safetyMore")}
      </Link>
    </Card>
  );
}
