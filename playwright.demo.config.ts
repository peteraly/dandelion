import { defineConfig, devices } from "@playwright/test";

/**
 * Prompt D §5.9 — `npm run demo:screens`: seed the demo profile into a
 * throwaway database, start a server on it, walk the seven beats of the
 * script and save one PNG per beat under docs/demo-screens/ (fictional data;
 * the founders decide whether to commit them — §7.5).
 */
const PORT = Number(process.env.DEMO_PORT ?? 3300);
const baseURL = process.env.DEMO_BASE_URL ?? `http://localhost:${PORT}`;
const DEMO_DB = process.env.DEMO_DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/dandelion_demo";

export default defineConfig({
  testDir: "./e2e-demo",
  workers: 1,
  timeout: 180_000,
  expect: { timeout: 15_000 },
  reporter: [["list"]],
  use: { baseURL, ...devices["Desktop Chrome"], viewport: { width: 1440, height: 1000 } },
  webServer: process.env.DEMO_BASE_URL
    ? undefined
    : {
        command: `npx tsx scripts/migrate.ts && SEED_RESET=1 SEED_PROFILE=demo DEMO_SCALE=full npx tsx scripts/seed.ts && npx next dev -p ${PORT}`,
        url: `${baseURL}/api/health`,
        reuseExistingServer: false,
        timeout: 300_000,
        env: { DATABASE_URL: DEMO_DB, VERCEL_ENV: "", SIMULATOR_ENABLED: "true", E2E: "true", APP_ORIGIN: baseURL, CRON_SECRET: "demo-cron-secret", NEXT_TELEMETRY_DISABLED: "1", DEMO_SCREENS: "1", DEMO_OPEN_ACCESS: "true" },
      },
});
