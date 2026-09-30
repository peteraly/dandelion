/**
 * Dev simulator (build prompt §8). Hard guard: 404 unless
 * VERCEL_ENV !== 'production' AND SIMULATOR_ENABLED=true. Admin session required.
 */
import { notFound } from "next/navigation";
import { desc, inArray } from "drizzle-orm";
import { Card, Field, PrimaryButton } from "@/components/ui";
import { requireAdmin } from "@/lib/auth/current";
import { simulatorEnabled } from "@/lib/env";
import { getDb } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import { SCENARIOS } from "@/lib/payments/simulator";
import type { SearchParams } from "@/lib/actions";
import { demoStatus } from "@/lib/demo/tick";
import { resetPreconditions } from "@/lib/demo/reset";
import { simulateAction, runJobsAction, tickAction, resetDemoAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function SimulatorPage({ searchParams }: { searchParams: SearchParams }) {
  if (!simulatorEnabled()) notFound();
  const { session } = await requireAdmin();
  const sp = await searchParams;
  const result = typeof sp.result === "string" ? sp.result : null;
  const orders = await getDb().query.orders.findMany({ where: inArray(s.orders.state, ["AWAITING_PAYMENT", "PLAN_ACTIVE"]), orderBy: desc(s.orders.updatedAt), limit: 50 });
  const outbox = await getDb().query.smsOutbox.findMany({ orderBy: desc(s.smsOutbox.createdAt), limit: 15 });
  const demo = await demoStatus();
  const isDemo = demo.profile === "demo";
  const pre = resetPreconditions();
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4 p-4">
      <h1 className="text-2xl font-bold">Dev simulator — MockProvider</h1>
      <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-950">Non-production only. Fires provider callbacks through the real ingestion and verification path.</p>
      {result ? (
        <pre className="overflow-x-auto rounded-xl bg-stone-900 p-3 text-xs text-green-200" data-testid="sim-result">
          {result}
        </pre>
      ) : null}
      <Card>
        <form action={simulateAction} className="grid gap-3 md:grid-cols-4">
          <Field label="Order" htmlFor="orderRef">
            <select id="orderRef" name="orderRef" className="field" required>
              {orders.map((o) => (
                <option key={o.id} value={o.ref}>
                  {o.ref} · {o.kind} · {o.state} · {o.totalTzs}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Scenario" htmlFor="scenario">
            <select id="scenario" name="scenario" className="field" defaultValue="success">
              {SCENARIOS.map((sc) => (
                <option key={sc} value={sc}>
                  {sc}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Amount (blank = remaining)" htmlFor="amountTzs">
            <input id="amountTzs" name="amountTzs" type="number" min={1} className="field" />
          </Field>
          <div className="self-end">
            <PrimaryButton>Fire</PrimaryButton>
          </div>
        </form>
      </Card>
      <form action={runJobsAction}>
        <button type="submit" className="btn btn-secondary">
          Run due verification jobs (poller)
        </button>
      </form>
      <Card id="living-demo" data-testid="living-demo">
        <h2 className="mb-1 font-semibold">Living demo</h2>
        <p className="text-sm text-stone-700">
          Dataset: <b data-testid="demo-profile">{demo.profile || "none"}</b>
          {isDemo ? ` · scale ${demo.scale} · seed ${demo.seed} · ${demo.ticks} tick${demo.ticks === 1 ? "" : "s"} so far` : " — the buttons below need the demo profile (SEED_PROFILE=demo on an empty database)."}
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <form action={tickAction}>
            <input type="hidden" name="kind" value="hour" />
            <button type="submit" className="btn btn-secondary" disabled={!isDemo} data-testid="tick-hour">
              Simulate one hour
            </button>
          </form>
          <form action={tickAction}>
            <input type="hidden" name="kind" value="day" />
            <button type="submit" className="btn btn-secondary" disabled={!isDemo} data-testid="tick-day">
              Simulate one day
            </button>
          </form>
        </div>
        <p className="mt-2 text-xs text-stone-500">New activity on the real clock through the real services, then the poller — and for a day, reconciliation and anchoring — run here because previews have no crons. Limit: 6 per 10 minutes; every tick is in the admin log.</p>
{session.via !== "OPEN_DEMO" ? (
        <details className="mt-4 rounded-xl border border-red-200 p-3">
          <summary className="cursor-pointer font-semibold text-red-800">Reset to the demo dataset</summary>
          <p className="mt-2 text-sm text-stone-700">Wipes this database and asks Vercel to rebuild it with the demo profile. Everything anyone did in the demo is gone; every session ends, yours too.</p>
          {pre.problems.length > 0 ? (
            <ul className="mt-2 list-disc pl-5 text-sm text-stone-700" data-testid="reset-problems">
              {pre.problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          ) : null}
          <form action={resetDemoAction} className="mt-3 flex flex-wrap items-end gap-2">
            <Field label='Type "demo" to confirm' htmlFor="confirm">
              <input id="confirm" name="confirm" className="field" autoComplete="off" required pattern="demo" />
            </Field>
            <button type="submit" className="btn btn-danger" disabled={!pre.ok} data-testid="reset-demo">
              Wipe and rebuild
            </button>
          </form>
        </details>
        ) : null}
      </Card>
      <Card>
        <h2 className="mb-2 font-semibold">Mock SMS outbox</h2>
        <ul className="divide-y divide-stone-100 text-xs">
          {outbox.map((m) => (
            <li key={m.id} className="py-2" data-testid="sms">
              <span className="font-semibold">{m.purpose}</span> · {m.body}
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
