import { afterAll, beforeAll } from "vitest";
import { closeDb } from "@/lib/db/client";
import { resetDatabase, seed } from "@/scripts/seed";

process.env.VERCEL_ENV = "";
process.env.SIMULATOR_ENABLED = "true";
process.env.APP_ORIGIN = "http://localhost:3000";

beforeAll(async () => {
  await resetDatabase();
  await seed();
});

afterAll(async () => {
  await closeDb();
});
