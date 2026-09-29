/**
 * Dev simulator core (§8). Writes a transaction into the MockProvider's
 * "remote" ledger and fires a callback through the real ingestion path, so
 * tests and the /dev/simulator page exercise exactly the production code.
 *
 * Hard guard: refuses unless simulatorEnabled() (never in production).
 */
import { now } from "@/lib/clock";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import { simulatorEnabled } from "@/lib/env";
import { humanCode, sha256Hex } from "@/lib/crypto/random";
import { ingestCallback, callbackToken, type CallbackResult } from "./callbacks";
import { signMockCallback, type MockCallback } from "./mock-provider";
import { runDueVerificationJobs, type JobOutcome } from "./verification";

export type Scenario = "success" | "failure" | "duplicate" | "replay" | "spoofed" | "wrong_amount" | "overpayment" | "delayed" | "wrong_payee" | "bad_signature";
export const SCENARIOS: readonly Scenario[] = ["success", "failure", "duplicate", "replay", "spoofed", "wrong_amount", "overpayment", "delayed", "wrong_payee", "bad_signature"];

export interface SimulationResult {
  providerTxRef: string;
  callbacks: CallbackResult[];
  outcomes: JobOutcome[];
}

export function assertSimulatorEnabled(): void {
  if (!simulatorEnabled()) throw new Error("simulator disabled");
}

/** Put a transaction into the mock provider's ledger (what the telco "knows"). */
export async function seedProviderTx(t: {
  providerTxRef?: string;
  accountReference: string;
  payeeAccount: string;
  amountTzs: number;
  status?: "SUCCESS" | "FAILED" | "PENDING" | "REVERSED";
  payerMsisdn?: string;
}): Promise<string> {
  assertSimulatorEnabled();
  const providerTxRef = t.providerTxRef ?? `MP${humanCode(10)}`;
  await getDb()
    .insert(s.mockProviderLedger)
    .values({ providerTxRef, accountReference: t.accountReference, payeeAccount: t.payeeAccount, amountTzs: t.amountTzs, status: t.status ?? "SUCCESS", payerMsisdn: t.payerMsisdn ?? "+255700000099" })
    .onConflictDoUpdate({ target: s.mockProviderLedger.providerTxRef, set: { status: t.status ?? "SUCCESS", amountTzs: t.amountTzs } });
  return providerTxRef;
}

export async function setProviderTxStatus(providerTxRef: string, status: "SUCCESS" | "FAILED" | "PENDING" | "REVERSED"): Promise<void> {
  assertSimulatorEnabled();
  await getDb().update(s.mockProviderLedger).set({ status }).where(eq(s.mockProviderLedger.providerTxRef, providerTxRef));
}

export function buildCallback(c: Omit<MockCallback, "signature">, sign = true): MockCallback {
  return sign ? { ...c, signature: signMockCallback(c) } : c;
}

export async function fireCallback(payload: unknown, opts: { token?: string; ip?: string } = {}): Promise<CallbackResult> {
  assertSimulatorEnabled();
  return ingestCallback("mock", opts.token ?? callbackToken("mock"), opts.ip ?? "127.0.0.1", payload);
}

/** Look up an order's payment details by its human reference. */
export async function orderPaymentTarget(orderRef: string): Promise<{ orderId: string; accountReference: string; payeeAccount: string; remainingTzs: number }> {
  const db = getDb();
  const order = await db.query.orders.findFirst({ where: eq(s.orders.ref, orderRef) });
  if (!order) throw new Error("order not found");
  const { paidTotals } = await import("@/lib/services/payments");
  const t = await paidTotals(db, order);
  const seller = await db.query.users.findFirst({ where: eq(s.users.id, order.sellerUserId) });
  return { orderId: order.id, accountReference: order.paymentRef, payeeAccount: seller?.payeeAccount ?? "", remainingTzs: t.remainingTzs };
}

/**
 * Run a scenario against an order. `amountTzs` defaults to the remaining
 * balance (or the scenario's own deviation).
 */
export async function simulate(scenario: Scenario, orderRef: string, opts: { amountTzs?: number; runJobs?: boolean } = {}): Promise<SimulationResult> {
  assertSimulatorEnabled();
  const target = await orderPaymentTarget(orderRef);
  const base = opts.amountTzs ?? target.remainingTzs;
  const callbacks: CallbackResult[] = [];
  const runJobs = opts.runJobs ?? true;
  const nowIso = now().toISOString();

  // One fake payer per order, so the per-payer rate limit behaves as it would in the field.
  const payer = `+2557000${(Number.parseInt(sha256Hex(orderRef).slice(0, 6), 16) % 100_000).toString().padStart(5, "0")}`;
  const fire = async (ref: string, amount: number, payee = target.payeeAccount, sign = true) => {
    const cb = buildCallback({ transactionId: ref, accountReference: target.accountReference, amount, payee, payer, status: "SUCCESS", timestamp: nowIso }, sign);
    callbacks.push(await fireCallback(cb));
  };

  let providerTxRef = "";
  switch (scenario) {
    case "success": {
      providerTxRef = await seedProviderTx({ accountReference: target.accountReference, payeeAccount: target.payeeAccount, amountTzs: base });
      await fire(providerTxRef, base);
      break;
    }
    case "failure": {
      providerTxRef = await seedProviderTx({ accountReference: target.accountReference, payeeAccount: target.payeeAccount, amountTzs: base, status: "FAILED" });
      await fire(providerTxRef, base);
      break;
    }
    case "duplicate": {
      // Two distinct callbacks for the same provider transaction.
      providerTxRef = await seedProviderTx({ accountReference: target.accountReference, payeeAccount: target.payeeAccount, amountTzs: base });
      await fire(providerTxRef, base);
      await fire(providerTxRef, base);
      break;
    }
    case "replay": {
      // A callback for a transaction that was already processed earlier.
      const prior = await getDb().query.providerTxDedupe.findFirst({ where: eq(s.providerTxDedupe.provider, "mock") });
      providerTxRef = prior?.providerTxRef ?? (await seedProviderTx({ accountReference: target.accountReference, payeeAccount: target.payeeAccount, amountTzs: base }));
      await fire(providerTxRef, base);
      break;
    }
    case "spoofed": {
      // Callback claims a transaction the provider has never heard of.
      providerTxRef = `SPOOF${humanCode(8)}`;
      await fire(providerTxRef, base);
      break;
    }
    case "wrong_amount": {
      const amt = Math.max(1, base - 500);
      providerTxRef = await seedProviderTx({ accountReference: target.accountReference, payeeAccount: target.payeeAccount, amountTzs: amt });
      await fire(providerTxRef, amt);
      break;
    }
    case "overpayment": {
      const amt = base + 1000;
      providerTxRef = await seedProviderTx({ accountReference: target.accountReference, payeeAccount: target.payeeAccount, amountTzs: amt });
      await fire(providerTxRef, amt);
      break;
    }
    case "wrong_payee": {
      providerTxRef = await seedProviderTx({ accountReference: target.accountReference, payeeAccount: "TILL-WRONG-999", amountTzs: base });
      await fire(providerTxRef, base, "TILL-WRONG-999");
      break;
    }
    case "bad_signature": {
      providerTxRef = await seedProviderTx({ accountReference: target.accountReference, payeeAccount: target.payeeAccount, amountTzs: base });
      await fire(providerTxRef, base, target.payeeAccount, false);
      break;
    }
    case "delayed": {
      // Provider has the money but the callback never arrives: only the poller can find it.
      providerTxRef = await seedProviderTx({ accountReference: target.accountReference, payeeAccount: target.payeeAccount, amountTzs: base, status: "PENDING" });
      break;
    }
  }
  const outcomes = runJobs ? await runDueVerificationJobs() : [];
  return { providerTxRef, callbacks, outcomes };
}
