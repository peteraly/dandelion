/**
 * Anchoring against a local Anvil chain with the real LedgerAnchor bytecode.
 * Skipped when Foundry (anvil) or the compiled artifact is unavailable.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPublicClient, createWalletClient, http, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import { LEDGER_ANCHOR_ABI } from "@/lib/ledger/abi";
import { recordLedgerEvent, withTx } from "@/lib/services/core";

const ARTIFACT = join(process.cwd(), "contracts/out/LedgerAnchor.sol/LedgerAnchor.json");
const ANVIL = join(process.env.HOME ?? "", ".foundry/bin/anvil");
const PORT = 8555;
const RPC = `http://127.0.0.1:${PORT}`;
// Anvil's default funded account #0.
const KEY: Hex = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const available = existsSync(ARTIFACT) && existsSync(ANVIL);

describe.skipIf(!available)("ledger anchoring on anvil", () => {
  let anvil: ChildProcess;
  let address: Hex;

  beforeAll(async () => {
    anvil = spawn(ANVIL, ["--port", String(PORT), "--chain-id", "31337", "--silent"], { stdio: "ignore" });
    const client = createPublicClient({ transport: http(RPC) });
    for (let i = 0; i < 50; i++) {
      try {
        await client.getChainId();
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 200));
      }
    }
    const artifact = JSON.parse(readFileSync(ARTIFACT, "utf8")) as { bytecode: { object: Hex } };
    const account = privateKeyToAccount(KEY);
    const wallet = createWalletClient({ account, transport: http(RPC) });
    const hash = await wallet.deployContract({ abi: LEDGER_ANCHOR_ABI, bytecode: artifact.bytecode.object, args: [account.address, account.address], chain: null });
    const receipt = await client.waitForTransactionReceipt({ hash });
    address = receipt.contractAddress!;
    process.env.ANCHOR_SIGNER_KEY = KEY;
    process.env.CHAIN_ID = "31337";
    process.env.CHAIN_RPC_URL = RPC;
    await getDb().execute(sql`update contract_deployments set active = false`);
    await getDb().insert(s.contractDeployments).values({ chainId: 31337, network: "anvil", contractAddress: address, active: true });
  });

  afterAll(async () => {
    anvil?.kill();
    delete process.env.ANCHOR_SIGNER_KEY;
    delete process.env.CHAIN_ID;
    delete process.env.CHAIN_RPC_URL;
  });

  it("anchors unanchored events, confirms the tx, and every event gets a valid proof", async () => {
    const { runAnchor, confirmSubmittedAnchors, proofForEvent, unanchoredCount, walletStatus } = await import("@/lib/ledger/anchor");
    await withTx(async (tx) => {
      for (let i = 0; i < 5; i++) await recordLedgerEvent(tx, { type: "BATCH_REGISTERED", subjectRef: `B-ANVIL-${i}`, role: "SUPPLIER" });
    });
    const before = await unanchoredCount();
    expect(before).toBeGreaterThanOrEqual(5);
    const r = await runAnchor();
    expect(r.status).toBe("submitted");
    expect(await unanchoredCount()).toBe(0);
    for (let i = 0; i < 20 && (await confirmSubmittedAnchors()) === 0; i++) await new Promise((res) => setTimeout(res, 200));
    const anchors = await getDb().query.ledgerAnchors.findMany();
    const confirmed = anchors.find((a) => a.status === "CONFIRMED");
    expect(confirmed).toBeTruthy();
    // On-chain root equals our root.
    const client = createPublicClient({ transport: http(RPC) });
    const onChain = await client.readContract({ address, abi: LEDGER_ANCHOR_ABI, functionName: "anchors", args: [0n] });
    expect(onChain[0]).toBe(confirmed!.root);
    // Every member has a valid Merkle proof against that root.
    const members = await getDb().query.ledgerAnchorMembers.findMany();
    expect(members.length).toBe(before);
    for (const m of members.slice(0, 10)) {
      const p = await proofForEvent(m.eventId);
      expect(p?.valid).toBe(true);
      expect(p?.root).toBe(confirmed!.root);
    }
    const w = await walletStatus();
    expect(w.configured).toBe(true);
    expect(w.balanceWei).not.toBeNull();
  });

  it("skips anchoring while the contract is paused", async () => {
    const { runAnchor } = await import("@/lib/ledger/anchor");
    const account = privateKeyToAccount(KEY);
    const wallet = createWalletClient({ account, transport: http(RPC) });
    const client = createPublicClient({ transport: http(RPC) });
    await client.waitForTransactionReceipt({ hash: await wallet.writeContract({ address, abi: LEDGER_ANCHOR_ABI, functionName: "pause", chain: null }) });
    await withTx((tx) => recordLedgerEvent(tx, { type: "BATCH_REGISTERED", subjectRef: "B-PAUSED", role: "SUPPLIER" }));
    const r = await runAnchor();
    expect(r).toMatchObject({ status: "skipped", reason: "contract paused" });
    await client.waitForTransactionReceipt({ hash: await wallet.writeContract({ address, abi: LEDGER_ANCHOR_ABI, functionName: "unpause", chain: null }) });
    expect((await runAnchor()).status).toBe("submitted");
  });

  it("production refuses an env signer key", async () => {
    const { EnvKeySigner } = await import("@/lib/ledger/signer");
    const prev = process.env.VERCEL_ENV;
    process.env.VERCEL_ENV = "production";
    expect(() => new EnvKeySigner(KEY)).toThrow(/KMS/);
    process.env.VERCEL_ENV = prev;
  });
});
