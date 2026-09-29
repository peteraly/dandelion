"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { LOCALE_COOKIE } from "@/i18n/request";
import { isLocale } from "@/lib/i18n/server-translator";
import { clearSessionCookie } from "@/lib/auth/current";

/** Same-origin referer path (with query), or null. Used to return to the page the toggle was on. */
async function refererPath(): Promise<string | null> {
  const h = await headers();
  const ref = h.get("referer");
  const host = h.get("x-forwarded-host") ?? h.get("host");
  if (!ref || !host) return null;
  try {
    const u = new URL(ref);
    return u.host === host ? `${u.pathname}${u.search}` : null;
  } catch {
    return null;
  }
}

export async function setLocale(formData: FormData): Promise<void> {
  const locale = formData.get("locale");
  const back = String(formData.get("back") ?? "/");
  if (isLocale(locale)) {
    const jar = await cookies();
    jar.set(LOCALE_COOKIE, locale, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
  }
  const target = (await refererPath()) ?? back;
  redirect(target.startsWith("/") ? target : "/");
}

export async function logoutField(): Promise<void> {
  await clearSessionCookie("FIELD");
  redirect("/login");
}

export async function logoutAdmin(): Promise<void> {
  await clearSessionCookie("ADMIN");
  redirect("/admin/login");
}
