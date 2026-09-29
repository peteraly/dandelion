/**
 * Server-action plumbing: run a mutation, map failures to i18n error codes,
 * and redirect back with `?error=code` or `?ok=key`. Pages are server
 * components that read those params; no client-side state is needed.
 * Internal messages never reach the client.
 */
import { redirect } from "next/navigation";
import { ZodError } from "zod";
import { PolicyError } from "@/lib/policy";
import { DomainError } from "@/lib/services/core";

export function errorCode(e: unknown): string {
  if (e instanceof DomainError) return e.code;
  if (e instanceof PolicyError) return "forbidden";
  if (e instanceof ZodError) {
    const first = e.issues[0];
    const msg = first?.message ?? "";
    return /^[a-z_]+$/.test(msg) ? msg : "invalid_input";
  }
  console.error("[action]", e);
  return "unknown";
}

function isRedirectError(e: unknown): boolean {
  return typeof e === "object" && e !== null && "digest" in e && String((e as { digest: unknown }).digest).startsWith("NEXT_REDIRECT");
}

/**
 * Run `fn`; on success redirect to `onOk` (string or function of result) with
 * `?ok=<key>`, on failure redirect back to `back` with `?error=<code>`.
 */
export async function act<T>(back: string, fn: () => Promise<T>, onOk: string | ((r: T) => string), okKey = "done"): Promise<never> {
  let target: string;
  try {
    const r = await fn();
    target = typeof onOk === "function" ? onOk(r) : onOk;
  } catch (e) {
    if (isRedirectError(e)) throw e;
    redirect(withParam(back, "error", errorCode(e)));
  }
  redirect(withParam(target, "ok", okKey));
}

export function withParam(path: string, key: string, value: string): string {
  const [p, q = ""] = path.split("?");
  const params = new URLSearchParams(q);
  params.delete("error");
  params.delete("ok");
  params.set(key, value);
  return `${p}?${params.toString()}`;
}

export function str(fd: FormData, name: string): string {
  const v = fd.get(name);
  return typeof v === "string" ? v.trim() : "";
}

export function bool(fd: FormData, name: string): boolean {
  return fd.get(name) === "true" || fd.get(name) === "on";
}

export function checks(fd: FormData, names: readonly string[]): Record<string, boolean> {
  return Object.fromEntries(names.map((n) => [n, bool(fd, n)]));
}

export type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export async function flags(sp: SearchParams): Promise<{ error?: string; ok?: string }> {
  const p = await sp;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  return { error: one(p.error), ok: one(p.ok) };
}
