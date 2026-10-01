/**
 * Prompt L §1.4: SMS is the largest running cost per sale. A message in the basic SMS alphabet fits 160 characters in
 * a part; one character outside it ("—", "×", a curly quote) makes every part hold 70. Every template stays in the
 * basic alphabet, and every outgoing SMS is converted before it is sent (names people type included).
 */
import { describe, expect, it } from "vitest";
import en from "@/messages/en.json";
import sw from "@/messages/sw.json";
import { smsParts, toGsm } from "@/lib/sms";

const fill = (template: string) => template.replace(/\{[a-zA-Z]+\}/g, "x".repeat(10));

describe("SMS alphabet", () => {
  it("every SMS template, in both languages, is already in the basic alphabet", () => {
    for (const [lang, m] of [["en", en.sms], ["sw", sw.sms]] as const) {
      for (const [key, body] of Object.entries(m)) expect(toGsm(fill(body)), `${lang} sms.${key}`).toBe(fill(body));
    }
  });

  it("swaps look-alikes and accents, and never lets one character triple the cost", () => {
    expect(toGsm("Order OR-1 — 3 × pads “ok” …")).toBe('Order OR-1 - 3 x pads "ok" ...');
    expect(toGsm("Zuhurá Ñaña")).toBe("Zuhura Ñaña");
    expect(toGsm("Emoji 🙂 ok")).toBe("Emoji ? ok");
    const long = `Habari Asha. ${"a".repeat(150)}`;
    expect(smsParts(long)).toBe(2);
    expect(smsParts(`${long}—`)).toBe(2); // would be 3 parts as UCS-2 without the swap
  });

  it("keeps the customer's messages short enough: no template above 3 parts once filled", () => {
    for (const [lang, m] of [["en", en.sms], ["sw", sw.sms]] as const) {
      for (const [key, body] of Object.entries(m)) expect(smsParts(fill(body)), `${lang} sms.${key}`).toBeLessThanOrEqual(3);
    }
  });
});
