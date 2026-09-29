/**
 * Security headers for every response (build prompt §2) and a per-request
 * CSP nonce. Authentication is NOT done here: every server action and
 * route handler checks the session and the policy module itself.
 */
import { NextResponse, type NextRequest } from "next/server";

export function proxy(request: NextRequest): NextResponse {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const isDev = process.env.NODE_ENV === "development";
  const path = request.nextUrl.pathname;

  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    // Tailwind and Next inject inline styles; nonce them, no unsafe-inline for scripts.
    `style-src 'self' 'nonce-${nonce}' 'unsafe-inline'`,
    "img-src 'self' blob: data:",
    "font-src 'self'",
    "connect-src 'self'",
    "worker-src 'self'",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(isDev ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");

  // Microphone only on the problem-report screen (optional voice intake); camera and geolocation never.
  const micAllowed = /^\/(problem|admin\/problem)(\/|$)/.test(path);
  const permissions = `camera=(), geolocation=(), microphone=${micAllowed ? "(self)" : "()"}, payment=(), usb=()`;

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("Referrer-Policy", "same-origin");
  response.headers.set("Permissions-Policy", permissions);
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("Cross-Origin-Opener-Policy", "same-origin");
  response.headers.set("Cross-Origin-Resource-Policy", "same-origin");
  if (!isDev) response.headers.set("Strict-Transport-Security", "max-age=63072000; includeSubDomains");
  return response;
}

export const config = {
  matcher: [
    {
      source: "/((?!_next/static|_next/image|favicon.ico|icons/|sw.js|manifest.webmanifest).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
