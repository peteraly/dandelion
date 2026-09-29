/**
 * Prompt B §2.2/§2.8 on a real database: insert-time defaults follow the
 * application clock; rate-limit windows follow it too; the content guard
 * refuses a database that looks real.
 */
import { eq, sql } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { getDb } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import { setClock, withClock } from "@/lib/clock-override";
import { logSecurityEvent } from "@/lib/services/core";
import { hitRateLimit } from "@/lib/security/rate-limit";
import { assertSafeTargetDatabase } from "../../scripts/seed";

afterEach(() => setClock(null));

describe("clock-driven defaults and guards", () => {
  it("rows inserted under a simulated clock carry the simulated created_at", async () => {
    const at = new Date("2026-02-14T07:30:00Z");
    await withClock(at, async () => {
      await logSecurityEvent(getDb(), "TEST_CLOCK_EVENT", "INFO", { details: { probe: true } });
    });
    const row = await getDb().query.securityEventLog.findFirst({ where: eq(s.securityEventLog.type, "TEST_CLOCK_EVENT") });
    expect(row?.createdAt.toISOString()).toBe(at.toISOString());
  });

  it("rate-limit windows move with the clock", async () => {
    const key = `clock-probe-${Date.now()}`;
    const t0 = new Date("2026-02-14T08:00:00Z");
    await withClock(t0, async () => {
      expect((await hitRateLimit(key, 2, 60)).count).toBe(1);
      expect((await hitRateLimit(key, 2, 60)).count).toBe(2);
      expect((await hitRateLimit(key, 2, 60)).allowed).toBe(false);
    });
    await withClock(new Date(t0.getTime() + 61_000), async () => {
      const r = await hitRateLimit(key, 2, 60);
      expect(r.count).toBe(1);
      expect(r.allowed).toBe(true);
    });
  });

  it("the content guard accepts a seeded database and refuses an unmarked one with a real-looking person", async () => {
    await expect(assertSafeTargetDatabase()).resolves.toBeUndefined();
    const db = getDb();
    const [u] = await db
      .insert(s.users)
      .values({ role: "FIELD_CHAMPION", status: "INVITED", displayName: "Real Person", phoneEnc: "x", phoneIndex: `probe-${Date.now()}`, preferredLocale: "sw" })
      .returning({ id: s.users.id });
    const marker = await db.query.settings.findFirst({ where: eq(s.settings.key, "seedProfile") });
    try {
      // Still accepted: the seed marker proves this database was populated by a seed run.
      await expect(assertSafeTargetDatabase()).resolves.toBeUndefined();
      // Without the marker, one person without "(TEST)" is enough to refuse.
      await db.execute(sql`delete from settings where key = 'seedProfile'`);
      await expect(assertSafeTargetDatabase()).rejects.toThrow(/without "\(TEST\)"/);
    } finally {
      if (marker) await db.insert(s.settings).values({ key: "seedProfile", value: marker.value, updatedBy: marker.updatedBy }).onConflictDoNothing();
      await db.execute(sql`delete from users where id = ${u!.id}`);
    }
    await expect(assertSafeTargetDatabase()).resolves.toBeUndefined();
  });
});
