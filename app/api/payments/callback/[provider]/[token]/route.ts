/**
 * Payment provider callback (build prompt §8). Server-to-server; no CORS.
 * Persists the raw payload, enqueues a VerificationJob, returns 200. The
 * job runs right after the response (waitUntil) and is also picked up by
 * the cron poller if that fails.
 */
import { after } from "next/server";
import { ingestCallback } from "@/lib/payments/callbacks";
import { runVerificationJob } from "@/lib/payments/verification";
import { clientIpFrom } from "@/lib/security/request";

export const dynamic = "force-dynamic";

export async function POST(request: Request, ctx: { params: Promise<{ provider: string; token: string }> }) {
  const { provider, token } = await ctx.params;
  let payload: unknown;
  try {
    const text = await request.text();
    if (text.length > 16_384) return new Response(null, { status: 413 });
    payload = JSON.parse(text);
  } catch {
    return new Response(null, { status: 400 });
  }
  const result = await ingestCallback(provider, token, clientIpFrom(request.headers), payload);
  if (result.status !== 200) return new Response(null, { status: result.status });
  const jobId = result.jobId;
  after(async () => {
    try {
      await runVerificationJob(jobId);
    } catch (e) {
      console.error("[callback] verification job failed; poller will retry", e);
    }
  });
  return Response.json({ received: true });
}

export function GET() {
  return new Response(null, { status: 405 });
}
