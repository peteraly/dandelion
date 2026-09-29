import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { and, eq, gte, or } from "drizzle-orm";
import { Card, Field, IdemKey, PrimaryButton } from "@/components/ui";
import { Notice } from "@/components/notice";
import { requireField } from "@/lib/auth/current";
import { REPORTABLE_PROBLEMS } from "@/lib/domain/types";
import { getDb } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import { flags, type SearchParams } from "@/lib/actions";
import { aiEnabled, helpContacts } from "@/lib/env";
import { reportProblemAction } from "../actions";
import { ProblemIntake } from "@/components/problem-intake";

export const dynamic = "force-dynamic";

export default async function ProblemPage({ searchParams }: { searchParams: SearchParams }) {
  const { actor } = await requireField();
  const t = await getTranslations();
  const sp = await searchParams;
  const { error } = await flags(searchParams);
  const orderId = typeof sp.orderId === "string" ? sp.orderId : "";
  const preset = typeof sp.type === "string" ? sp.type : "";
  const db = getDb();
  const order = orderId ? await db.query.orders.findFirst({ where: eq(s.orders.id, orderId) }) : null;
  // Stock the reporter is responsible for (own custody, or the hub's shelves) — a stock problem locks the chosen lot.
  const lots = order
    ? []
    : await db
        .select({ b: s.batches, product: s.products.name })
        .from(s.batches)
        .innerJoin(s.products, eq(s.products.id, s.batches.productId))
        .where(
          and(
            gte(s.batches.quantity, 1),
            actor.role === "HUB_MANAGER" && actor.hubId ? or(eq(s.batches.custodianUserId, actor.userId), eq(s.batches.hubId, actor.hubId)) : eq(s.batches.custodianUserId, actor.userId),
          ),
        )
        .orderBy(s.batches.createdAt);
  return (
    <>
      <h1 className="text-2xl font-bold">{t("problems.title")}</h1>
      <p>{t("problems.intro")}</p>
      <Notice error={error} />
      {preset === "PHONE_LOST" ? (
        <Card>
          <p className="font-semibold">{t("problems.PHONE_LOST.label")}</p>
          <p>{t("problems.PHONE_LOST.instruction")}</p>
          <Link href="/lock" className="btn btn-danger mt-3">
            {t("common.lockAccount")}
          </Link>
        </Card>
      ) : null}
      {preset === "CUSTOMER_UNWELL" ? <Referral /> : null}
      <Card>
        <form action={reportProblemAction} className="flex flex-col gap-3">
          <IdemKey />
          {order ? <input type="hidden" name="orderId" value={order.id} /> : null}
          {order ? (
            <p className="text-sm text-stone-600">
              {t("common.reference")}: <span className="font-mono">{order.ref}</span>
            </p>
          ) : null}
          <fieldset className="flex flex-col gap-2">
            <legend className="label">{t("problems.title")}</legend>
            {REPORTABLE_PROBLEMS.map((p) => (
              <label key={p} className="check">
                <input type="radio" name="type" value={p} required defaultChecked={preset === p} className="mt-1" />
                <span>
                  <span className="block font-semibold">{t(`problems.${p}.label`)}</span>
                  <span className="block text-sm text-stone-600">{t(`problems.${p}.instruction`)}</span>
                </span>
              </label>
            ))}
          </fieldset>
          {lots.length > 0 ? (
            <Field label={t("problems.whichStock")} htmlFor="batchId">
              <select id="batchId" name="batchId" className="field" defaultValue="">
                <option value="">—</option>
                {lots.map(({ b, product }) => (
                  <option key={b.id} value={b.id}>
                    {b.code} · {product} · {b.quantity} · {b.custodyState.replace(/_/g, " ")}
                  </option>
                ))}
              </select>
            </Field>
          ) : null}
          <Field label={t("problems.note")} htmlFor="note">
            <textarea id="note" name="note" className="field" rows={3} maxLength={500} />
          </Field>
          {aiEnabled() ? <ProblemIntake /> : null}
          <PrimaryButton>{t("common.submit")}</PrimaryButton>
        </form>
      </Card>
      <Link href="/problem?type=PHONE_LOST" className="text-center text-sm underline">
        {t("problems.PHONE_LOST.label")}
      </Link>
    </>
  );
}

async function Referral() {
  const t = await getTranslations("problems.referral");
  return (
    <Card className="border-amber-300 bg-amber-50">
      <p className="text-xs font-bold uppercase text-amber-800">{t("draft")}</p>
      <h2 className="text-lg font-semibold">{t("title")}</h2>
      <p className="mt-2">{t("body")}</p>
      <p className="mt-2 font-semibold">{t("helpline", { phone: helpContacts().phone })}</p>
    </Card>
  );
}
