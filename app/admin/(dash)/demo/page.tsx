/**
 * The demo guide (Prompt D §5.1): the seven-beat script with deep links, the
 * accounts to use (phones only, never a credential), the simulator controls,
 * a warm-up button and what the demo does not claim. Demo profile only.
 */
import Link from "next/link";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { Card, Field } from "@/components/ui";
import { Notice } from "@/components/notice";
import { isDemoDataset } from "@/components/demo-banner";
import { requireAdmin } from "@/lib/auth/current";
import { simulatorEnabled } from "@/lib/env";
import { SEED } from "@/lib/seed-identities";
import { demoStatus } from "@/lib/demo/tick";
import { resetPreconditions } from "@/lib/demo/reset";
import { getSetting } from "@/lib/services/core";
import { formatDateTime } from "@/lib/util/time";
import { flags, type SearchParams } from "@/lib/actions";
import { resetDemoAction, tickAction } from "@/app/dev/simulator/actions";
import { warmUpAction } from "./actions";

export const dynamic = "force-dynamic";

const BEATS = ["landing", "map", "hour", "phone", "money", "verify", "earn"] as const;
const BEAT_HREF: Record<(typeof BEATS)[number], string> = { landing: "/", map: "/admin/ecosystem", hour: "/admin/ecosystem", phone: "/login", money: "/dev/simulator", verify: "/admin/messages", earn: "/admin/approvals" };

export default async function DemoGuidePage({ searchParams }: { searchParams: SearchParams }) {
  await requireAdmin();
  if (!(await isDemoDataset())) notFound();
  const t = await getTranslations("admin.demo");
  const locale = (await getLocale()) as "sw" | "en";
  const { ok, error } = await flags(searchParams);
  const status = await demoStatus();
  const pre = resetPreconditions();
  let generatedAt: Date | null = null;
  try {
    const raw = await getSetting("demoManifest");
    const parsed = (typeof raw === "string" ? JSON.parse(raw) : raw) as { generatedAt?: string } | null;
    generatedAt = parsed?.generatedAt ? new Date(parsed.generatedAt) : null;
  } catch {
    generatedAt = null;
  }
  const accounts: [string, string][] = [
    [t("accounts.admin"), SEED.adminA.phone],
    [t("accounts.supplier"), SEED.supplier.phone],
    [t("accounts.rider"), SEED.riders[0]!.phone],
    [t("accounts.hub"), SEED.hub.phone],
    [t("accounts.champion"), SEED.champions[0]!.phone],
  ];

  return (
    <>
      <h1 className="text-2xl font-bold">{t("title")}</h1>
      <p className="text-sm text-stone-600">{t("intro")}</p>
      <Notice error={error} ok={ok === "warm" ? undefined : ok} />
      {ok === "warm" ? (
        <p className="rounded-xl bg-green-50 p-3 text-sm text-green-900" data-testid="warm-ok">
          {t("warmDone")}
        </p>
      ) : null}

      <Card data-testid="demo-controls">
        <h2 className="mb-1 font-semibold">{t("controls.title")}</h2>
        <p className="text-sm text-stone-600">{t("controls.dataset", { scale: status.scale, ticks: status.ticks, generated: generatedAt ? formatDateTime(generatedAt, locale) : "—" })}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {simulatorEnabled()
            ? (["hour", "day"] as const).map((k) => (
                <form key={k} action={tickAction}>
                  <input type="hidden" name="kind" value={k} />
                  <input type="hidden" name="redirectTo" value="/admin/demo" />
                  <button type="submit" className="btn btn-secondary w-auto" data-testid={`guide-tick-${k}`}>
                    {t(`controls.${k}`)}
                  </button>
                </form>
              ))
            : null}
          <form action={warmUpAction}>
            <button type="submit" className="btn btn-secondary w-auto" data-testid="warm-up">
              {t("controls.warm")}
            </button>
          </form>
          <Link href="/admin/present" className="btn btn-secondary w-auto" data-testid="present-link">
            {t("controls.present")}
          </Link>
        </div>
        <p className="mt-2 text-xs text-stone-500">{t("controls.note")}</p>
        {simulatorEnabled() ? (
          <details className="mt-4 rounded-xl border border-red-200 p-3">
            <summary className="cursor-pointer font-semibold text-red-800">{t("reset.title")}</summary>
            <p className="mt-2 text-sm text-stone-700">{t("reset.explain")}</p>
            {pre.problems.length > 0 ? (
              <ul className="mt-2 list-disc pl-5 text-sm text-stone-700">
                {pre.problems.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            ) : null}
            <form action={resetDemoAction} className="mt-3 flex flex-wrap items-end gap-2">
              <Field label={t("reset.confirm")} htmlFor="confirm">
                <input id="confirm" name="confirm" className="field" autoComplete="off" required pattern="demo" />
              </Field>
              <button type="submit" className="btn btn-danger" disabled={!pre.ok}>
                {t("reset.button")}
              </button>
            </form>
          </details>
        ) : null}
      </Card>

      <Card data-testid="demo-script">
        <h2 className="mb-1 font-semibold">{t("script.title")}</h2>
        <p className="mb-3 text-sm text-stone-600">{t("script.intro")}</p>
        <ol className="divide-y divide-stone-100">
          {BEATS.map((b, i) => (
            <li key={b} className="py-3" data-testid="demo-beat">
              <div className="flex items-start gap-3">
                <span className="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-100 text-sm font-bold text-brand-800">{i + 1}</span>
                <div className="min-w-0">
                  <p className="font-semibold">
                    <Link href={BEAT_HREF[b]} className="underline">
                      {t(`script.${b}.where`)}
                    </Link>
                    <span className="ml-2 text-xs font-normal text-stone-500">{t(`script.${b}.time`)}</span>
                  </p>
                  <p className="text-sm text-stone-700">{t(`script.${b}.do`)}</p>
                  <p className="mt-1 text-sm italic text-stone-600">“{t(`script.${b}.say`)}”</p>
                </div>
              </div>
            </li>
          ))}
        </ol>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card data-testid="demo-accounts">
          <h2 className="mb-1 font-semibold">{t("accounts.title")}</h2>
          <p className="mb-2 text-sm text-stone-600">{t("accounts.note")}</p>
          <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-sm">
            {accounts.map(([label, phone]) => (
              <div key={label} className="contents">
                <dt className="text-stone-600">{label}</dt>
                <dd className="font-mono">{phone}</dd>
              </div>
            ))}
          </dl>
        </Card>
        <Card data-testid="demo-claims">
          <h2 className="mb-1 font-semibold">{t("claims.title")}</h2>
          <ul className="list-disc pl-5 text-sm text-stone-700">
            {(["money", "people", "district", "provider"] as const).map((k) => (
              <li key={k}>{t(`claims.${k}`)}</li>
            ))}
          </ul>
        </Card>
      </div>
    </>
  );
}
