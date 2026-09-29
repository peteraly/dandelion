/**
 * Runs before `next build` (see the "build" script in package.json), so a
 * Vercel deployment needs no terminal:
 *
 *  1. applies the forward-only migrations when a database is configured
 *     (prefers the unpooled Neon URL for DDL — variable names set by the Neon
 *     integration should be verified against current Neon docs);
 *  2. seeds the demo data when SEED_ON_BUILD=true and the environment is not
 *     production. The seed is idempotent and refuses production on its own too
 *     (scripts/seed.ts → refuseIfProduction). SEED_RESET is never forwarded.
 *
 * SKIP_PREDEPLOY=1 skips everything (builds without a database, e.g. CI).
 */
import { execFileSync } from "node:child_process";
import { appEnv } from "@/lib/env";

const env = process.env;
// Fail-closed environment detection (ADR-023): a production build without VERCEL_ENV is production.
const isProductionBuild = appEnv() === "production";

function run(script: string, extra: Record<string, string>): void {
  const child = { ...env, ...extra };
  delete child.SEED_RESET;
  try {
    execFileSync("npx", ["tsx", script], { stdio: "inherit", env: child });
  } catch {
    // The child already printed its own error; fail the build without a second stack trace.
    console.error(`[predeploy] ${script} failed — the deployment is stopped before next build`);
    process.exit(1);
  }
}

if (env.SKIP_PREDEPLOY === "1") {
  console.log("[predeploy] skipped (SKIP_PREDEPLOY=1)");
} else {
  const migrationUrl = env.DATABASE_URL_UNPOOLED || env.POSTGRES_URL_NON_POOLING || env.DATABASE_URL;
  if (!migrationUrl) {
    console.log("[predeploy] no DATABASE_URL; skipping migrations and seed");
  } else {
    run("scripts/migrate.ts", { DATABASE_URL: migrationUrl });
    if (env.SEED_ON_BUILD === "true" && !isProductionBuild) {
      run("scripts/seed.ts", { DATABASE_URL: migrationUrl });
    } else {
      console.log(`[predeploy] seed skipped (SEED_ON_BUILD=${env.SEED_ON_BUILD ?? ""}, env=${appEnv()})`);
    }
  }
}
