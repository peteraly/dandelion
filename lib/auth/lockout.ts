/**
 * PIN lockout policy (handbook §7): 4-digit PIN, 30-minute lockout after 3
 * failures, and after 5 failures the account is locked until an admin
 * re-enrolls the user. Pure function; see docs/DECISIONS.md for the reading
 * of "maximum 5 attempts".
 */

export const TEMP_LOCK_AFTER = 3;
export const HARD_LOCK_AFTER = 5;
export const TEMP_LOCK_MINUTES = 30;

export type LoginGate = { allowed: true } | { allowed: false; reason: "temporarily_locked"; until: Date } | { allowed: false; reason: "locked" };

export function loginGate(status: string, lockedUntil: Date | null, now: Date): LoginGate {
  if (status === "LOCKED") return { allowed: false, reason: "locked" };
  if (lockedUntil && lockedUntil > now) return { allowed: false, reason: "temporarily_locked", until: lockedUntil };
  return { allowed: true };
}

export interface FailureOutcome {
  failedCount: number;
  lockedUntil: Date | null;
  hardLocked: boolean;
}

export function afterFailedPin(previousFailures: number, now: Date): FailureOutcome {
  const failedCount = previousFailures + 1;
  if (failedCount >= HARD_LOCK_AFTER) return { failedCount, lockedUntil: null, hardLocked: true };
  if (failedCount === TEMP_LOCK_AFTER) {
    return { failedCount, lockedUntil: new Date(now.getTime() + TEMP_LOCK_MINUTES * 60_000), hardLocked: false };
  }
  return { failedCount, lockedUntil: null, hardLocked: false };
}
