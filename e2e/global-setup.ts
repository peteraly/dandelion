import { execSync } from "node:child_process";

/**
 * With a local webServer the database is reset and seeded by the server
 * command (Playwright starts the server before this hook). Against a remote
 * target (E2E_BASE_URL, e.g. a Vercel preview) the preview's own Neon branch
 * is seeded here through its simulator API when E2E_SEED_REMOTE=1.
 */
export default async function globalSetup(): Promise<void> {
  if (!process.env.E2E_BASE_URL) return;
  if (process.env.E2E_SEED_REMOTE === "1" && process.env.DATABASE_URL) {
    execSync("npx tsx scripts/seed.ts", { stdio: "inherit", env: { ...process.env, VERCEL_ENV: "", SEED_RESET: "1", APP_ORIGIN: process.env.E2E_BASE_URL } });
  }
}
