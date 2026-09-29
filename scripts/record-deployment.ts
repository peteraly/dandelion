/**
 * Record a LedgerAnchor deployment so the anchor cron and /verify use it.
 * Old deployments are kept (inactive) — their anchors stay verifiable.
 *
 *   npx tsx scripts/record-deployment.ts <address> [deployTxHash] [notes]
 * Chain id and network come from CHAIN_ID / CHAIN_NETWORK (see .env.example).
 */
import { eq } from "drizzle-orm";
import { closeDb, getDb } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import { activeChain } from "@/lib/ledger/anchor";
import { chainNetwork } from "@/lib/env";

async function main() {
  const [address, deployTxHash, notes] = process.argv.slice(2);
  if (!address || !/^0x[0-9a-fA-F]{40}$/.test(address)) throw new Error("usage: record-deployment <0xaddress> [txHash] [notes]");
  const chain = activeChain();
  const db = getDb();
  await db.transaction(async (tx) => {
    await tx.update(s.contractDeployments).set({ active: false }).where(eq(s.contractDeployments.active, true));
    await tx.insert(s.contractDeployments).values({ chainId: chain.id, network: chainNetwork(), contractAddress: address, deployTxHash: deployTxHash ?? null, notes: notes ?? null, active: true });
  });
  console.log(`[ledger] recorded LedgerAnchor ${address} on chain ${chain.id} (${chainNetwork()})`);
  await closeDb();
}

main().catch(async (e) => {
  console.error(e);
  await closeDb();
  process.exit(1);
});
