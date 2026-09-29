/**
 * The one clock the application reads (build prompt B §2.2).
 *
 * Services, payments, auth and the ledger call `now()` instead of `new Date()`
 * so that a seed script can generate backdated history through the same code
 * paths the UI uses. The override lives behind a global symbol that only
 * `lib/clock-override.ts` writes; that module may be imported by `scripts/`
 * and tests only (ESLint + tests/unit/clock-boundary.test.ts), so the app
 * bundle contains no code path that can move the clock.
 */

const OVERRIDE_KEY = Symbol.for("dandelion.clock.override");

type WithOverride = typeof globalThis & { [OVERRIDE_KEY]?: () => Date };

/** Current instant (UTC). Real time unless a seed/test override is active. */
export function now(): Date {
  const override = (globalThis as WithOverride)[OVERRIDE_KEY];
  return override ? override() : new Date();
}

/** `now()` as epoch milliseconds — the `Date.now()` replacement. */
export function nowMs(): number {
  return now().getTime();
}
