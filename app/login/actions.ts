"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { LOCALE_COOKIE } from "@/i18n/request";
import { act, str, withParam } from "@/lib/actions";
import { clientIp, ensureDeviceId, setSessionCookie } from "@/lib/auth/current";
import { hitRateLimit } from "@/lib/security/rate-limit";
import { loginWithPin, lockWithPhoneAndPin } from "@/lib/services/users";
import { sha256Hex } from "@/lib/crypto/random";
import { DomainError } from "@/lib/services/core";

export async function loginAction(fd: FormData): Promise<void> {
  const ip = await clientIp();
  const rl = await hitRateLimit(`login:${sha256Hex(ip).slice(0, 16)}`, 30, 300);
  if (!rl.allowed) redirect(withParam("/login", "error", "temporarily_locked"));
  const device = await ensureDeviceId();
  const r = await loginWithPin(str(fd, "phone"), str(fd, "pin"), device, ip);
  if (!r.ok) redirect(withParam("/login", "error", r.error));
  await setSessionCookie("FIELD", r.sessionToken, r.expiresAt);
  const jar = await cookies();
  jar.set(LOCALE_COOKIE, r.locale, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
  redirect("/home");
}

export async function lockAction(fd: FormData): Promise<void> {
  const ip = await clientIp();
  const rl = await hitRateLimit(`lock:${sha256Hex(ip).slice(0, 16)}`, 10, 300);
  if (!rl.allowed) redirect(withParam("/lock", "error", "temporarily_locked"));
  await act(
    "/lock",
    async () => {
      const ok = await lockWithPhoneAndPin(str(fd, "phone"), str(fd, "pin"), ip);
      if (!ok) throw new DomainError("login_failed");
    },
    "/lock",
    "locked",
  ).catch((e) => {
    throw e;
  });
}
