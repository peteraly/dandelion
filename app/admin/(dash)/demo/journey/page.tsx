/**
 * The guided walkthrough (Prompt H): one sale across every stakeholder, a
 * step per click (or ▶ to play), with each person's phone on screen — the
 * text messages the system sent them and what their app says now. Demo
 * dataset only; every step is the real service call (lib/demo/journey.ts).
 */
import Link from "next/link";
import { notFound } from "next/navigation";
import { desc, eq, inArray } from "drizzle-orm";
import { getLocale, getTranslations } from "next-intl/server";
import { Card } from "@/components/ui";
import { Notice } from "@/components/notice";
import { Name, displayName } from "@/components/name";
import { Phone, type PhoneMessage } from "@/components/phone";
import { JourneyAuto } from "@/components/journey-auto";
import { isDemoDataset } from "@/components/demo-banner";
import { requireAdmin } from "@/lib/auth/current";
import { simulatorEnabled } from "@/lib/env";
import { getDb } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import { phoneBlindIndex } from "@/lib/crypto/blind-index";
import { extrasFor, homeFor, snapshotFor } from "@/lib/services/home";
import { rowForOrder } from "@/lib/domain/workflows";
import type { FieldRole } from "@/lib/domain/types";
import { formatTzs } from "@/lib/money";
import { JOURNEY_STEPS, journeyOrderIds, journeyPeople, journeyState, type JourneyRole } from "@/lib/demo/journey";
import { flags, type SearchParams } from "@/lib/actions";
import type { Actor } from "@/lib/policy";
import { journeyStartAction, journeyStepAction } from "./actions";

export const dynamic = "force-dynamic";

const ROLE_KEY: Record<JourneyRole, string> = { customer: "roles.CUSTOMER", seller: "roles.FIELD_CHAMPION", hub: "roles.HUB_MANAGER", rider: "roles.BOSS_RIDER", supplier: "roles.SUPPLIER", founder: "admin.journey.founder" };
const hhmm = (d: Date, locale: string) => d.toLocaleTimeString(locale === "sw" ? "sw-TZ" : "en-GB", { timeZone: "Africa/Dar_es_Salaam", hour: "2-digit", minute: "2-digit" });

export default async function JourneyPage({ searchParams }: { searchParams: SearchParams }) {
  await requireAdmin();
  if (!simulatorEnabled() || !(await isDemoDataset())) notFound();
  const t = await getTranslations();
  const tj = await getTranslations("admin.journey");
  const locale = (await getLocale()) as "sw" | "en";
  const { error } = await flags(searchParams);
  const st = await journeyState();
  const total = JOURNEY_STEPS.length;
  const done = !!st && st.step >= total;
  const next = st && !done ? JOURNEY_STEPS[st.step]! : null;
  const last = st?.log[st.log.length - 1];
  const lit = new Set<JourneyRole>(last ? JOURNEY_STEPS.find((x) => x.key === last.key)!.phones : (next?.phones ?? []));
  const role = (r: JourneyRole) => t(ROLE_KEY[r]);

  const ids = st ? journeyOrderIds(st).reverse() : [];
  const orders = ids.length ? (await getDb().select().from(s.orders).where(inArray(s.orders.id, ids))).sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id)) : [];
  const phones = st
    ? await Promise.all(
        (await journeyPeople(st)).map(async (p) => {
          const rows = await getDb().select().from(s.smsOutbox).where(eq(s.smsOutbox.toIndex, phoneBlindIndex(p.phone))).orderBy(desc(s.smsOutbox.createdAt)).limit(5);
          const messages: PhoneMessage[] = rows.reverse().map((m) => ({ id: m.id, body: m.body, at: hhmm(m.createdAt, locale), fresh: m.createdAt.getTime() >= new Date(st.lastAt).getTime() && st.log.length > 0 }));
          let app: { status: string; next: string } | null = null;
          if (p.userId) {
            const u = await getDb().query.users.findFirst({ where: eq(s.users.id, p.userId) });
            if (u) {
              const actor = { userId: u.id, role: u.role, hubId: u.hubId, supplierId: u.supplierId, mfa: false } as Actor;
              // What their app says about this sale: the latest of its orders they take part in. Their move → that row; someone else's
              // move → "waiting for" them; before the sale reaches them → their home screen.
              const { championStockUnits } = await extrasFor(actor);
              for (const o of orders) {
                if (app || (o.buyerUserId !== u.id && o.sellerUserId !== u.id)) continue;
                const row = rowForOrder(u.role as FieldRole, await snapshotFor(actor, o), { championStockUnits });
                if (row) app = { status: t(`home.status.${row.status}.title`), next: t(`home.action.${row.action}`) };
                else if (!["COMPLETED", "CANCELLED", "CLOSED"].includes(o.state) && next) app = { status: tj("waitingTitle"), next: tj("waitingFor", { who: role(next.who) }) };
              }
              if (!app) {
                const view = await homeFor(actor);
                app = { status: t(`home.status.${view.status}.title`), next: t(`home.action.${view.action}`) };
              }
            }
          }
          return { ...p, messages, app };
        }),
      )
    : [];
  // The people the last step touched come first, so the text that just arrived is on screen without scrolling.
  phones.sort((a, b) => Number(lit.has(b.role)) - Number(lit.has(a.role)));
  const fact = (f: Record<string, string | number>) =>
    [f.ref ? String(f.ref) : "", typeof f.tzs === "number" ? formatTzs(f.tzs, locale) : "", typeof f.units === "number" ? tj("units", { n: f.units }) : "", f.suggested !== undefined ? tj("suggested", { n: f.suggested, days: String(f.daysLeft) }) : ""].filter(Boolean).join(" · ");

  return (
    <>
      <header>
        <h1 className="text-2xl font-bold">{tj("title")}</h1>
        <p className="text-sm text-stone-600">{tj("intro")}</p>
      </header>
      <Notice error={error} />

      {!st ? (
        <Card className="flex flex-col gap-3" data-testid="journey-start">
          <p>{tj("startWhat")}</p>
          <form action={journeyStartAction}>
            <button type="submit" className="btn btn-primary w-auto px-5 text-base" data-testid="journey-begin">
              {tj("start")}
            </button>
          </form>
        </Card>
      ) : (
        <>
          <Card className="flex flex-col gap-3" data-testid="journey-controls">
            <div className="flex items-center justify-between gap-3 text-sm">
              <span className="font-medium" data-testid="journey-progress">
                {tj("progress", { n: Math.min(st.step, total), total })}
              </span>
              <form action={journeyStartAction}>
                <button type="submit" className="text-sm underline" data-testid="journey-restart">
                  {tj("restart")}
                </button>
              </form>
            </div>
            <progress className="h-2 w-full accent-brand-600" max={total} value={st.step} aria-label={tj("progress", { n: st.step, total })} />
            {next ? (
              <div className="rounded-xl bg-brand-50 p-3" data-testid="journey-next">
                <p className="text-xs font-medium uppercase tracking-wide text-brand-800">
                  {tj("nextBy", { who: role(next.who) })}
                </p>
                <p className="text-lg font-semibold">{tj(`steps.${next.key}.title`)}</p>
                <p className="text-sm text-stone-700">{tj(`steps.${next.key}.what`)}</p>
              </div>
            ) : (
              <p className="rounded-xl bg-green-50 p-3 text-green-900" data-testid="journey-done">
                {tj("done")}
              </p>
            )}
            {st.error ? (
              <p className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950" role="alert" data-testid="journey-error">
                {t.has(`errors.${st.error}`) ? t(`errors.${st.error}`) : st.error}
              </p>
            ) : null}
            <div className="flex flex-wrap items-center gap-2">
              {next ? (
                <form action={journeyStepAction}>
                  <button type="submit" className="btn btn-primary w-auto px-5 text-base" data-testid="journey-step">
                    {tj("doStep", { step: tj(`steps.${next.key}.title`) })}
                  </button>
                </form>
              ) : (
                <>
                  <Link href="/admin/ecosystem" className="btn btn-primary w-auto px-5 text-base">
                    {tj("seeMap")}
                  </Link>
                  <form action={journeyStartAction}>
                    <button type="submit" className="btn btn-secondary w-auto px-5 text-base">
                      {tj("again")}
                    </button>
                  </form>
                </>
              )}
              <JourneyAuto seconds={4} done={done} labels={{ play: tj("play"), stop: tj("stop") }} />
            </div>
          </Card>

          <section aria-label={tj("phones")} data-testid="journey-phones">
            <h2 className="mb-2 font-semibold">{tj("phones")}</h2>
            <div className="-mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-2 lg:mx-0 lg:flex-wrap lg:overflow-visible lg:px-0" tabIndex={0}>
              {phones.map((p) => (
                <Phone
                  key={p.role}
                  testid={`phone-${p.role}`}
                  name={displayName(p.name)}
                  role={role(p.role)}
                  time={hhmm(new Date(), locale)}
                  active={lit.has(p.role)}
                  app={p.app}
                  messages={p.messages}
                  labels={{ messages: tj("messages"), none: tj("noMessages"), smsOnly: tj("smsOnly"), app: tj("app"), next: tj("appNext"), justNow: tj("justNow") }}
                />
              ))}
            </div>
          </section>

          <Card>
            <h2 className="mb-2 font-semibold">{tj("allSteps")}</h2>
            <ol className="flex flex-col gap-1 text-sm" data-testid="journey-steps">
              {JOURNEY_STEPS.map((x, i) => {
                const logged = st.log.find((l) => l.key === x.key);
                const state = i < st.step ? "done" : i === st.step ? "next" : "later";
                return (
                  <li key={x.key} className={`flex gap-2 rounded-lg px-2 py-1.5 ${state === "next" ? "bg-brand-50 font-medium" : ""} ${state === "later" ? "text-stone-500" : ""}`} data-state={state}>
                    <span aria-hidden="true" className="w-5 shrink-0 text-center">
                      {state === "done" ? "✓" : i + 1}
                    </span>
                    <span className="min-w-0">
                      <span className="mr-1 rounded bg-stone-100 px-1.5 py-0.5 text-[11px] text-stone-700">{role(x.who)}</span>
                      {tj(`steps.${x.key}.title`)}
                      {logged && fact(logged.facts) ? <span className="block font-mono text-xs text-stone-500">{fact(logged.facts)}</span> : null}
                    </span>
                  </li>
                );
              })}
            </ol>
            <p className="mt-3 text-xs text-stone-600">
              {tj("customerIs")} <Name value={st.customerName} />
            </p>
          </Card>
        </>
      )}
    </>
  );
}
