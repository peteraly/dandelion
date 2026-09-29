import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.E2E_PORT ?? 3100);
const baseURL = process.env.E2E_BASE_URL ?? `http://localhost:${PORT}`;
const TEST_DB = process.env.TEST_DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/dandelion_e2e";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 90_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : [["list"]],
  globalSetup: "./e2e/global-setup.ts",
  use: {
    baseURL,
    trace: "retain-on-failure",
    ...devices["Pixel 5"],
  },
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        // Reset + seed the e2e database, then start the dev server (webServer runs before globalSetup).
        command: `SEED_RESET=1 npx tsx scripts/seed.ts && npx next dev -p ${PORT}`,
        url: `${baseURL}/api/health`,
        reuseExistingServer: !process.env.CI,
        timeout: 180_000,
        env: {
          DATABASE_URL: TEST_DB,
          VERCEL_ENV: "",
          SIMULATOR_ENABLED: "true",
          E2E: "true",
          APP_ORIGIN: baseURL,
          CRON_SECRET: "e2e-cron-secret",
          NEXT_TELEMETRY_DISABLED: "1",
        },
      },
});
