import { afterEach, describe, expect, it } from "vitest";
import { appEnv, chainNetwork, paymentProviderId, simulatorEnabled, smsProviderId, aiEnabled } from "@/lib/env";

const saved = { ...process.env };
// NODE_ENV is typed read-only by Next.js; tests still need to vary it.
const setNodeEnv = (v: string) => Object.assign(process.env, { NODE_ENV: v });
afterEach(() => {
  process.env = { ...saved };
});

describe("environment guards (build prompt §1, §8)", () => {
  it("VERCEL_ENV decides the environment; a preview is never mistaken for production because of NODE_ENV", () => {
    process.env.VERCEL_ENV = "";
    setNodeEnv("test");
    expect(appEnv()).toBe("development");
    process.env.VERCEL_ENV = "preview";
    setNodeEnv("production");
    expect(appEnv()).toBe("preview");
    process.env.VERCEL_ENV = "production";
    expect(appEnv()).toBe("production");
  });

  it("fails closed: a production build without VERCEL_ENV is production (ADR-023)", () => {
    delete process.env.VERCEL_ENV;
    setNodeEnv("production");
    expect(appEnv()).toBe("production");
    expect(simulatorEnabled()).toBe(false);
    process.env.VERCEL_ENV = "";
    expect(appEnv()).toBe("production");
    setNodeEnv("development");
    expect(appEnv()).toBe("development");
  });

  it("outside production the payment provider, SMS and chain are forced to mocks/testnet", () => {
    process.env.VERCEL_ENV = "preview";
    process.env.PAYMENT_PROVIDER = "vodacom_mpesa";
    process.env.SMS_PROVIDER = "http";
    process.env.CHAIN_NETWORK = "mainnet";
    expect(paymentProviderId()).toBe("mock");
    expect(smsProviderId()).toBe("mock");
    expect(chainNetwork()).toBe("testnet");
    process.env.VERCEL_ENV = "production";
    expect(paymentProviderId()).toBe("vodacom_mpesa");
    expect(smsProviderId()).toBe("http");
    expect(chainNetwork()).toBe("mainnet");
  });

  it("simulator: 404 unless non-production AND SIMULATOR_ENABLED=true", () => {
    process.env.VERCEL_ENV = "production";
    process.env.SIMULATOR_ENABLED = "true";
    expect(simulatorEnabled()).toBe(false);
    process.env.VERCEL_ENV = "preview";
    process.env.SIMULATOR_ENABLED = "";
    expect(simulatorEnabled()).toBe(false);
    process.env.SIMULATOR_ENABLED = "true";
    expect(simulatorEnabled()).toBe(true);
  });

  it("AI ships off by default", () => {
    delete process.env.AI_ENABLED;
    expect(aiEnabled()).toBe(false);
  });
});
