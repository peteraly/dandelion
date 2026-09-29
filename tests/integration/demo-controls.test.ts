/**
 * Prompt B §2.5: the "simulate time" and "reset" controls refuse everything
 * but a demo database with the simulator on, and never wipe without the typed
 * word. Runs on the minimal seed, which must stay untouched.
 */
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { getDb } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import { demoStatus, simulateTick } from "@/lib/demo/tick";
import { resetPreconditions, resetToDemoDataset } from "@/lib/demo/reset";

async function adminId(): Promise<string> {
  const a = await getDb().query.users.findFirst({ where: eq(s.users.role, "SUPER_ADMIN") });
  return a!.id;
}

const simulatorWas = process.env.SIMULATOR_ENABLED;
afterEach(() => {
  process.env.SIMULATOR_ENABLED = simulatorWas;
});

describe("demo controls on a minimal database", () => {
  it("refuses to simulate time unless the database carries the demo profile", async () => {
    expect((await demoStatus()).profile).toBe("minimal");
    await expect(simulateTick("hour", await adminId())).rejects.toMatchObject({ code: "demo_profile_required" });
  });

  it("refuses when the simulator is off, before looking at the database", async () => {
    process.env.SIMULATOR_ENABLED = "";
    await expect(simulateTick("day", await adminId())).rejects.toMatchObject({ code: "simulator_disabled" });
  });

  it("never wipes without the typed word", async () => {
    expect(resetPreconditions().ok).toBe(true); // development: no deploy hook needed
    const id = await adminId();
    await expect(resetToDemoDataset(id, "")).rejects.toMatchObject({ code: "reset_confirm_required" });
    await expect(resetToDemoDataset(id, "DEMO please")).rejects.toMatchObject({ code: "reset_confirm_required" });
    expect(await getDb().query.users.findFirst()).toBeTruthy();
  });

  it("is not available at all with the simulator off", async () => {
    process.env.SIMULATOR_ENABLED = "";
    const pre = resetPreconditions();
    expect(pre.ok).toBe(false);
    await expect(resetToDemoDataset(await adminId(), "demo")).rejects.toMatchObject({ code: "reset_not_allowed" });
    expect(await getDb().query.users.findFirst()).toBeTruthy();
  });
});
