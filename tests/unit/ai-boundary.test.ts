/**
 * Invariant §3.13: AI has no write path. The ESLint rule enforces it at lint
 * time; this test re-checks the source so a misconfigured lint cannot hide it.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : p.endsWith(".ts") || p.endsWith(".tsx") ? [p] : [];
  });
}

const FORBIDDEN = [/from\s+["']@\/lib\/db/, /from\s+["']drizzle-orm/, /from\s+["']pg["']/, /from\s+["']@neondatabase/, /from\s+["']@\/lib\/services\//, /from\s+["']@\/lib\/payments\//, /from\s+["']@\/lib\/auth\//];

describe("AI boundary", () => {
  it("lib/ai/** never imports the database, services, payments or auth", () => {
    const files = walk(join(process.cwd(), "lib/ai"));
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      for (const re of FORBIDDEN) expect(src, `${f} matches ${re}`).not.toMatch(re);
    }
  });

  it("the ESLint config carries the boundary rule", () => {
    const cfg = readFileSync(join(process.cwd(), "eslint.config.mjs"), "utf8");
    expect(cfg).toMatch(/lib\/ai\/\*\*/);
    expect(cfg).toMatch(/no-restricted-imports/);
  });
});
