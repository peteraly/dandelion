/**
 * Poller (build prompt §8): retries verification jobs whose waitUntil failed
 * and polls still-pending intents so a missed callback never strands a payment.
 */
import { enqueueStalePolls, runDueVerificationJobs } from "@/lib/payments/verification";
import { cronAuthorized, heartbeat } from "@/lib/security/cron";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  if (!cronAuthorized(request)) return new Response(null, { status: 401 });
  try {
    const enqueued = await enqueueStalePolls();
    const outcomes = await runDueVerificationJobs(50);
    await heartbeat("poller", "ok", { enqueued, ran: outcomes.length });
    return Response.json({ enqueued, outcomes });
  } catch (e) {
    await heartbeat("poller", "error", { message: (e as Error).message });
    throw e;
  }
}
