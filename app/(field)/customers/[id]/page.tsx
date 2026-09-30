import { notFound } from "next/navigation";
import { Name } from "@/components/name";
import { getLocale, getTranslations } from "next-intl/server";
import { and, eq } from "drizzle-orm";
import { Card, Field, IdemKey, PrimaryButton } from "@/components/ui";
import { Notice } from "@/components/notice";
import { requireField } from "@/lib/auth/current";
import { can } from "@/lib/policy";
import { getDb } from "@/lib/db/client";
import { sellerAreaId } from "@/lib/services/areas";
import * as s from "@/lib/db/schema";
import { maskPhone } from "@/lib/phone";
import { decryptString } from "@/lib/crypto/envelope";
import { flags, type SearchParams } from "@/lib/actions";
import { formatTzs } from "@/lib/money";
import { resendCustomerOtpAction, startPlanAction, verifyCustomerAction } from "../../actions";

export const dynamic = "force-dynamic";

export default async function CustomerPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SearchParams }) {
  const { id } = await params;
  const { actor } = await requireField();
  const db = getDb();
  const customer = await db.query.customers.findFirst({ where: eq(s.customers.id, id) });
  if (!customer || !can(actor, "customer.view", { type: "customer", customer: { championId: customer.championId } })) notFound();
  const t = await getTranslations("field.customer");
  const tc = await getTranslations("common");
  const locale = (await getLocale()) as "sw" | "en";
  const sp = await searchParams;
  const { error, ok } = await flags(searchParams);
  const challenge = typeof sp.challenge === "string" ? sp.challenge : "";
  // Whoever sells — a champion at her hub, a rider with village stock, a supplier at the gate — offers the area's products at the area's customer price.
  const areaId = await sellerAreaId(actor);
  const products = areaId
    ? await db
        .select({ p: s.products, avail: s.productAreaAvailability, item: s.priceListItems })
        .from(s.productAreaAvailability)
        .innerJoin(s.products, eq(s.products.id, s.productAreaAvailability.productId))
        .innerJoin(s.priceListItems, eq(s.priceListItems.productId, s.products.id))
        .innerJoin(s.priceLists, and(eq(s.priceLists.id, s.priceListItems.priceListId), eq(s.priceLists.status, "ACTIVE"), eq(s.priceLists.serviceAreaId, areaId)))
        .where(and(eq(s.productAreaAvailability.serviceAreaId, areaId), eq(s.productAreaAvailability.available, true), eq(s.products.active, true)))
    : [];
  // Several suppliers' lists may be active in an area; they agree on the customer price (activePriceItem), so each product shows once.
  const offered = [...new Map(products.filter((r) => r.p.category !== "REUSABLE" || r.avail.washConditionsConfirmed).map((r) => [r.p.id, r])).values()];

  return (
    <>
      <h1 className="text-2xl font-bold">
        <Name value={customer.displayName} />
      </h1>
      <p className="text-stone-600">{maskPhone(await decryptString(customer.phoneEnc))}</p>
      <Notice error={error} ok={ok} okNamespace="field.customer" />
      {!customer.phoneVerifiedAt ? (
        <Card>
          <h2 className="font-semibold">{t("verifyPhone")}</h2>
          {challenge ? (
            <form action={verifyCustomerAction} className="mt-3 flex flex-col gap-3">
              <input type="hidden" name="customerId" value={customer.id} />
              <input type="hidden" name="challengeId" value={challenge} />
              <Field label={(await getTranslations("auth"))("enterCode")} htmlFor="code">
                <input id="code" name="code" className="field" inputMode="numeric" pattern="\d{6}" maxLength={6} required autoComplete="one-time-code" />
              </Field>
              <PrimaryButton>{tc("confirm")}</PrimaryButton>
            </form>
          ) : null}
          <form action={resendCustomerOtpAction} className="mt-3">
            <input type="hidden" name="customerId" value={customer.id} />
            <button type="submit" className="btn btn-secondary">
              {(await getTranslations("auth"))("sendCode")}
            </button>
          </form>
        </Card>
      ) : (
        <Card>
          <h2 className="font-semibold">{t("chooseProduct")}</h2>
          <p className="mb-3 text-sm text-stone-600">{t("fullPriceNote")}</p>
          <form action={startPlanAction} className="flex flex-col gap-3">
            <IdemKey />
            <input type="hidden" name="customerId" value={customer.id} />
            {offered.map((r) => (
              <label key={r.p.id} className="check">
                <input type="radio" name="productId" value={r.p.id} required className="mt-1" />
                <span>
                  <span className="block font-semibold">{r.p.name}</span>
                  <span className="block text-sm text-stone-600">{r.p.unitDescription}</span>
                  <span className="block font-semibold">{formatTzs(r.item.customerPriceTzs, locale)}</span>
                </span>
              </label>
            ))}
            {offered.length === 0 ? <p className="text-stone-500">—</p> : null}
            <p className="text-sm font-semibold">{tc("noPressure")}</p>
            <PrimaryButton disabled={offered.length === 0}>{t("startPlan")}</PrimaryButton>
          </form>
        </Card>
      )}
    </>
  );
}
