/**
 * Outbound SMS. Outside production the provider is FORCED to mock (§1).
 * The mock writes to sms_outbox so developers and e2e tests can read codes.
 * In production with the mock still selected (pre-launch), bodies are
 * redacted — nobody can read OTPs out of the database.
 *
 * A real gateway (and a registered sender ID, gate G3) is an open decision.
 */
import { getDb, type DbOrTx } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import { encryptString } from "@/lib/crypto/envelope";
import { phoneBlindIndex } from "@/lib/crypto/blind-index";
import { isProduction, smsProviderId } from "@/lib/env";

export type SmsPurpose = "OTP" | "ENROLL_LINK" | "PICKUP" | "CUSTOMER_PLAN" | "CUSTOMER_PAID" | "HANDOVER_CODE" | "RECEIPT" | "MARGIN" | "NOTICE" | "ORG_SALE";

export interface SmsProvider {
  readonly id: string;
  send(toE164: string, body: string, purpose: SmsPurpose, tx?: DbOrTx): Promise<void>;
}

class MockSmsProvider implements SmsProvider {
  readonly id = "mock";
  async send(toE164: string, body: string, purpose: SmsPurpose, tx: DbOrTx = getDb()): Promise<void> {
    await tx.insert(s.smsOutbox).values({
      toIndex: phoneBlindIndex(toE164),
      toEnc: await encryptString(toE164),
      purpose,
      body: isProduction() ? "[redacted: mock SMS in production]" : body,
    });
  }
}

class UnconfiguredHttpSmsProvider implements SmsProvider {
  readonly id = "http";
  async send(): Promise<void> {
    throw new Error("SMS gateway not implemented — choose a provider and register a sender ID (gate G3)");
  }
}

export function getSmsProvider(): SmsProvider {
  return smsProviderId() === "mock" ? new MockSmsProvider() : new UnconfiguredHttpSmsProvider();
}
