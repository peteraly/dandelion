/**
 * Request metadata helpers. On Vercel, x-forwarded-for / x-real-ip are set
 * by the platform edge; elsewhere we fall back to a placeholder.
 */
export function clientIpFrom(headers: Headers): string {
  const real = headers.get("x-real-ip");
  if (real) return real.trim();
  const fwd = headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]!.trim();
  return "0.0.0.0";
}

/** For cookie-authenticated route handlers (Server Actions get this from Next.js). */
export function isSameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return false;
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

/** IPv4 CIDR allowlist check. Empty list = allow all. */
export function ipAllowed(ip: string, allowlist: readonly string[]): boolean {
  if (allowlist.length === 0) return true;
  const toInt = (a: string) => a.split(".").reduce((acc, o) => (acc << 8) + (Number.parseInt(o, 10) & 255), 0) >>> 0;
  if (!/^\d+\.\d+\.\d+\.\d+$/.test(ip)) return false;
  const ipn = toInt(ip);
  return allowlist.some((entry) => {
    const [base, bitsRaw] = entry.trim().split("/");
    if (!base || !/^\d+\.\d+\.\d+\.\d+$/.test(base)) return false;
    const bits = bitsRaw === undefined ? 32 : Number.parseInt(bitsRaw, 10);
    if (!(bits >= 0 && bits <= 32)) return false;
    const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
    return (ipn & mask) === (toInt(base) & mask);
  });
}

/**
 * A path this site may redirect back to: same-origin only. Rejects
 * protocol-relative ("//host") and backslash forms ("/\\host"), control
 * characters, and — when `within` is given — anything outside those routes.
 * Returns null when the value is not acceptable; callers fall back to a fixed page.
 */
export function returnPath(candidate: unknown, within?: readonly string[]): string | null {
  if (typeof candidate !== "string") return null;
  if (!/^\/(?![\/\\])[^\r\n\t\0]*$/.test(candidate)) return null;
  if (within && !within.some((prefix) => candidate === prefix || candidate.startsWith(`${prefix}?`) || candidate.startsWith(`${prefix}/`))) return null;
  return candidate;
}
