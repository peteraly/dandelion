import { runDailyReconciliation } from "@/lib/services/reconciliation";
import { cronAuthorized, heartbeat } from "@/lib/security/cron";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  if (!cronAuthorized(request)) return new Response(null, { status: 401 });
  try {
    const result = await runDailyReconciliation();
    return Response.json(result);
  } catch (e) {
    await heartbeat("reconciliation", "error", { message: (e as Error).message });
    throw e;
  }
}
