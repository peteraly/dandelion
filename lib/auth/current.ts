/**
 * Current-request session helpers for server components, actions and route
 * handlers. Cookies: `sid` (field), `asid` (admin), `csid` (shop customer) — HttpOnly, Secure,
 * SameSite=Strict; the DB holds only their hashes.
 */
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { appEnv } from "@/lib/env";
import type { Actor } from "@/lib/policy";
import { loadSession, revokeSession, type LoadedSession } from "./session";
import { loadCustomerSession, revokeCustomerSession, type ShopCustomer } from "./customer-session";

export const FIELD_COOKIE = "sid";
export const ADMIN_COOKIE = "asid";
export const DEVICE_COOKIE = "did";
/** A customer's shop session (Prompt L §3); separate from staff sessions, never an Actor. */
export const CUSTOMER_COOKIE = "csid";

const secure = appEnv() !== "development";

export function cookieOptions(expiresAt: Date) {
  return { httpOnly: true, secure, sameSite: "strict" as const, path: "/", expires: expiresAt };
}

export async function setSessionCookie(kind: "FIELD" | "ADMIN", token: string, expiresAt: Date): Promise<void> {
  const jar = await cookies();
  jar.set(kind === "FIELD" ? FIELD_COOKIE : ADMIN_COOKIE, token, cookieOptions(expiresAt));
}

export async function clearSessionCookie(kind: "FIELD" | "ADMIN"): Promise<void> {
  const jar = await cookies();
  const name = kind === "FIELD" ? FIELD_COOKIE : ADMIN_COOKIE;
  const token = jar.get(name)?.value;
  if (token) await revokeSession(token);
  jar.delete(name);
}

/** A per-browser random id, used only for OTP new-device alerts. */
export async function deviceId(): Promise<string | null> {
  const jar = await cookies();
  return jar.get(DEVICE_COOKIE)?.value ?? null;
}

export async function ensureDeviceId(): Promise<string> {
  const jar = await cookies();
  const existing = jar.get(DEVICE_COOKIE)?.value;
  if (existing) return existing;
  const id = crypto.randomUUID();
  jar.set(DEVICE_COOKIE, id, { httpOnly: true, secure, sameSite: "strict", path: "/", maxAge: 60 * 60 * 24 * 365 });
  return id;
}

export async function clientIp(): Promise<string> {
  const h = await headers();
  return h.get("x-real-ip") ?? h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "0.0.0.0";
}

export function toActor(s: LoadedSession): Actor {
  return {
    userId: s.user.id,
    role: s.user.role,
    hubId: s.user.hubId,
    supplierId: s.user.supplierId,
    mfa: s.kind === "ADMIN" && s.mfaVerified,
    openDemo: s.via === "OPEN_DEMO",
  };
}

export async function currentFieldSession(): Promise<LoadedSession | null> {
  const jar = await cookies();
  const s = await loadSession(jar.get(FIELD_COOKIE)?.value);
  return s && s.kind === "FIELD" && s.user.role !== "SUPER_ADMIN" ? s : null;
}

export async function currentAdminSession(): Promise<LoadedSession | null> {
  const jar = await cookies();
  const s = await loadSession(jar.get(ADMIN_COOKIE)?.value);
  return s && s.kind === "ADMIN" && s.user.role === "SUPER_ADMIN" ? s : null;
}

/** Field pages: redirect to login when there is no session. */
export async function requireField(): Promise<{ session: LoadedSession; actor: Actor }> {
  const session = await currentFieldSession();
  if (!session) redirect("/login?expired=1");
  return { session, actor: toActor(session) };
}

/** Admin pages: a session without the second factor goes to the 2FA step. */
export async function requireAdmin(): Promise<{ session: LoadedSession; actor: Actor }> {
  const session = await currentAdminSession();
  if (!session) redirect("/admin/login");
  if (!session.mfaVerified) redirect("/admin/login/second-factor");
  return { session, actor: toActor(session) };
}

/** Field server actions: the field session only, even when the same browser also holds an admin session. */
export async function fieldActorFromCookies(): Promise<Actor | null> {
  const field = await currentFieldSession();
  return field ? toActor(field) : null;
}

/** Admin server actions: the admin session only, even when the same browser also holds a field session. */
export async function adminActorFromCookies(): Promise<Actor | null> {
  const admin = await currentAdminSession();
  return admin ? toActor(admin) : null;
}

/** For server actions: returns null instead of redirecting. */
export async function actorFromCookies(): Promise<Actor | null> {
  const admin = await currentAdminSession();
  if (admin) return toActor(admin);
  const field = await currentFieldSession();
  return field ? toActor(field) : null;
}

/** The customer signed in to the shop, or null. Customers are not staff: they never get an Actor or a staff page. */
export async function currentCustomer(): Promise<ShopCustomer | null> {
  const jar = await cookies();
  return loadCustomerSession(jar.get(CUSTOMER_COOKIE)?.value);
}

export async function setCustomerCookie(token: string, expiresAt: Date): Promise<void> {
  const jar = await cookies();
  jar.set(CUSTOMER_COOKIE, token, cookieOptions(expiresAt));
}

export async function clearCustomerCookie(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(CUSTOMER_COOKIE)?.value;
  if (token) await revokeCustomerSession(token);
  jar.delete(CUSTOMER_COOKIE);
}
