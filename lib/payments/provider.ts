/**
 * Provider-neutral payment interface (review correction §4.1).
 *
 * The app never trusts a callback body for money facts. A callback only
 * tells us WHICH transaction to look at; amount, payee, account reference,
 * and status always come from a direct status query to the provider.
 */
import type { ProviderId } from "@/lib/env";

export type ProviderTxStatus = "SUCCESS" | "FAILED" | "PENDING" | "REVERSED";

export interface ProviderTransaction {
  providerTxRef: string;
  status: ProviderTxStatus;
  amountTzs: number;
  payeeAccount: string;
  /** The account reference the payer entered (our order paymentRef). */
  accountReference: string;
  payerMsisdn: string | null;
  occurredAt: Date;
}

export interface ParsedCallback {
  providerTxRef: string;
  /** Payer number, for per-payer rate limiting only. */
  payerMsisdn: string | null;
  /** true/false when the provider signs callbacks; null when it does not. */
  signatureOk: boolean | null;
}

export class ProviderUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProviderUnavailableError";
  }
}

export class NotImplementedProviderError extends Error {
  constructor(provider: string, what: string) {
    super(`${provider}: ${what} is not implemented — verify against the provider's current API docs (gate G1)`);
    this.name = "NotImplementedProviderError";
  }
}

export interface PaymentProvider {
  readonly id: ProviderId;
  /** Parse a callback body. Throws on malformed input. */
  parseCallback(payload: unknown): ParsedCallback;
  /** Mandatory direct status query. `null` = provider has no such transaction. */
  queryTransaction(providerTxRef: string): Promise<ProviderTransaction | null>;
  /** Poller support: transactions the provider holds for an account reference. */
  findByAccountReference(accountReference: string): Promise<ProviderTransaction[]>;
}
