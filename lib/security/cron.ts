/**
 * Cron endpoints are invoked by Vercel Cron with `Authorization: Bearer
 * $CRON_SECRET` (verify against current Vercel docs). Locally and in tests
 * the dev default applies.
 */
import { secret } from "@/lib/env";
import { safeEqual } from "@/lib/crypto/random";
import { getDb } from "@/lib/db/client";
import * as s from "@/lib/db/schema";

export function cronAuthorized(request: Request): boolean {
  const auth = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret("CRON_SECRET", "dev-cron-secret")}`;
  return safeEqual(auth, expected);
}

export async function heartbeat(name: string, status: string, details: Record<string, unknown> = {}): Promise<void> {
  await getDb()
    .insert(s.jobHeartbeats)
    .values({ name, lastRunAt: new Date(), lastStatus: status, details })
    .onConflictDoUpdate({ target: s.jobHeartbeats.name, set: { lastRunAt: new Date(), lastStatus: status, details } });
}
