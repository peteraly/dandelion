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

export type SmsPurpose = "OTP" | "ENROLL_LINK" | "PICKUP" | "CUSTOMER_PLAN" | "CUSTOMER_PAID" | "HANDOVER_CODE" | "RECEIPT" | "MARGIN" | "NOTICE" | "ORG_SALE" | "PAYOUT_SENT" | "PAYOUT_REJECTED" | "SHOP_REQUEST" | "SHOP_ALERT";

export interface SmsProvider {
  readonly id: string;
  send(toE164: string, body: string, purpose: SmsPurpose, tx?: DbOrTx): Promise<void>;
}

/**
 * The basic SMS alphabet (GSM 03.38), which fits 160 characters in one SMS part. A single character outside it — a
 * long dash, a curly quote, "×" — makes the whole message count 70 characters per part, two to three times the cost.
 */
const GSM_BASIC = new Set("@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà");
const GSM_SWAPS: Record<string, string> = { "—": "-", "–": "-", "‑": "-", "×": "x", "’": "'", "‘": "'", "“": '"', "”": '"', "…": "...", "•": "-", "→": "->", "\u00a0": " ", "\u202f": " " };

/** Every outgoing SMS in the basic alphabet (Prompt L §2.9): common look-alikes swapped, anything else dropped to "?". */
export function toGsm(body: string): string {
  return Array.from(body.normalize("NFC"), (c) => (GSM_BASIC.has(c) ? c : (GSM_SWAPS[c] ?? (/[\p{L}\p{N}]/u.test(c) ? c.normalize("NFD").replace(/\p{M}/gu, "") || "?" : "?"))))
    .map((c) => (Array.from(c).every((x) => GSM_BASIC.has(x)) ? c : "?"))
    .join("");
}

/** SMS parts a body costs once sent in the basic alphabet (160 for one part, 153 each when split). */
export function smsParts(body: string): number {
  const n = toGsm(body).length;
  return n <= 160 ? 1 : Math.ceil(n / 153);
}

class MockSmsProvider implements SmsProvider {
  readonly id = "mock";
  async send(toE164: string, raw: string, purpose: SmsPurpose, tx: DbOrTx = getDb()): Promise<void> {
    const body = toGsm(raw);
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
