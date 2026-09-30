/**
 * Prompt E / ADR-033: the open demo is closed unless the environment is not
 * production AND DEMO_OPEN_ACCESS=true; and an open-demo actor can only store
 * test phone numbers.
 */
import { afterEach, describe, expect, it } from "vitest";
import { openDemoConfigured, isOpenDemoRole } from "@/lib/demo/open";
import { assertOpenDemoPhone } from "@/lib/security/open-demo";

const saved = { VERCEL_ENV: process.env.VERCEL_ENV, NODE_ENV: process.env.NODE_ENV };
const setEnv = (vercel: string, node: string) => Object.assign(process.env, { VERCEL_ENV: vercel, NODE_ENV: node });
afterEach(() => setEnv(saved.VERCEL_ENV ?? "", saved.NODE_ENV ?? "test"));

describe("open demo gate", () => {
  it("is closed without the explicit switch, whatever the environment", () => {
    setEnv("preview", "production");
    expect(openDemoConfigured({})).toBe(false);
    expect(openDemoConfigured({ DEMO_OPEN_ACCESS: "1" })).toBe(false); // only the exact word "true"
    expect(openDemoConfigured({ DEMO_OPEN_ACCESS: "false" })).toBe(false);
  });
  it("opens on a preview or locally with the switch, never in production", () => {
    setEnv("preview", "production");
    expect(openDemoConfigured({ DEMO_OPEN_ACCESS: "true" })).toBe(true);
    setEnv("", "development");
    expect(openDemoConfigured({ DEMO_OPEN_ACCESS: "true" })).toBe(true);
    setEnv("production", "production");
    expect(openDemoConfigured({ DEMO_OPEN_ACCESS: "true" })).toBe(false);
    setEnv("", "production"); // a production build without VERCEL_ENV counts as production (ADR-023)
    expect(openDemoConfigured({ DEMO_OPEN_ACCESS: "true" })).toBe(false);
  });
  it("knows its roles", () => {
    for (const r of ["founder", "founder2", "supplier", "rider", "hub", "champion"]) expect(isOpenDemoRole(r)).toBe(true);
    for (const r of ["admin", "SUPER_ADMIN", "", null, 3]) expect(isOpenDemoRole(r)).toBe(false);
  });
});

describe("open demo phones", () => {
  it("accepts only the fake range from open-demo actors, in any common spelling", () => {
    const open = { openDemo: true };
    expect(() => assertOpenDemoPhone(open, "+255700009990")).not.toThrow();
    expect(() => assertOpenDemoPhone(open, "0700 009 990")).not.toThrow();
    expect(() => assertOpenDemoPhone(open, "+255712345678")).toThrow(expect.objectContaining({ code: "open_demo_fake_phone" }));
    expect(() => assertOpenDemoPhone(open, "0712 345 678")).toThrow(expect.objectContaining({ code: "open_demo_fake_phone" }));
  });
  it("leaves real sign-ins and empty fields alone", () => {
    expect(() => assertOpenDemoPhone({ openDemo: false }, "+255712345678")).not.toThrow();
    expect(() => assertOpenDemoPhone({}, "+255712345678")).not.toThrow();
    expect(() => assertOpenDemoPhone({ openDemo: true }, "")).not.toThrow();
    expect(() => assertOpenDemoPhone({ openDemo: true }, null)).not.toThrow();
  });
});
