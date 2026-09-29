/**
 * Admin passkeys (WebAuthn) — the required admin second factor (§3.16), with
 * TOTP as the fallback. Challenges are bound to the pending admin session.
 */
import { now, nowMs } from "@/lib/clock";
import { and, eq, gt } from "drizzle-orm";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type RegistrationResponseJSON,
} from "@simplewebauthn/server";
import { getDb } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import { appOrigin } from "@/lib/env";
import { logSecurityEvent } from "@/lib/services/core";

const RP_NAME = "Dandelion Pilot";
const CHALLENGE_TTL_MS = 5 * 60_000;

function rp() {
  const origin = appOrigin();
  return { rpID: new URL(origin).hostname, origin };
}

async function storeChallenge(sessionId: string, challenge: string, kind: "REGISTER" | "AUTHENTICATE") {
  const db = getDb();
  await db.delete(s.webauthnChallenges).where(eq(s.webauthnChallenges.sessionId, sessionId));
  await db.insert(s.webauthnChallenges).values({ sessionId, challenge, kind, expiresAt: new Date(nowMs() + CHALLENGE_TTL_MS) });
}

async function takeChallenge(sessionId: string, kind: "REGISTER" | "AUTHENTICATE"): Promise<string | null> {
  const db = getDb();
  const row = await db.query.webauthnChallenges.findFirst({
    where: and(eq(s.webauthnChallenges.sessionId, sessionId), eq(s.webauthnChallenges.kind, kind), gt(s.webauthnChallenges.expiresAt, now())),
  });
  if (!row) return null;
  await db.delete(s.webauthnChallenges).where(eq(s.webauthnChallenges.id, row.id));
  return row.challenge;
}

export async function adminHasPasskey(userId: string): Promise<boolean> {
  return !!(await getDb().query.webauthnCredentials.findFirst({ where: eq(s.webauthnCredentials.userId, userId) }));
}

export async function registrationOptions(sessionId: string, user: { id: string; displayName: string }) {
  const { rpID } = rp();
  const existing = await getDb().query.webauthnCredentials.findMany({ where: eq(s.webauthnCredentials.userId, user.id) });
  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID,
    userName: user.displayName,
    userDisplayName: user.displayName,
    attestationType: "none",
    excludeCredentials: existing.map((c) => ({ id: c.id, transports: (c.transports ?? undefined) as never })),
    authenticatorSelection: { residentKey: "preferred", userVerification: "required" },
  });
  await storeChallenge(sessionId, options.challenge, "REGISTER");
  return options;
}

export async function verifyRegistration(sessionId: string, userId: string, response: RegistrationResponseJSON): Promise<boolean> {
  const { rpID, origin } = rp();
  const challenge = await takeChallenge(sessionId, "REGISTER");
  if (!challenge) return false;
  const v = await verifyRegistrationResponse({ response, expectedChallenge: challenge, expectedOrigin: origin, expectedRPID: rpID, requireUserVerification: true }).catch(() => null);
  if (!v?.verified || !v.registrationInfo) return false;
  const cred = v.registrationInfo.credential;
  await getDb()
    .insert(s.webauthnCredentials)
    .values({ id: cred.id, userId, publicKey: Buffer.from(cred.publicKey), counter: cred.counter, transports: cred.transports ?? null });
  await logSecurityEvent(getDb(), "ADMIN_PASSKEY_REGISTERED", "INFO", { userId });
  return true;
}

export async function authenticationOptions(sessionId: string, userId: string) {
  const { rpID } = rp();
  const creds = await getDb().query.webauthnCredentials.findMany({ where: eq(s.webauthnCredentials.userId, userId) });
  const options = await generateAuthenticationOptions({
    rpID,
    userVerification: "required",
    allowCredentials: creds.map((c) => ({ id: c.id, transports: (c.transports ?? undefined) as never })),
  });
  await storeChallenge(sessionId, options.challenge, "AUTHENTICATE");
  return options;
}

export async function verifyAuthentication(sessionId: string, userId: string, response: AuthenticationResponseJSON, ip: string | null): Promise<boolean> {
  const { rpID, origin } = rp();
  const db = getDb();
  const challenge = await takeChallenge(sessionId, "AUTHENTICATE");
  const cred = await db.query.webauthnCredentials.findFirst({ where: and(eq(s.webauthnCredentials.id, response.id), eq(s.webauthnCredentials.userId, userId)) });
  if (!challenge || !cred) {
    await logSecurityEvent(db, "ADMIN_2FA_FAILED", "ALERT", { userId, ip, details: { factor: "passkey", reason: "no_challenge_or_credential" } });
    return false;
  }
  const v = await verifyAuthenticationResponse({
    response,
    expectedChallenge: challenge,
    expectedOrigin: origin,
    expectedRPID: rpID,
    requireUserVerification: true,
    credential: { id: cred.id, publicKey: new Uint8Array(cred.publicKey), counter: cred.counter, transports: (cred.transports ?? undefined) as never },
  }).catch(() => null);
  if (!v?.verified) {
    await logSecurityEvent(db, "ADMIN_2FA_FAILED", "ALERT", { userId, ip, details: { factor: "passkey" } });
    return false;
  }
  await db.update(s.webauthnCredentials).set({ counter: v.authenticationInfo.newCounter, lastUsedAt: now() }).where(eq(s.webauthnCredentials.id, cred.id));
  return true;
}
