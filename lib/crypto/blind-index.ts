/**
 * HMAC blind index so we can look up encrypted phone numbers without
 * decrypting every row. Rotation requires re-indexing (see README runbook).
 */
import { createHmac } from "node:crypto";
import { secret } from "@/lib/env";

const DEV_KEY = "dev-only-blind-index-key-not-secret";

export function phoneBlindIndex(e164: string): string {
  const key = secret("BLIND_INDEX_KEY", DEV_KEY);
  return createHmac("sha256", key).update(`phone:v1:${e164}`).digest("base64url");
}
