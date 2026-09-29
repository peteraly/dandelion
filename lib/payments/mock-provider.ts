/**
 * MockProvider — the default everywhere, and FORCED outside production.
 *
 * Its "remote" records live in mock_provider_ledger, written only by the dev
 * simulator. Callbacks are HMAC-signed so signature checking is exercised.
 * In production nothing can write to its ledger (the simulator is 404), so
 * a production deploy on mocks can never confirm a payment.
 */
import { createHmac } from "node:crypto";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import { secret } from "@/lib/env";
import { safeEqual } from "@/lib/crypto/random";
import type { ParsedCallback, PaymentProvider, ProviderTransaction } from "./provider";

export const MockCallbackSchema = z
  .object({
    transactionId: z.string().min(4).max(64),
    accountReference: z.string().max(64).optional(),
    amount: z.number().optional(),
    payee: z.string().max(64).optional(),
    payer: z.string().max(32).nullable().optional(),
    status: z.string().max(16).optional(),
    timestamp: z.string().max(40).optional(),
    signature: z.string().max(128).optional(),
  })
  .strict();
export type MockCallback = z.infer<typeof MockCallbackSchema>;

function signingKey(): string {
  return secret("MOCK_PROVIDER_SIGNING_KEY", "dev-only-mock-provider-signing-key");
}

function signatureBase(c: Omit<MockCallback, "signature">): string {
  return [c.transactionId, c.accountReference ?? "", c.amount ?? "", c.payee ?? "", c.payer ?? "", c.status ?? "", c.timestamp ?? ""].join("|");
}

export function signMockCallback(c: Omit<MockCallback, "signature">): string {
  return createHmac("sha256", signingKey()).update(signatureBase(c)).digest("hex");
}

function rowToTx(r: typeof s.mockProviderLedger.$inferSelect): ProviderTransaction {
  return {
    providerTxRef: r.providerTxRef,
    status: r.status,
    amountTzs: r.amountTzs,
    payeeAccount: r.payeeAccount,
    accountReference: r.accountReference,
    payerMsisdn: r.payerMsisdn,
    occurredAt: r.occurredAt,
  };
}

export class MockProvider implements PaymentProvider {
  readonly id = "mock" as const;

  parseCallback(payload: unknown): ParsedCallback {
    const c = MockCallbackSchema.parse(payload);
    const { signature, ...rest } = c;
    return {
      providerTxRef: c.transactionId,
      payerMsisdn: c.payer ?? null,
      signatureOk: signature ? safeEqual(signature, signMockCallback(rest)) : false,
    };
  }

  async queryTransaction(providerTxRef: string): Promise<ProviderTransaction | null> {
    const row = await getDb().query.mockProviderLedger.findFirst({ where: eq(s.mockProviderLedger.providerTxRef, providerTxRef) });
    return row ? rowToTx(row) : null;
  }

  async findByAccountReference(accountReference: string): Promise<ProviderTransaction[]> {
    const rows = await getDb().query.mockProviderLedger.findMany({ where: eq(s.mockProviderLedger.accountReference, accountReference) });
    return rows.map(rowToTx);
  }
}
