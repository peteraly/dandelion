import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { eq } from "drizzle-orm";
import { Card, PrimaryButton } from "@/components/ui";
import { Notice } from "@/components/notice";
import { requireAdmin } from "@/lib/auth/current";
import { reconOverview } from "@/lib/services/admin";
import { formatDateTime } from "@/lib/util/time";
import { flags, type SearchParams } from "@/lib/actions";
import { aiEnabled } from "@/lib/env";
import { aiExplainAnomaly } from "@/lib/services/ai-gateway";
import { getDb } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import { resolveFlagAction, runReconciliationAction } from "../actions";

export default async function ReconciliationPage({ searchParams }: { searchParams: SearchParams }) {
  const { actor } = await requireAdmin();
  const t = await getTranslations("admin.recon");
  const tb = await getTranslations("admin.brief");
  const locale = (await getLocale()) as "sw" | "en";
  const sp = await searchParams;
  const { error, ok } = await flags(searchParams);
  const { lastRun, flags: open } = await reconOverview(actor);
  const explainId = typeof sp.explain === "string" ? sp.explain : null;
  let explanation: string | null = null;
  if (explainId && aiEnabled()) {
    const f = open.find((x) => x.flag.id === explainId);
    if (f) {
      const order = f.flag.orderId ? await getDb().query.orders.findFirst({ where: eq(s.orders.id, f.flag.orderId), columns: { kind: true, state: true } }) : null;
      explanation = await aiExplainAnomaly(actor, { kind: f.flag.kind, details: f.flag.details as Record<string, unknown>, orderKind: order?.kind, orderState: order?.state })
        .then((r) => r.explanation)
        .catch(() => null);
    }
  }
  return (
    <>
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{t("title")}</h1>
        <form action={runReconciliationAction} className="w-40">
          <PrimaryButton>{t("run")}</PrimaryButton>
        </form>
      </div>
      <Notice error={error} ok={ok} />
      {lastRun ? <p className="text-sm text-stone-600">{t("lastRun", { time: formatDateTime(lastRun.createdAt, locale), checked: lastRun.checked, mismatched: lastRun.mismatched })}</p> : null}
      <Card>
        <h2 className="mb-2 font-semibold">{t("flags")}</h2>
        <ul className="divide-y divide-stone-100 text-sm">
          {open.map(({ flag, ref }) => (
            <li key={flag.id} className="py-2">
              <div className="flex items-center justify-between gap-2">
                <span>
                  <span className="font-semibold">{flag.kind.replace(/_/g, " ")}</span> ·{" "}
                  {flag.orderId ? (
                    <Link href={`/admin/orders/${flag.orderId}`} className="font-mono underline">
                      {ref}
                    </Link>
                  ) : null}{" "}
                  <span className="text-stone-500">{JSON.stringify(flag.details)}</span>
                </span>
                <span className="flex gap-2">
                  {aiEnabled() ? (
                    <Link href={`/admin/reconciliation?explain=${flag.id}`} className="rounded-lg border border-stone-300 px-3 py-2 text-xs">
                      {t("explain")}
                    </Link>
                  ) : null}
                  <form action={resolveFlagAction}>
                    <input type="hidden" name="flagId" value={flag.id} />
                    <button type="submit" className="rounded-lg border border-stone-300 px-3 py-2 text-xs">
                      {t("resolve")}
                    </button>
                  </form>
                </span>
              </div>
              {explainId === flag.id && explanation ? (
                <p className="mt-2 rounded-lg bg-brand-50 p-2 text-brand-900" data-testid="ai-explanation">
                  {explanation}
                  <span className="block text-xs text-stone-500">{tb("draft")}</span>
                </p>
              ) : null}
            </li>
          ))}
          {open.length === 0 ? <li className="py-2 text-stone-500">—</li> : null}
        </ul>
      </Card>
    </>
  );
}
