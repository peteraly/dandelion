import { runDailyReconciliation } from "@/lib/services/reconciliation";
import { recordHubStock } from "@/lib/services/replenishment";
import { sendRestockReminders } from "@/lib/services/reminders";
import { lapseStaleClaims } from "@/lib/services/self-heal";
import { passOnLateShopOrders } from "@/lib/services/shop";
import { cronAuthorized, heartbeat } from "@/lib/security/cron";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  if (!cronAuthorized(request)) return new Response(null, { status: 401 });
  try {
    // Claims that never turned into money lapse first (Prompt M), so they are not flagged as mismatches.
    const claims = await lapseStaleClaims().catch(async (e: Error) => (await heartbeat("claims", "error", { message: e.message }), { lapsed: 0 }));
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
    // Monthly "time to restock?" reminders (founders, 2026-10-01) ride on the same evening run, with their own heartbeat.
    let reminders: { sent: number } | { error: string };
    try {
      reminders = await sendRestockReminders();
      await heartbeat("reminders", "ok", reminders);
    } catch (e) {
      reminders = { error: (e as Error).message };
      await heartbeat("reminders", "error", reminders);
    }
    // Paid shop orders not handed over in time pass to the next seller (Prompt M §3.1). The shop and the sellers' pages
    // also run this whenever they are opened; the nightly run makes sure it happens even when nobody looks.
    let passedOn: { reminded: number; passed: number } | { error: string };
    try {
      passedOn = await passOnLateShopOrders();
      await heartbeat("shop-pass-on", "ok", passedOn);
    } catch (e) {
      passedOn = { error: (e as Error).message };
      await heartbeat("shop-pass-on", "error", passedOn);
    }
    return Response.json({ ...result, claims, stock, reminders, passedOn });
  } catch (e) {
    await heartbeat("reconciliation", "error", { message: (e as Error).message });
    throw e;
  }
}
