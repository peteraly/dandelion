/**
 * The clock a demo World runs on. The seed script installs a SimulatedClock
 * (lib/clock-override.ts, scripts and tests only) so history is backdated;
 * inside the deployed app the "simulate an hour" controls run on the real
 * clock, where advancing is a no-op — steps simply follow one another now.
 */
import { now } from "@/lib/clock";

export interface DemoClock {
  now(): Date;
  /** Move forward by `ms` (no-op on the real clock). */
  advance(ms: number): Date;
  /** Move to `to` if later than now (no-op on the real clock). */
  advanceTo(to: Date): Date;
}

export class RealClock implements DemoClock {
  now(): Date {
    return now();
  }
  advance(): Date {
    return now();
  }
  advanceTo(): Date {
    return now();
  }
}
