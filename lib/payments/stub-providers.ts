/**
 * Stubs for real providers. They exist so the interface is exercised and so
 * a later implementer knows exactly what to fill in. Every method throws.
 *
 * - VodacomMpesaProvider: Tanzania's M-Pesa is Vodacom's "M-Pesa Open API"
 *   (the handbook's "Daraja" is Safaricom Kenya). Endpoints, auth
 *   (session key / encrypted API key), callback shape, signature support,
 *   and source-IP whitelisting must be verified against current Vodacom
 *   Tanzania documentation before implementation (gates G1, G2).
 * - AggregatorProvider: a licensed aggregator with collection and
 *   split/disbursement (route b). Provider not chosen.
 */
import type { ParsedCallback, PaymentProvider, ProviderTransaction } from "./provider";
import { NotImplementedProviderError } from "./provider";

export class VodacomMpesaProvider implements PaymentProvider {
  readonly id = "vodacom_mpesa" as const;
  parseCallback(_payload: unknown): ParsedCallback {
    throw new NotImplementedProviderError(this.id, "parseCallback");
  }
  async queryTransaction(_ref: string): Promise<ProviderTransaction | null> {
    throw new NotImplementedProviderError(this.id, "queryTransaction (Query Transaction Status)");
  }
  async findByAccountReference(_ref: string): Promise<ProviderTransaction[]> {
    throw new NotImplementedProviderError(this.id, "findByAccountReference");
  }
}

export class AggregatorProvider implements PaymentProvider {
  readonly id = "aggregator" as const;
  parseCallback(_payload: unknown): ParsedCallback {
    throw new NotImplementedProviderError(this.id, "parseCallback");
  }
  async queryTransaction(_ref: string): Promise<ProviderTransaction | null> {
    throw new NotImplementedProviderError(this.id, "queryTransaction");
  }
  async findByAccountReference(_ref: string): Promise<ProviderTransaction[]> {
    throw new NotImplementedProviderError(this.id, "findByAccountReference");
  }
}
