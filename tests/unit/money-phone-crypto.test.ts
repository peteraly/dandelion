import { describe, expect, it } from "vitest";
import { tzs, TzsSchema, TzsFormSchema, subTzs, mulTzs } from "@/lib/money";
import { normalizeTzPhone, maskPhone } from "@/lib/phone";
import { encryptString, decryptString } from "@/lib/crypto/envelope";
import { phoneBlindIndex } from "@/lib/crypto/blind-index";
import { humanCode, numericCode, randomRef128 } from "@/lib/crypto/random";

describe("money (§3.7)", () => {
  it("accepts only non-negative safe integers", () => {
    expect(tzs(11400)).toBe(11400);
    expect(() => tzs(1.5)).toThrow();
    expect(() => tzs(-1)).toThrow();
    expect(() => tzs(Number.NaN)).toThrow();
    expect(TzsSchema.safeParse(7500).success).toBe(true);
    expect(TzsSchema.safeParse(7500.5).success).toBe(false);
    expect(TzsSchema.safeParse(-5).success).toBe(false);
    expect(TzsFormSchema.safeParse("1000").success).toBe(true);
    expect(TzsFormSchema.safeParse("1,000.50").success).toBe(false);
    expect(TzsFormSchema.safeParse("-100").success).toBe(false);
  });
  it("never goes negative (no credit)", () => {
    expect(() => subTzs(tzs(100), tzs(200))).toThrow();
    expect(subTzs(tzs(11400), tzs(6000))).toBe(5400);
    expect(mulTzs(tzs(8000), 10)).toBe(80000);
  });
});

describe("phone", () => {
  it.each([
    ["+255 712 345 678", "+255712345678"],
    ["255712345678", "+255712345678"],
    ["0712-345-678", "+255712345678"],
    ["0612345678", "+255612345678"],
    ["+255 700 000 001", "+255700000001"],
  ])("normalises %s", (input, out) => {
    expect(normalizeTzPhone(input)).toBe(out);
  });
  it.each(["12345", "+254712345678", "0212345678", "07123456789"])("rejects %s", (input) => {
    expect(normalizeTzPhone(input)).toBeNull();
  });
  it("masks", () => {
    expect(maskPhone("+255700000012")).toBe("+255 ••• ••• 012");
  });
});

describe("envelope encryption and blind index", () => {
  it("round-trips and uses a fresh data key per value", async () => {
    const a = await encryptString("+255700000001");
    const b = await encryptString("+255700000001");
    expect(a).not.toEqual(b);
    expect(a).not.toContain("700000001");
    expect(await decryptString(a)).toBe("+255700000001");
  });
  it("detects tampering", async () => {
    const a = await encryptString("+255700000001");
    const parts = a.split(".");
    parts[4] = Buffer.from("tampered").toString("base64url");
    await expect(decryptString(parts.join("."))).rejects.toThrow();
  });
  it("blind index is deterministic and not the phone", () => {
    expect(phoneBlindIndex("+255700000001")).toBe(phoneBlindIndex("+255700000001"));
    expect(phoneBlindIndex("+255700000001")).not.toBe(phoneBlindIndex("+255700000002"));
    expect(phoneBlindIndex("+255700000001")).not.toContain("700000001");
  });
});

describe("random refs", () => {
  it("verify refs are 128-bit URL-safe", () => {
    const r = randomRef128();
    expect(r).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(Buffer.from(r, "base64url").length).toBe(16);
  });
  it("human codes avoid ambiguous characters", () => {
    for (let i = 0; i < 200; i++) expect(humanCode(8)).toMatch(/^[2-9A-HJKMNP-TV-Z]{8}$/);
  });
  it("numeric codes have the right length", () => {
    for (let i = 0; i < 200; i++) expect(numericCode(6)).toMatch(/^\d{6}$/);
  });
});
