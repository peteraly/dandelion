/**
 * Withdrawals in the demo district (Prompt L §2): members with money in Dandelion's collection account ask to
 * withdraw part of it at the end of the history. Most are approved by one admin and sent by the other; one is
 * turned down with a reason; one waits for approval and one, approved, waits for the second admin to send it — so
 * the admin home and Money → Payouts open with real work. Every step is the real service call.
 */
import { humanCode } from "@/lib/crypto/random";
import { getSetting } from "@/lib/services/core";
import { approveWithdrawal, balanceFor, rejectWithdrawal, requestWithdrawal, sendWithdrawal } from "@/lib/services/wallets";
import type { World } from "./world";

const MAX_REQUESTS = 8;

export async function payoutsRound(w: World): Promise<void> {
  const min = Number(await getSetting("withdrawalMinTzs"));
  const people = [...w.supplierOrgs.flatMap((o) => o.users), ...w.riders, ...w.hubs.map((h) => h.manager), ...w.hubs.flatMap((h) => h.champions)];
  const eligible: { person: (typeof people)[number]; available: number }[] = [];
  for (const person of people) {
    const b = await balanceFor(w.db, person.actor.userId);
    if (b.availableTzs >= min * 2 && b.pendingWithdrawalTzs === 0) eligible.push({ person, available: b.availableTzs });
  }
  eligible.sort((a, b) => b.available - a.available);
  for (const [i, { person, available }] of eligible.slice(0, MAX_REQUESTS).entries()) {
    try {
      const amountTzs = Math.max(min, Math.floor((available * 0.6) / 1000) * 1000);
      w.tick(5, 40);
      const { withdrawalId } = await requestWithdrawal(person.actor, { amountTzs });
      w.manifest.count("payouts.requested");
      if (i === 0) continue; // waits for a first admin
      w.tick(10, 60);
      if (i === 2) {
        await rejectWithdrawal(w.adminB, withdrawalId, { reason: "Payout number to be confirmed by phone first (TEST)" });
        w.manifest.count("payouts.rejected");
        continue;
      }
      await approveWithdrawal(w.adminA, withdrawalId);
      if (i === 1) continue; // approved; waits for the second admin to send it
      w.tick(10, 60);
      await sendWithdrawal(w.adminB, withdrawalId, { providerRef: `SIM-${humanCode(8)}` });
      w.manifest.count("payouts.sent");
    } catch (e) {
      w.manifest.skip("payout", e);
    }
  }
}
