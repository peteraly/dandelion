import { paymentProviderId, type ProviderId } from "@/lib/env";
import type { PaymentProvider } from "./provider";
import { MockProvider } from "./mock-provider";
import { AggregatorProvider, VodacomMpesaProvider } from "./stub-providers";

/** The active provider. Outside production this is always MockProvider. */
export function getPaymentProvider(): PaymentProvider {
  return providerById(paymentProviderId());
}

export function providerById(id: ProviderId): PaymentProvider {
  switch (id) {
    case "mock":
      return new MockProvider();
    case "vodacom_mpesa":
      return new VodacomMpesaProvider();
    case "aggregator":
      return new AggregatorProvider();
  }
}
