"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { LOCALE_COOKIE } from "@/i18n/request";
import { str } from "@/lib/actions";
import { clientIp, setSessionCookie } from "@/lib/auth/current";
import { isOpenDemoRole, openDemoEntry } from "@/lib/demo/open";
import { DomainError, getSetting } from "@/lib/services/core";

/** One click, one role (Prompt E). The service decides whether the open demo exists at all. */
export async function enterDemoAction(fd: FormData): Promise<void> {
  const role = str(fd, "role");
  if (!isOpenDemoRole(role)) redirect("/demo?error=invalid_input");
  let target = "/home";
  try {
    const r = await openDemoEntry(role, await clientIp());
    await setSessionCookie(r.kind, r.token, r.expiresAt);
    const jar = await cookies();
    if (!jar.get(LOCALE_COOKIE)) jar.set(LOCALE_COOKIE, "en", { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
    if (r.kind === "ADMIN") target = (await getSetting("seedProfile")) === "demo" ? "/admin/demo" : "/admin/ecosystem";
  } catch (e) {
    redirect(`/demo?error=${e instanceof DomainError ? e.code : "unknown"}`);
  }
  redirect(target);
}
