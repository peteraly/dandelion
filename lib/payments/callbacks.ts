/**
 * Callback ingestion (§8): token → IP allowlist → rate limit → persist raw
 * payload (append-only, hash-chained) → enqueue VerificationJob → 200.
 *
 * The callback never changes any payment state. Its only effect is a job.
 */
import { desc } from "drizzle-orm";
import type { Tx } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import { ProviderIdSchema, secret, type ProviderId } from "@/lib/env";
import { safeEqual, sha256Hex } from "@/lib/crypto/random";
import { hitRateLimit } from "@/lib/security/rate-limit";
import { ipAllowed } from "@/lib/security/request";
import { logSecurityEvent, withTx } from "@/lib/services/core";
import { providerById } from "./index";

const GENESIS = "0".repeat(64);

export function callbackToken(provider: ProviderId): string {
  return secret(`CALLBACK_TOKEN_${provider.toUpperCase()}`, `dev-callback-token-${provider}`);
}

export function callbackAllowlist(provider: ProviderId): string[] {
  const raw = process.env[`CALLBACK_IP_ALLOWLIST_${provider.toUpperCase()}`] ?? "";
  return raw
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
}

export type CallbackResult = { status: 200; jobId: string } | { status: 400 | 403 | 404 | 429 };

/** Append the raw payload with a hash chain: chain = sha256(prev ‖ payloadHash). */
export async function appendProviderTransaction(tx: Tx, provider: string, source: "CALLBACK" | "POLL", payload: unknown, sourceIp: string | null): Promise<number> {
  const prev = await tx.query.providerTransactions.findFirst({ orderBy: desc(s.providerTransactions.id), columns: { chainHash: true } });
  const prevHash = prev?.chainHash ?? GENESIS;
  const payloadSha256 = sha256Hex(JSON.stringify(payload));
  const [row] = await tx
    .insert(s.providerTransactions)
    .values({ provider, source, sourceIp, payload: payload as object, payloadSha256, prevHash, chainHash: sha256Hex(prevHash + payloadSha256) })
    .returning({ id: s.providerTransactions.id });
  return row!.id;
}

export async function ingestCallback(providerRaw: string, token: string, ip: string, payload: unknown): Promise<CallbackResult> {
  const parsedProvider = ProviderIdSchema.safeParse(providerRaw);
  if (!parsedProvider.success) return { status: 404 };
  const provider = parsedProvider.data;

  if (!safeEqual(token, callbackToken(provider))) {
    await withTx((tx) => logSecurityEvent(tx, "CALLBACK_REJECTED", "ALERT", { ip, details: { provider, reason: "bad_token" } }));
    return { status: 404 };
  }
  if (!ipAllowed(ip, callbackAllowlist(provider))) {
    await withTx((tx) => logSecurityEvent(tx, "CALLBACK_REJECTED", "ALERT", { ip, details: { provider, reason: "ip_not_allowed" } }));
    return { status: 403 };
  }

  let payer = "unknown";
  try {
    payer = providerById(provider).parseCallback(payload).payerMsisdn ?? "unknown";
  } catch {
    await withTx((tx) => logSecurityEvent(tx, "CALLBACK_REJECTED", "WARN", { ip, details: { provider, reason: "malformed" } }));
    return { status: 400 };
  }
  const rl = await hitRateLimit(`cb:${provider}:${sha256Hex(payer).slice(0, 16)}`, 10, 60);
  if (!rl.allowed) {
    await withTx((tx) => logSecurityEvent(tx, "CALLBACK_RATE_LIMITED", "ALERT", { ip, subjectIndex: sha256Hex(payer).slice(0, 16), details: { provider, count: rl.count } }));
    return { status: 429 };
  }

  const jobId = await withTx(async (tx) => {
    const ptxId = await appendProviderTransaction(tx, provider, "CALLBACK", payload, ip);
    const [job] = await tx.insert(s.verificationJobs).values({ providerTransactionId: ptxId, provider, status: "QUEUED" }).returning({ id: s.verificationJobs.id });
    return job!.id;
  });
  return { status: 200, jobId };
}
