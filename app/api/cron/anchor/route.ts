/**
 * Anchor cron: confirms submitted anchors, then anchors the next batch of
 * unanchored ledger events. Skips when the contract is paused or nothing is
 * configured (events accumulate). Also raises the low-balance alert.
 */
import { confirmSubmittedAnchors, runAnchor, walletStatus } from "@/lib/ledger/anchor";
import { cronAuthorized, heartbeat } from "@/lib/security/cron";
import { getDb } from "@/lib/db/client";
import { getSetting, logSecurityEvent } from "@/lib/services/core";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  if (!cronAuthorized(request)) return new Response(null, { status: 401 });
  const confirmed = await confirmSubmittedAnchors();
  const result = await runAnchor();
  const wallet = await walletStatus();
  if (wallet.configured && wallet.balanceWei !== null && wallet.balanceWei < BigInt(await getSetting("walletLowBalanceWei"))) {
    await logSecurityEvent(getDb(), "ANCHOR_WALLET_LOW_BALANCE", "ALERT", { details: { address: wallet.address, balanceWei: wallet.balanceWei.toString() } });
  }
  if (result.status === "failed") await heartbeat("anchor", "error", { error: result.error });
  return Response.json({ confirmed, result, wallet: { ...wallet, balanceWei: wallet.balanceWei?.toString() ?? null } });
}
