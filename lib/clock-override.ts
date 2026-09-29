/**
 * Clock override for seeds and tests ONLY (build prompt B §2.2).
 *
 * Importable from `scripts/**` and `tests/**` alone — eslint.config.mjs
 * forbids it everywhere else and tests/unit/clock-boundary.test.ts re-checks
 * the source tree. On top of that boundary, every call refuses when the
 * environment is production or when it runs inside the Next.js server
 * (NEXT_RUNTIME is set), so even a mistaken import cannot move the clock
 * where it matters.
 */
import { appEnv } from "./env";

const OVERRIDE_KEY = Symbol.for("dandelion.clock.override");
type WithOverride = typeof globalThis & { [OVERRIDE_KEY]?: () => Date };

function refuseIfUnsafe(): void {
  const reason = appEnv() === "production" ? "production environment" : process.env.NEXT_RUNTIME ? "inside the Next.js server" : null;
  if (!reason) return;
  console.error(`[clock] override refused: ${reason}`);
  throw new Error(`Clock override is not available: ${reason}`);
}

/** Pin the clock to a fixed instant or a function. `null` restores real time. */
export function setClock(source: Date | (() => Date) | null): void {
  refuseIfUnsafe();
  const g = globalThis as WithOverride;
  if (source === null) delete g[OVERRIDE_KEY];
  else if (source instanceof Date) {
    const fixed = new Date(source.getTime());
    g[OVERRIDE_KEY] = () => new Date(fixed.getTime());
  } else g[OVERRIDE_KEY] = source;
}

export function isClockOverridden(): boolean {
  return (globalThis as WithOverride)[OVERRIDE_KEY] !== undefined;
}

/** Run `fn` with the clock pinned, restoring the previous state afterwards. */
export async function withClock<T>(source: Date | (() => Date), fn: () => Promise<T>): Promise<T> {
  refuseIfUnsafe();
  const g = globalThis as WithOverride;
  const previous = g[OVERRIDE_KEY];
  setClock(source);
  try {
    return await fn();
  } finally {
    if (previous) g[OVERRIDE_KEY] = previous;
    else delete g[OVERRIDE_KEY];
  }
}

/**
 * A simulated clock that starts at `start` and only moves when told to — what
 * the demo generator uses to lay down weeks of history in order.
 */
export class SimulatedClock {
  private current: number;
  constructor(start: Date) {
    this.current = start.getTime();
  }
  now(): Date {
    return new Date(this.current);
  }
  advance(ms: number): Date {
    if (ms < 0) throw new Error("simulated time only moves forward");
    this.current += ms;
    return this.now();
  }
  set(to: Date): Date {
    if (to.getTime() < this.current) throw new Error("simulated time only moves forward");
    this.current = to.getTime();
    return this.now();
  }
  /** Move to `to` if it is later than now; otherwise stay (a schedule slot that has already passed). */
  advanceTo(to: Date): Date {
    if (to.getTime() > this.current) this.current = to.getTime();
    return this.now();
  }
  install(): void {
    setClock(() => this.now());
  }
}
