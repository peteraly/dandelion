import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  // Native / wasm modules that must not be bundled.
  serverExternalPackages: ["@node-rs/argon2", "pg"],
  // Static-asset fallback headers. The per-request CSP (with nonce) and the
  // path-dependent Permissions-Policy are set in proxy.ts.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "same-origin" },
        ],
      },
    ];
  },
};

export default withNextIntl(nextConfig);
