import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const root = fileURLToPath(new URL(".", import.meta.url));
const TEST_DB = process.env.TEST_DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/dandelion_test";

export default defineConfig({
  resolve: { alias: { "@": root } },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          include: ["tests/unit/**/*.test.ts", "lib/ai/evals/**/*.test.ts"],
          environment: "node",
        },
      },
      {
        extends: true,
        test: {
          name: "integration",
          include: ["tests/integration/**/*.test.ts"],
          environment: "node",
          fileParallelism: false,
          setupFiles: ["tests/integration/setup.ts"],
          env: { DATABASE_URL: TEST_DB },
          testTimeout: 30_000,
          hookTimeout: 60_000,
        },
      },
      {
        // Prompt B §2.6: runs the demo profile on its own database and checks coverage; slower than the rest.
        extends: true,
        test: {
          name: "demo",
          include: ["tests/demo/**/*.test.ts"],
          environment: "node",
          fileParallelism: false,
          env: { DATABASE_URL: process.env.DEMO_DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/dandelion_demo" },
          testTimeout: 120_000,
          hookTimeout: 600_000,
        },
      },
    ],
  },
});
