import { runDailyReconciliation } from "@/lib/services/reconciliation";
import { recordHubStock } from "@/lib/services/replenishment";
import { cronAuthorized, heartbeat } from "@/lib/security/cron";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  if (!cronAuthorized(request)) return new Response(null, { status: 401 });
  try {
    const result = await runDailyReconciliation();
    // The nightly stock record (Prompt I §2.3) rides on the same nightly run; its failure never hides the reconciliation's result.
    let stock: { rows: number } | { error: string };
    try {
      stock = await recordHubStock();
      await heartbeat("hub-stock", "ok", stock);
    } catch (e) {
      stock = { error: (e as Error).message };
      await heartbeat("hub-stock", "error", stock);
    }
    return Response.json({ ...result, stock });
  } catch (e) {
    await heartbeat("reconciliation", "error", { message: (e as Error).message });
    throw e;
  }
}
