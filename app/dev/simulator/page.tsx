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
import { simulateAction, runJobsAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function SimulatorPage({ searchParams }: { searchParams: SearchParams }) {
  if (!simulatorEnabled()) notFound();
  await requireAdmin();
  const sp = await searchParams;
  const result = typeof sp.result === "string" ? sp.result : null;
  const orders = await getDb().query.orders.findMany({ where: inArray(s.orders.state, ["AWAITING_PAYMENT", "PLAN_ACTIVE"]), orderBy: desc(s.orders.updatedAt), limit: 50 });
  const outbox = await getDb().query.smsOutbox.findMany({ orderBy: desc(s.smsOutbox.createdAt), limit: 15 });
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
