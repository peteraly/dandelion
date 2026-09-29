/**
 * Build prompt B §2.2: one clock, and a set path that does not exist in the
 * app. ESLint enforces the import boundary; this test re-checks the source so
 * a misconfigured lint or an eslint-disable comment cannot hide it, and it
 * exercises the override's own refusals.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { now, nowMs } from "@/lib/clock";
import { SimulatedClock, isClockOverridden, setClock, withClock } from "@/lib/clock-override";

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    if (f === "node_modules" || f === ".next") return [];
    return statSync(p).isDirectory() ? walk(p) : p.endsWith(".ts") || p.endsWith(".tsx") ? [p] : [];
  });
}

const root = process.cwd();
const rel = (p: string) => relative(root, p).replaceAll("\\", "/");

const saved = { ...process.env };
afterEach(() => {
  process.env = { ...saved };
  setClock(null);
});

describe("clock boundary", () => {
  it("services, payments, auth, ledger and time helpers read the clock only through lib/clock", () => {
    const files = ["lib/services", "lib/payments", "lib/auth", "lib/ledger", "lib/security"].flatMap((d) => walk(join(root, d))).concat(join(root, "lib/util/time.ts"), join(root, "scripts/seed.ts"));
    expect(files.length).toBeGreaterThan(10);
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      expect(src, `${rel(f)} uses new Date()`).not.toMatch(/new Date\(\)/);
      expect(src, `${rel(f)} uses Date.now()`).not.toMatch(/Date\.now\(\)/);
    }
  });

  it("nothing outside scripts/ and tests/ imports the override, and only the two clock files know the symbol", () => {
    const offenders: string[] = [];
    const symbolUsers: string[] = [];
    for (const d of ["app", "lib", "components", "i18n"]) {
      for (const f of walk(join(root, d))) {
        const src = readFileSync(f, "utf8");
        // Imports only: the clock module's own doc comment may name the override file.
        if (/from\s+["'][^"']*clock-override["']/.test(src) || /import\(\s*["'][^"']*clock-override["']/.test(src)) offenders.push(rel(f));
        if (/dandelion\.clock\.override/.test(src)) symbolUsers.push(rel(f));
      }
    }
    for (const f of ["proxy.ts", "next.config.ts"]) {
      const src = readFileSync(join(root, f), "utf8");
      if (/from\s+["'][^"']*clock-override["']/.test(src)) offenders.push(f);
    }
    expect(offenders).toEqual([]);
    expect(symbolUsers.sort()).toEqual(["lib/clock-override.ts", "lib/clock.ts"]);
  });

  it("the ESLint config forbids the override outside scripts and tests", () => {
    const cfg = readFileSync(join(root, "eslint.config.mjs"), "utf8");
    expect(cfg).toMatch(/clock-override/);
  });

  it("the override works in tests and restores real time", async () => {
    const fixed = new Date("2026-03-01T09:00:00Z");
    expect(isClockOverridden()).toBe(false);
    await withClock(fixed, async () => {
      expect(now().toISOString()).toBe(fixed.toISOString());
      expect(nowMs()).toBe(fixed.getTime());
    });
    expect(isClockOverridden()).toBe(false);
    expect(Math.abs(nowMs() - Date.now())).toBeLessThan(1000);
  });

  it("a simulated clock only moves forward", () => {
    const c = new SimulatedClock(new Date("2026-03-01T00:00:00Z"));
    c.install();
    expect(now().toISOString()).toBe("2026-03-01T00:00:00.000Z");
    c.advance(3_600_000);
    expect(now().toISOString()).toBe("2026-03-01T01:00:00.000Z");
    expect(() => c.advance(-1)).toThrow();
    expect(() => c.set(new Date("2026-02-01T00:00:00Z"))).toThrow();
  });

  it("refuses in production and inside the Next.js server, even if imported", () => {
    process.env.VERCEL_ENV = "production";
    expect(() => setClock(new Date())).toThrow(/production/);
    expect(isClockOverridden()).toBe(false);
    process.env.VERCEL_ENV = "";
    process.env.NEXT_RUNTIME = "nodejs";
    expect(() => setClock(new Date())).toThrow(/Next\.js/);
    expect(isClockOverridden()).toBe(false);
  });
});
