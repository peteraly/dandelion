/**
 * Environment detection and configuration.
 *
 * We detect the deployment environment from VERCEL_ENV, never NODE_ENV:
 * Vercel previews run with NODE_ENV=production. When VERCEL_ENV is unset we
 * are on a developer machine or in CI, which we treat as "development".
 *
 * Secrets have deterministic defaults ONLY in development so tests and local
 * runs work without setup. Preview and production must configure them.
 */
import { z } from "zod";

export type AppEnv = "production" | "preview" | "development";

export function appEnv(): AppEnv {
  const v = process.env.VERCEL_ENV;
  if (v === "production" || v === "preview") return v;
  return "development";
}

export const isProduction = (): boolean => appEnv() === "production";

export const TIMEZONE = "Africa/Dar_es_Salaam";

function flag(name: string, fallback = false): boolean {
  const v = process.env[name];
  if (v === undefined || v === "") return fallback;
  return v === "true" || v === "1";
}

/** Read a secret. Development gets a fixed, clearly-fake default. */
export function secret(name: string, devDefault: string): string {
  const v = process.env[name];
  if (v && v.length > 0) return v;
  if (appEnv() === "development") return devDefault;
  throw new Error(`Missing required secret ${name} in ${appEnv()}`);
}

export function optionalSecret(name: string): string | undefined {
  const v = process.env[name];
  return v && v.length > 0 ? v : undefined;
}

export const ProviderIdSchema = z.enum(["mock", "vodacom_mpesa", "aggregator"]);
export type ProviderId = z.infer<typeof ProviderIdSchema>;

/**
 * Payment provider selection. Outside production this is FORCED to mock,
 * regardless of configuration (build prompt §1).
 */
export function paymentProviderId(): ProviderId {
  if (!isProduction()) return "mock";
  return ProviderIdSchema.parse(process.env.PAYMENT_PROVIDER ?? "mock");
}

export type SmsProviderId = "mock" | "http";
/** SMS provider. Forced to mock outside production. */
export function smsProviderId(): SmsProviderId {
  if (!isProduction()) return "mock";
  return process.env.SMS_PROVIDER === "http" ? "http" : "mock";
}

export type ChainNetwork = "testnet" | "mainnet";
/** Chain network. Forced to testnet outside production; mainnet also waits for gate G4. */
export function chainNetwork(): ChainNetwork {
  if (!isProduction()) return "testnet";
  return process.env.CHAIN_NETWORK === "mainnet" ? "mainnet" : "testnet";
}

/** The dev simulator hard guard (build prompt §8). */
export function simulatorEnabled(): boolean {
  return appEnv() !== "production" && flag("SIMULATOR_ENABLED");
}

export function aiEnabled(): boolean {
  return flag("AI_ENABLED", false);
}

export function aiModel(): string {
  return process.env.AI_MODEL || "claude-sonnet-5-5";
}

export function appOrigin(): string {
  if (process.env.APP_ORIGIN) return process.env.APP_ORIGIN.replace(/\/$/, "");
  if (appEnv() === "production" && process.env.VERCEL_PROJECT_PRODUCTION_URL) {
    return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  }
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "http://localhost:3000";
}

export function helpContacts(): { phone: string; whatsapp: string } {
  return {
    phone: process.env.HELP_PHONE ?? "+255 700 000 000",
    whatsapp: process.env.HELP_WHATSAPP ?? "+255 700 000 000",
  };
}

export function isTestRun(): boolean {
  return process.env.VITEST === "true" || flag("E2E");
}
