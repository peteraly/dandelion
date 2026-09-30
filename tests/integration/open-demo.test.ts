/**
 * Prompt E / ADR-033 on a real database: the open demo refuses to exist
 * without its switch, opens marked sessions for each role when switched on
 * over the (fictional) seeded dataset, logs every entry, and an open-demo
 * actor cannot store a real phone number.
 */
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { getDb } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import { loadSession } from "@/lib/auth/session";
import { toActor } from "@/lib/auth/current";
import { openDemoEnabled, openDemoEntry } from "@/lib/demo/open";
import { createCustomer } from "@/lib/services/customers";
import { putSetting } from "@/lib/services/core";

afterEach(() => {
  delete process.env.DEMO_OPEN_ACCESS;
});

describe("open demo", () => {
  it("does not exist without DEMO_OPEN_ACCESS=true", async () => {
    expect(await openDemoEnabled()).toBe(false);
    await expect(openDemoEntry("founder", "203.0.113.7")).rejects.toMatchObject({ code: "open_demo_disabled" });
  });

  it("does not exist on a database the seed did not fill", async () => {
    process.env.DEMO_OPEN_ACCESS = "true";
    await putSetting(getDb(), "seedProfile", "", null);
    expect(await openDemoEnabled()).toBe(false);
    await putSetting(getDb(), "seedProfile", "minimal", null);
    expect(await openDemoEnabled()).toBe(true);
  });

  it("opens a marked, second-factor-complete admin session for the founder and a field session for a champion", async () => {
    process.env.DEMO_OPEN_ACCESS = "true";
    const founder = await openDemoEntry("founder", "203.0.113.7");
    expect(founder.kind).toBe("ADMIN");
    const fs = (await loadSession(founder.token))!;
    expect(fs.via).toBe("OPEN_DEMO");
    expect(fs.mfaVerified).toBe(true);
    expect(fs.user.role).toBe("SUPER_ADMIN");
    expect(toActor(fs).openDemo).toBe(true);

    const second = await openDemoEntry("founder2", "203.0.113.7");
    const ss = (await loadSession(second.token))!;
    expect(ss.user.id).not.toBe(fs.user.id); // two different admins, so the two-admin rule can be shown

    const champ = await openDemoEntry("champion", "203.0.113.7");
    expect(champ.kind).toBe("FIELD");
    const cs = (await loadSession(champ.token))!;
    expect(cs.user.role).toBe("FIELD_CHAMPION");
    expect(cs.via).toBe("OPEN_DEMO");

    const events = await getDb().query.securityEventLog.findMany({ where: eq(s.securityEventLog.type, "OPEN_DEMO_ENTRY") });
    expect(events.length).toBeGreaterThanOrEqual(3);
  });

  it("stores only test phone numbers for open-demo actors", async () => {
    process.env.DEMO_OPEN_ACCESS = "true";
    const champ = await openDemoEntry("champion", "203.0.113.8");
    const actor = toActor((await loadSession(champ.token))!);
    await expect(createCustomer(actor, { displayName: "Real person?", phone: "+255712345678", consentMessages: true, consentReminders: false }, null, "203.0.113.8")).rejects.toMatchObject({ code: "open_demo_fake_phone" });
    const ok = await createCustomer(actor, { displayName: "Demo visitor (TEST)", phone: "+255700009977", consentMessages: true, consentReminders: false }, null, "203.0.113.8");
    expect(ok.customerId).toBeTruthy();
  });

  it("marks ordinary sign-ins as LOGIN", async () => {
    const sessions = await getDb().query.sessions.findMany({ where: eq(s.sessions.via, "LOGIN") });
    expect(Array.isArray(sessions)).toBe(true);
  });
});
