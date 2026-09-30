/**
 * The open demo (Prompt E) lets anyone with the link act inside a fictional
 * district. Whatever they type stays fictional: a phone number outside the
 * fake range (+255 700 00x xxx, ADR-025) is refused for open-demo sessions,
 * so no real person's number is ever stored because a visitor typed it.
 */
import { DomainError } from "@/lib/services/core";
import { FAKE_PHONE_RE } from "@/lib/seed-identities";
import { normalizeTzPhone } from "@/lib/phone";

export function assertOpenDemoPhone(actor: { openDemo?: boolean } | null | undefined, phone: string | null | undefined): void {
  if (!actor?.openDemo || !phone) return;
  const e164 = normalizeTzPhone(phone) ?? phone;
  if (!FAKE_PHONE_RE.test(e164)) throw new DomainError("open_demo_fake_phone");
}
