/**
 * The open demo (Prompt E, ADR-033): one click per role, no passphrase, no
 * code, no PIN — for showing the fictional district to people who have no
 * account. It exists only when all three hold:
 *
 *   1. the environment is not production (fail-closed appEnv, ADR-023);
 *   2. DEMO_OPEN_ACCESS=true is set for that environment;
 *   3. the database was filled by our own seed (settings.seedProfile is
 *      "demo" or "minimal": fictional people marked (TEST), fake phones).
 *
 * Sessions opened this way carry via = OPEN_DEMO. They cannot wipe the
 * database, export data or register passkeys, and every phone they type
 * must be in the fake range (lib/security/open-demo.ts).
 */
import { and, asc, eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import { appEnv } from "@/lib/env";
import { createSession } from "@/lib/auth/session";
import { phoneBlindIndex } from "@/lib/crypto/blind-index";
import { sha256Hex } from "@/lib/crypto/random";
import { hitRateLimit } from "@/lib/security/rate-limit";
import { DomainError, getSetting, logSecurityEvent } from "@/lib/services/core";
import { SEED } from "@/lib/seed-identities";
import type { Role } from "@/lib/domain/types";

export const OPEN_DEMO_ROLES = ["founder", "founder2", "supplier", "rider", "hub", "champion"] as const;
export type OpenDemoRole = (typeof OPEN_DEMO_ROLES)[number];

const ROLE_OF: Record<OpenDemoRole, { role: Role; phone: string }> = {
  founder: { role: "SUPER_ADMIN", phone: SEED.adminA.phone },
  founder2: { role: "SUPER_ADMIN", phone: SEED.adminB.phone },
  supplier: { role: "SUPPLIER", phone: SEED.supplier.phone },
  rider: { role: "BOSS_RIDER", phone: SEED.riders[0]!.phone },
  hub: { role: "HUB_MANAGER", phone: SEED.hub.phone },
  champion: { role: "FIELD_CHAMPION", phone: SEED.champions[0]!.phone },
};

/** Conditions 1 and 2: cheap, no database. */
export function openDemoConfigured(env: Record<string, string | undefined> = process.env): boolean {
  return appEnv() !== "production" && env.DEMO_OPEN_ACCESS === "true";
}

/** All three conditions. Any error (no database, not migrated) means closed. */
export async function openDemoEnabled(): Promise<boolean> {
  if (!openDemoConfigured()) return false;
  try {
    const profile = await getSetting("seedProfile");
    return profile === "demo" || profile === "minimal";
  } catch {
    return false;
  }
}

export function isOpenDemoRole(v: unknown): v is OpenDemoRole {
  return typeof v === "string" && (OPEN_DEMO_ROLES as readonly string[]).includes(v);
}

async function demoUser(role: OpenDemoRole): Promise<typeof s.users.$inferSelect | null> {
  const db = getDb();
  const want = ROLE_OF[role];
  const byPhone = await db.query.users.findFirst({ where: eq(s.users.phoneIndex, phoneBlindIndex(want.phone)) });
  if (byPhone && byPhone.status === "ACTIVE" && byPhone.role === want.role) return byPhone;
  // The seeded person may have been suspended or re-enrolled during the demo: fall back to another active one.
  const candidates = await db.query.users.findMany({ where: and(eq(s.users.role, want.role), eq(s.users.status, "ACTIVE")), orderBy: asc(s.users.createdAt), limit: 3 });
  if (role === "founder2") {
    const founder = await demoUser("founder");
    return candidates.find((u) => u.id !== founder?.id) ?? null;
  }
  return candidates[0] ?? null;
}

export async function openDemoEntry(role: OpenDemoRole, ip: string): Promise<{ token: string; expiresAt: Date; kind: "ADMIN" | "FIELD"; locale: "sw" | "en" }> {
  if (!(await openDemoEnabled())) throw new DomainError("open_demo_disabled");
  const rl = await hitRateLimit(`opendemo:${sha256Hex(ip).slice(0, 16)}`, 40, 600);
  if (!rl.allowed) throw new DomainError("rate_limited");
  const user = await demoUser(role);
  if (!user) throw new DomainError("not_found");
  const kind = user.role === "SUPER_ADMIN" ? "ADMIN" : "FIELD";
  const { token, expiresAt } = await createSession(user.id, kind, { mfaVerified: kind === "ADMIN", via: "OPEN_DEMO" });
  await logSecurityEvent(getDb(), "OPEN_DEMO_ENTRY", "INFO", { userId: user.id, ip, details: { role } });
  return { token, expiresAt, kind, locale: user.preferredLocale };
}
