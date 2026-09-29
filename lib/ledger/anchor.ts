/**
 * Merkle anchoring (review correction §4.4). The cron builds a tree from all
 * unanchored LedgerEvents, submits the root to LedgerAnchor on Celo, and
 * records the tx hash. Payments never wait on this. When the contract is
 * paused, or no signer/contract is configured, events simply accumulate.
 *
 * Network: Celo's current testnet must be verified against docs.celo.org
 * before deploying (docs/DECISIONS.md). The chain definition is read from
 * env so it can be corrected without a code change.
 */
import { asc, eq, gt, isNull, sql } from "drizzle-orm";
import { createPublicClient, createWalletClient, defineChain, http, type Address, type Hex } from "viem";
import { getDb } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import { chainNetwork, optionalSecret } from "@/lib/env";
import { withTx } from "@/lib/services/core";
import { heartbeat } from "@/lib/security/cron";
import { merkleProof, merkleRoot, verifyProof } from "./merkle";
import { getSigner } from "./signer";
import { LEDGER_ANCHOR_ABI } from "./abi";

export function activeChain() {
  const network = chainNetwork();
  const id = Number.parseInt(process.env.CHAIN_ID ?? (network === "mainnet" ? "42220" : "11142220"), 10);
  const rpc = process.env.CHAIN_RPC_URL ?? (network === "mainnet" ? "https://forno.celo.org" : "https://forno.celo-sepolia.celo-testnet.org");
  const explorer = process.env.CHAIN_EXPLORER_URL ?? (network === "mainnet" ? "https://celoscan.io" : "https://celo-sepolia.blockscout.com");
  return defineChain({
    id,
    name: network === "mainnet" ? "Celo" : "Celo testnet (verify: docs.celo.org)",
    nativeCurrency: { name: "CELO", symbol: "CELO", decimals: 18 },
    rpcUrls: { default: { http: [rpc] } },
    blockExplorers: { default: { name: "Explorer", url: explorer } },
  });
}

export function explorerTxUrl(txHash: string): string {
  return `${activeChain().blockExplorers!.default.url}/tx/${txHash}`;
}

export async function activeDeployment() {
  return getDb().query.contractDeployments.findFirst({ where: eq(s.contractDeployments.active, true) });
}

export interface WalletStatus {
  configured: boolean;
  address: Address | null;
  balanceWei: bigint | null;
  network: string;
}

export async function walletStatus(): Promise<WalletStatus> {
  const signer = getSigner();
  const network = chainNetwork();
  if (!signer) return { configured: false, address: null, balanceWei: null, network };
  const account = await signer.account();
  try {
    const client = createPublicClient({ chain: activeChain(), transport: http(undefined, { timeout: 5_000 }) });
    const balanceWei = await client.getBalance({ address: account.address });
    return { configured: true, address: account.address, balanceWei, network };
  } catch {
    return { configured: true, address: account.address, balanceWei: null, network };
  }
}

export async function unanchoredCount(): Promise<number> {
  const [r] = await getDb()
    .select({ n: sql<number>`count(*)::int` })
    .from(s.ledgerEvents)
    .leftJoin(s.ledgerAnchorMembers, eq(s.ledgerAnchorMembers.eventId, s.ledgerEvents.id))
    .where(isNull(s.ledgerAnchorMembers.eventId));
  return Number(r?.n ?? 0);
}

export type AnchorResult = { status: "skipped"; reason: string } | { status: "submitted"; anchorId: string; txHash: string; count: number } | { status: "failed"; error: string };

/** Build a tree from unanchored events and submit its root. */
export async function runAnchor(opts: { batchLimit?: number; dryRun?: boolean } = {}): Promise<AnchorResult> {
  const db = getDb();
  const signer = getSigner();
  const deployment = await activeDeployment();
  const pending = await db
    .select({ e: s.ledgerEvents })
    .from(s.ledgerEvents)
    .leftJoin(s.ledgerAnchorMembers, eq(s.ledgerAnchorMembers.eventId, s.ledgerEvents.id))
    .where(isNull(s.ledgerAnchorMembers.eventId))
    .orderBy(asc(s.ledgerEvents.id))
    .limit(opts.batchLimit ?? 2_000);
  const events = pending.map((p) => p.e);
  if (events.length === 0) {
    await heartbeat("anchor", "ok", { skipped: "no events" });
    return { status: "skipped", reason: "no unanchored events" };
  }
  if (!signer || !deployment || /^0x0{40}$/.test(deployment.contractAddress)) {
    await heartbeat("anchor", "ok", { skipped: "not configured", pending: events.length });
    return { status: "skipped", reason: "signer or contract not configured; events accumulate" };
  }
  const chain = activeChain();
  if (deployment.chainId !== chain.id) return { status: "skipped", reason: `active deployment is on chain ${deployment.chainId}, app is on ${chain.id}` };
  const account = await signer.account();
  const publicClient = createPublicClient({ chain, transport: http() });
  const address = deployment.contractAddress as Address;
  const paused = await publicClient.readContract({ address, abi: LEDGER_ANCHOR_ABI, functionName: "paused" });
  if (paused) {
    await heartbeat("anchor", "ok", { skipped: "paused", pending: events.length });
    return { status: "skipped", reason: "contract paused" };
  }
  const leaves = events.map((e) => e.leafHash as Hex);
  const root = merkleRoot(leaves);
  const fromEventId = events[0]!.id;
  const toEventId = events[events.length - 1]!.id;
  if (opts.dryRun) return { status: "skipped", reason: `dry run: root ${root} over ${events.length} events` };

  const anchorId = await withTx(async (tx) => {
    const [a] = await tx
      .insert(s.ledgerAnchors)
      .values({ root, fromEventId, toEventId, eventCount: events.length, status: "BUILT", contractDeploymentId: deployment.id, chainId: chain.id })
      .returning({ id: s.ledgerAnchors.id });
    await tx.insert(s.ledgerAnchorMembers).values(events.map((e, i) => ({ eventId: e.id, anchorId: a!.id, leafIndex: i })));
    return a!.id;
  });
  try {
    const wallet = createWalletClient({ account, chain, transport: http() });
    const txHash = await wallet.writeContract({ address, abi: LEDGER_ANCHOR_ABI, functionName: "anchor", args: [root, BigInt(fromEventId), BigInt(toEventId)] });
    await db.update(s.ledgerAnchors).set({ status: "SUBMITTED", txHash, submittedAt: new Date() }).where(eq(s.ledgerAnchors.id, anchorId));
    await heartbeat("anchor", "ok", { anchored: events.length, txHash });
    return { status: "submitted", anchorId, txHash, count: events.length };
  } catch (e) {
    const error = (e as Error).message.slice(0, 500);
    // Free the events for the next run: the anchor row records the failure.
    await withTx(async (tx) => {
      await tx.execute(sql`delete from ledger_anchor_members where anchor_id = ${anchorId}`).catch(() => undefined);
      await tx.update(s.ledgerAnchors).set({ status: "FAILED", error }).where(eq(s.ledgerAnchors.id, anchorId));
    });
    await heartbeat("anchor", "error", { error });
    return { status: "failed", error };
  }
}

/** Confirm submitted anchors that have been mined. */
export async function confirmSubmittedAnchors(): Promise<number> {
  const db = getDb();
  const submitted = await db.query.ledgerAnchors.findMany({ where: eq(s.ledgerAnchors.status, "SUBMITTED") });
  if (submitted.length === 0) return 0;
  const client = createPublicClient({ chain: activeChain(), transport: http() });
  let n = 0;
  for (const a of submitted) {
    if (!a.txHash) continue;
    try {
      const receipt = await client.getTransactionReceipt({ hash: a.txHash as Hex });
      if (receipt.status === "success") {
        await db.update(s.ledgerAnchors).set({ status: "CONFIRMED", confirmedAt: new Date() }).where(eq(s.ledgerAnchors.id, a.id));
        n++;
      } else {
        await db.update(s.ledgerAnchors).set({ status: "FAILED", error: "reverted" }).where(eq(s.ledgerAnchors.id, a.id));
      }
    } catch {
      // not mined yet
    }
  }
  return n;
}

export interface EventProof {
  eventId: number;
  leafHash: Hex;
  root: Hex;
  proof: Hex[];
  anchor: { status: string; txHash: string | null; chainId: number | null; contractAddress: string | null; confirmedAt: Date | null } | null;
  valid: boolean | null;
}

/** Merkle proof for one event (public verify page). */
export async function proofForEvent(eventId: number): Promise<EventProof | null> {
  const db = getDb();
  const ev = await db.query.ledgerEvents.findFirst({ where: eq(s.ledgerEvents.id, eventId) });
  if (!ev) return null;
  const member = await db.query.ledgerAnchorMembers.findFirst({ where: eq(s.ledgerAnchorMembers.eventId, eventId) });
  if (!member) return { eventId, leafHash: ev.leafHash as Hex, root: "0x" as Hex, proof: [], anchor: null, valid: null };
  const anchor = await db.query.ledgerAnchors.findFirst({ where: eq(s.ledgerAnchors.id, member.anchorId) });
  if (!anchor) return null;
  const members = await db
    .select({ leaf: s.ledgerEvents.leafHash, idx: s.ledgerAnchorMembers.leafIndex })
    .from(s.ledgerAnchorMembers)
    .innerJoin(s.ledgerEvents, eq(s.ledgerEvents.id, s.ledgerAnchorMembers.eventId))
    .where(eq(s.ledgerAnchorMembers.anchorId, anchor.id))
    .orderBy(asc(s.ledgerAnchorMembers.leafIndex));
  const leaves = members.map((m) => m.leaf as Hex);
  const proof = merkleProof(leaves, member.leafIndex);
  const deployment = anchor.contractDeploymentId ? await db.query.contractDeployments.findFirst({ where: eq(s.contractDeployments.id, anchor.contractDeploymentId) }) : null;
  return {
    eventId,
    leafHash: ev.leafHash as Hex,
    root: anchor.root as Hex,
    proof,
    anchor: { status: anchor.status, txHash: anchor.txHash, chainId: anchor.chainId, contractAddress: deployment?.contractAddress ?? null, confirmedAt: anchor.confirmedAt },
    valid: verifyProof(ev.leafHash as Hex, proof, anchor.root as Hex),
  };
}

export async function eventsAfter(id: number, limit = 100) {
  return getDb().query.ledgerEvents.findMany({ where: gt(s.ledgerEvents.id, id), orderBy: asc(s.ledgerEvents.id), limit });
}
