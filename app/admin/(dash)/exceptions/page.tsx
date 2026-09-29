import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { Badge, Card, Field, IdemKey } from "@/components/ui";
import { Notice } from "@/components/notice";
import { requireAdmin } from "@/lib/auth/current";
import { openExceptions } from "@/lib/services/exceptions";
import { paymentsInReview } from "@/lib/services/admin";
import { formatTzs } from "@/lib/money";
import { flags, type SearchParams } from "@/lib/actions";
import { proposeResolutionAction } from "../actions";

export default async function ExceptionsPage({ searchParams }: { searchParams: SearchParams }) {
  const { actor } = await requireAdmin();
  const t = await getTranslations("admin.exceptions");
  const tp = await getTranslations("payment");
  const locale = (await getLocale()) as "sw" | "en";
  const { error, ok } = await flags(searchParams);
  const rows = await openExceptions(actor);
  const review = await paymentsInReview(actor);
  return (
    <>
      <h1 className="text-2xl font-bold">{t("title")}</h1>
      <Notice error={error} ok={ok} okNamespace="admin.exceptions" />
      <Card>
        <h2 className="mb-2 font-semibold">{(await getTranslations("admin"))("paymentsReview")}</h2>
        <ul className="divide-y divide-stone-100 text-sm">
          {review.map(({ intent, ref, orderId }) => (
            <li key={intent.id} className="flex items-center justify-between py-2">
              <span>
                <Link href={`/admin/orders/${orderId}`} className="font-mono underline">
                  {ref}
                </Link>{" "}
                · {intent.reviewReason ?? tp(intent.status)} · {intent.providerTxRef ?? "—"}
              </span>
              <span>{formatTzs(intent.amountTzs, locale)}</span>
            </li>
          ))}
          {review.length === 0 ? <li className="py-2 text-stone-500">—</li> : null}
        </ul>
      </Card>
      {rows.map((e) => (
        <Card key={e.id} data-testid="exception">
          <div className="flex items-start justify-between">
            <div>
              <Badge tone={e.lockedBatch ? "red" : "amber"}>{e.type.replace(/_/g, " ")}</Badge>
              <p className="mt-1 font-mono text-sm">{e.ref}</p>
              {e.note ? <p className="text-sm text-stone-700">{e.note}</p> : null}
              {e.orderId ? (
                <Link href={`/admin/orders/${e.orderId}`} className="text-sm underline">
                  order
                </Link>
              ) : null}
            </div>
            <Badge>{e.status.replace(/_/g, " ")}</Badge>
          </div>
          {e.status === "OPEN" ? (
            <form action={proposeResolutionAction} className="mt-3 grid gap-2 md:grid-cols-[1fr_2fr_auto]">
              <IdemKey />
              <input type="hidden" name="exceptionId" value={e.id} />
              <select name="outcome" className="field" defaultValue={e.lockedBatch ? "RESUME" : "CLOSE"}>
                <option value="RESUME">{t("RESUME")}</option>
                <option value="RETURN">{t("RETURN")}</option>
                <option value="CLOSE">{t("CLOSE")}</option>
              </select>
              <Field label={t("note")} htmlFor={`note-${e.id}`}>
                <input id={`note-${e.id}`} name="note" className="field" required minLength={3} maxLength={500} />
              </Field>
              <button type="submit" className="btn btn-primary self-end md:w-48">
                {t("propose")}
              </button>
            </form>
          ) : null}
        </Card>
      ))}
    </>
  );
}
