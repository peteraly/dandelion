/**
 * Post-build check (build prompt B §2.2, review item C1): the compiled app
 * must not contain the clock override. Lint can be silenced with a comment;
 * this cannot. Runs after `next build` in the "build" script and in CI.
 *
 * Markers are string literals unique to lib/clock-override.ts, because
 * minification keeps strings and may rename identifiers.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const MARKERS = ["Clock override is not available", "[clock] override refused", "simulated time only moves forward"];
const ROOTS = [".next/server", ".next/static"];

function walk(dir: string): string[] {
  let out: string[] = [];
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) out = out.concat(walk(p));
    else if (/\.(js|mjs|cjs)$/.test(f)) out.push(p);
  }
  return out;
}

let files = 0;
const hits: string[] = [];
for (const root of ROOTS) {
  let list: string[] = [];
  try {
    list = walk(join(process.cwd(), root));
  } catch {
    continue;
  }
  for (const f of list) {
    files++;
    const src = readFileSync(f, "utf8");
    for (const m of MARKERS) if (src.includes(m)) hits.push(`${f}: "${m}"`);
  }
}
if (files === 0) {
  console.error("[check-bundle] no build output found under .next — run `next build` first");
  process.exit(1);
}
if (hits.length) {
  console.error("[check-bundle] the clock override leaked into the app bundle:\n  " + hits.join("\n  "));
  process.exit(1);
}
console.log(`[check-bundle] ok — ${files} bundle files, no clock override`);
