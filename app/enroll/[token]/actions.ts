"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { LOCALE_COOKIE } from "@/i18n/request";
import { act, str, withParam } from "@/lib/actions";
import { clientIp, ensureDeviceId, setSessionCookie } from "@/lib/auth/current";
import { completeFieldEnrollment, startFieldEnrollment } from "@/lib/services/users";
import { hitRateLimit } from "@/lib/security/rate-limit";
import { sha256Hex } from "@/lib/crypto/random";
import { DomainError } from "@/lib/services/core";

export async function startEnrollAction(fd: FormData): Promise<void> {
  const token = str(fd, "token");
  const back = `/enroll/${token}`;
  const ip = await clientIp();
  const rl = await hitRateLimit(`enroll:${sha256Hex(ip).slice(0, 16)}`, 10, 600);
  if (!rl.allowed) redirect(withParam(back, "error", "otp_rate_limited"));
  const device = await ensureDeviceId();
  await act(back, () => startFieldEnrollment(token, str(fd, "phone"), device, ip), (r) => `${back}?challenge=${r.challengeId}`);
}

export async function completeEnrollAction(fd: FormData): Promise<void> {
  const token = str(fd, "token");
  const challengeId = str(fd, "challengeId");
  const back = `/enroll/${token}?challenge=${challengeId}`;
  if (str(fd, "pin") !== str(fd, "pin2")) redirect(withParam(back, "error", "pin_format"));
  const device = await ensureDeviceId();
  let session: Awaited<ReturnType<typeof completeFieldEnrollment>>;
  try {
    session = await completeFieldEnrollment(token, challengeId, str(fd, "code"), str(fd, "pin"), device);
  } catch (e) {
    redirect(withParam(back, "error", e instanceof DomainError ? e.code : "unknown"));
  }
  await setSessionCookie("FIELD", session.sessionToken, session.expiresAt);
  const jar = await cookies();
  jar.set(LOCALE_COOKIE, session.locale, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
  redirect("/home");
}
