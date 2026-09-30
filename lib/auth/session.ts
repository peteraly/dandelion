/**
 * Server-side sessions. The cookie holds a random 256-bit token; the DB
 * stores only its SHA-256. Idle timeout 15 minutes (handbook §7).
 */
import { now, nowMs } from "@/lib/clock";
import { and, eq, isNull } from "drizzle-orm";
import { getDb, type DbOrTx } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import { randomToken, sha256Hex } from "@/lib/crypto/random";

export const IDLE_TIMEOUT_MS = 15 * 60_000;
export const FIELD_MAX_AGE_MS = 12 * 60 * 60_000;
export const ADMIN_MAX_AGE_MS = 8 * 60 * 60_000;
/** An admin session that has not passed the second factor lives 5 minutes. */
export const ADMIN_PENDING_MFA_MS = 5 * 60_000;

export type SessionKind = "FIELD" | "ADMIN";

export async function createSession(
  userId: string,
  kind: SessionKind,
  opts: { deviceId?: string | null; mfaVerified?: boolean; via?: "LOGIN" | "OPEN_DEMO" } = {},
  db: DbOrTx = getDb(),
): Promise<{ token: string; expiresAt: Date }> {
  const token = randomToken();
  const t = nowMs();
  const expiresAt = new Date(t + (kind === "ADMIN" ? (opts.mfaVerified ? ADMIN_MAX_AGE_MS : ADMIN_PENDING_MFA_MS) : FIELD_MAX_AGE_MS));
  await db.insert(s.sessions).values({
    id: sha256Hex(token),
    userId,
    kind,
    deviceId: opts.deviceId ?? null,
    mfaVerifiedAt: opts.mfaVerified ? now() : null,
    via: opts.via ?? "LOGIN",
    expiresAt,
  });
  return { token, expiresAt };
}

export interface LoadedSession {
  id: string;
  kind: SessionKind;
  mfaVerified: boolean;
  /** "OPEN_DEMO" when the session came from the open demo's one-click entry. */
  via: "LOGIN" | "OPEN_DEMO";
  user: typeof s.users.$inferSelect;
}

export async function loadSession(token: string | undefined, at = now(), touch = true): Promise<LoadedSession | null> {
  if (!token || token.length < 20 || token.length > 100) return null;
  const db = getDb();
  const id = sha256Hex(token);
  const row = await db.query.sessions.findFirst({ where: and(eq(s.sessions.id, id), isNull(s.sessions.revokedAt)) });
  if (!row) return null;
  if (row.expiresAt <= at || at.getTime() - row.lastSeenAt.getTime() > IDLE_TIMEOUT_MS) {
    await db.update(s.sessions).set({ revokedAt: at }).where(eq(s.sessions.id, id));
    return null;
  }
  const user = await db.query.users.findFirst({ where: eq(s.users.id, row.userId) });
  if (!user || user.status !== "ACTIVE") return null;
  if (touch && at.getTime() - row.lastSeenAt.getTime() > 20_000) {
    await db.update(s.sessions).set({ lastSeenAt: at }).where(eq(s.sessions.id, id));
  }
  return { id, kind: row.kind, mfaVerified: row.mfaVerifiedAt !== null, via: row.via, user };
}

export async function revokeSession(token: string): Promise<void> {
  await getDb().update(s.sessions).set({ revokedAt: now() }).where(eq(s.sessions.id, sha256Hex(token)));
}

export async function revokeAllSessions(userId: string, db: DbOrTx = getDb()): Promise<void> {
  await db.update(s.sessions).set({ revokedAt: now() }).where(and(eq(s.sessions.userId, userId), isNull(s.sessions.revokedAt)));
}

export async function markMfaVerified(sessionId: string): Promise<void> {
  await getDb()
    .update(s.sessions)
    .set({ mfaVerifiedAt: now(), expiresAt: new Date(nowMs() + ADMIN_MAX_AGE_MS), lastSeenAt: now() })
    .where(eq(s.sessions.id, sessionId));
}
