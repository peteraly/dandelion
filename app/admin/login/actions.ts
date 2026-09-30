"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { AuthenticationResponseJSON, RegistrationResponseJSON } from "@simplewebauthn/server";
import { LOCALE_COOKIE } from "@/i18n/request";
import { str, withParam } from "@/lib/actions";
import { clientIp, currentAdminSession, ensureDeviceId, setSessionCookie } from "@/lib/auth/current";
import { markMfaVerified } from "@/lib/auth/session";
import { adminHasPasskey, authenticationOptions, registrationOptions, verifyAuthentication, verifyRegistration } from "@/lib/auth/webauthn";
import { hitRateLimit } from "@/lib/security/rate-limit";
import { adminPassphraseLogin, adminVerifyTotp } from "@/lib/services/users";
import { sha256Hex } from "@/lib/crypto/random";

export async function adminLoginAction(fd: FormData): Promise<void> {
  const ip = await clientIp();
  const rl = await hitRateLimit(`alogin:${sha256Hex(ip).slice(0, 16)}`, 20, 300);
  if (!rl.allowed) redirect(withParam("/admin/login", "error", "temporarily_locked"));
  const device = await ensureDeviceId();
  const r = await adminPassphraseLogin(str(fd, "phone"), str(fd, "passphrase"), device, ip);
  if (!r.ok) redirect(withParam("/admin/login", "error", r.error));
  await setSessionCookie("ADMIN", r.sessionToken, r.expiresAt);
  const jar = await cookies();
  jar.set(LOCALE_COOKIE, r.locale, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
  redirect("/admin/login/second-factor");
}

export async function adminTotpAction(fd: FormData): Promise<void> {
  const session = await currentAdminSession();
  if (!session) redirect("/admin/login");
  const ok = await adminVerifyTotp(session.user.id, str(fd, "code"), await clientIp());
  if (!ok) redirect(withParam("/admin/login/second-factor", "error", "totp_invalid"));
  await markMfaVerified(session.id);
  redirect((await adminHasPasskey(session.user.id)) ? "/admin" : "/admin/passkeys?first=1");
}

export async function passkeyAuthOptionsAction(): Promise<unknown> {
  const session = await currentAdminSession();
  if (!session) return null;
  if (!(await adminHasPasskey(session.user.id))) return null;
  return authenticationOptions(session.id, session.user.id);
}

export async function passkeyAuthVerifyAction(response: AuthenticationResponseJSON): Promise<{ ok: boolean }> {
  const session = await currentAdminSession();
  if (!session) return { ok: false };
  const ok = await verifyAuthentication(session.id, session.user.id, response, await clientIp());
  if (ok) await markMfaVerified(session.id);
  return { ok };
}

export async function passkeyRegisterOptionsAction(): Promise<unknown> {
  const session = await currentAdminSession();
  // A passkey on a shared demo account would let one visitor's device sign in for everyone (Prompt E).
  if (!session?.mfaVerified || session.via === "OPEN_DEMO") return null;
  return registrationOptions(session.id, { id: session.user.id, displayName: session.user.displayName });
}

export async function passkeyRegisterVerifyAction(response: RegistrationResponseJSON): Promise<{ ok: boolean }> {
  const session = await currentAdminSession();
  if (!session?.mfaVerified || session.via === "OPEN_DEMO") return { ok: false };
  return { ok: await verifyRegistration(session.id, session.user.id, response) };
}
