import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { eq, gte, sql } from "drizzle-orm";
import { Card, Field, IdemKey, PrimaryButton } from "@/components/ui";
import { Notice } from "@/components/notice";
import { requireAdmin } from "@/lib/auth/current";
import { getDb } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import { getSetting } from "@/lib/services/core";
import { paidTotals } from "@/lib/services/payments";
import { formatTzs } from "@/lib/money";
import { tzMonthStart } from "@/lib/util/time";
import { flags, type SearchParams } from "@/lib/actions";
import { donorFundingAction } from "../../../actions";

export default async function DonorPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SearchParams }) {
  const { id } = await params;
  await requireAdmin();
  const t = await getTranslations("admin.donor");
  const locale = (await getLocale()) as "sw" | "en";
  const { error } = await flags(searchParams);
  const db = getDb();
  const o = await db.query.orders.findFirst({ where: eq(s.orders.id, id) });
  if (!o || o.kind !== "CHAMPION_TO_CUSTOMER") notFound();
  const totals = await paidTotals(db, o);
  const cap = await getSetting("donorMonthlyCapTzs");
  const [used] = await db.select({ n: sql<number>`coalesce(sum(${s.donorFundings.amountTzs}),0)::int` }).from(s.donorFundings).where(gte(s.donorFundings.approvedAt, tzMonthStart()));
  return (
    <>
      <h1 className="text-2xl font-bold">{t("title")}</h1>
      <p className="rounded-xl bg-amber-50 p-3 text-amber-950">{t("intro")}</p>
      <p className="text-sm">{t("cap", { cap: formatTzs(cap, locale), used: formatTzs(Number(used?.n ?? 0), locale) })}</p>
      <Notice error={error} />
      <Card>
        <form action={donorFundingAction} className="flex flex-col gap-3">
          <IdemKey />
          <input type="hidden" name="orderId" value={o.id} />
          <p className="font-mono">{o.ref}</p>
          <Field label={t("donorRef")} htmlFor="donorRef">
            <input id="donorRef" name="donorRef" className="field" required minLength={2} maxLength={120} />
          </Field>
          <Field label={(await getTranslations("common"))("amount")} htmlFor="amountTzs" hint={`≤ ${formatTzs(totals.remainingTzs, locale)}`}>
            <input id="amountTzs" name="amountTzs" className="field" type="number" min={1} max={totals.remainingTzs} defaultValue={totals.remainingTzs} required />
          </Field>
          <Field label={t("evidence")} htmlFor="evidence">
            <input id="evidence" name="evidence" type="file" accept="application/pdf,image/jpeg,image/png" className="field" />
          </Field>
          <PrimaryButton>{(await getTranslations("common"))("submit")}</PrimaryButton>
        </form>
      </Card>
    </>
  );
}
