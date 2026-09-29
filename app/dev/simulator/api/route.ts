/**
 * JSON simulator API for e2e tests: same hard guard as the page, plus the
 * CRON_SECRET bearer so Playwright needs no admin cookie.
 */
import { simulatorEnabled } from "@/lib/env";
import { cronAuthorized } from "@/lib/security/cron";
import { simulate, SCENARIOS, type Scenario } from "@/lib/payments/simulator";
import { enqueueStalePolls, runDueVerificationJobs } from "@/lib/payments/verification";
import { runDailyReconciliation } from "@/lib/services/reconciliation";
import { runAnchor, confirmSubmittedAnchors } from "@/lib/ledger/anchor";
import { getDb } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import { desc, eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!simulatorEnabled()) return new Response(null, { status: 404 });
  if (!cronAuthorized(request)) return new Response(null, { status: 401 });
  const body = (await request.json().catch(() => ({}))) as { op?: string; scenario?: string; orderRef?: string; amountTzs?: number; purpose?: string };
  switch (body.op) {
    case "simulate": {
      if (!SCENARIOS.includes(body.scenario as Scenario) || !body.orderRef) return new Response(null, { status: 400 });
      return Response.json(await simulate(body.scenario as Scenario, body.orderRef, { amountTzs: body.amountTzs }));
    }
    case "poll":
      return Response.json({ enqueued: await enqueueStalePolls(0), outcomes: await runDueVerificationJobs() });
    case "reconcile":
      return Response.json(await runDailyReconciliation());
    case "anchor":
      await confirmSubmittedAnchors();
      return Response.json(await runAnchor());
    case "lastSms": {
      const rows = await getDb().query.smsOutbox.findMany({ where: body.purpose ? eq(s.smsOutbox.purpose, body.purpose) : undefined, orderBy: desc(s.smsOutbox.createdAt), limit: 1 });
      return Response.json(rows[0] ?? null);
    }
    case "confirmedPayments": {
      // For e2e statement-import tests: the provider references we have confirmed.
      const rows = await getDb()
        .select({ providerTxRef: s.paymentIntents.providerTxRef, amountTzs: s.paymentIntents.confirmedAmountTzs, payeeAccount: s.paymentIntents.payeeAccount })
        .from(s.paymentIntents)
        .where(eq(s.paymentIntents.status, "PAYMENT_CONFIRMED"));
      return Response.json(rows);
    }
    default:
      return new Response(null, { status: 400 });
  }
}

export function GET() {
  return new Response(null, { status: simulatorEnabled() ? 405 : 404 });
}
