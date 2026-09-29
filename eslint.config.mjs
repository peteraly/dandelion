import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    },
  },
  {
    // Invariant §3.13: AI has no write path. lib/ai/** may read domain types
    // and pure helpers, but never the DB client, schema, or any service that
    // writes. Enforced here; tests/unit/ai-boundary.test.ts double-checks.
    files: ["lib/ai/**/*.ts", "lib/ai/**/*.tsx"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            { group: ["@/lib/db", "@/lib/db/*", "**/lib/db/*", "drizzle-orm", "drizzle-orm/*", "pg", "@neondatabase/serverless"], message: "AI code must not touch the database (invariant §3.13)." },
            { group: ["@/lib/services/*", "**/lib/services/*"], message: "AI code must not import services (no write path, invariant §3.13)." },
            { group: ["@/lib/payments/*", "**/lib/payments/*"], message: "AI code must not touch payments (invariant §3.1, §3.13)." },
            { group: ["@/lib/auth/*", "**/lib/auth/*"], message: "AI code must not touch auth." },
          ],
        },
      ],
    },
  },
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts", "contracts/**", "drizzle/**", "coverage/**", "playwright-report/**", "test-results/**"]),
]);

export default eslintConfig;
