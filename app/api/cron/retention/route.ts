import { retentionPurge } from "@/lib/services/admin";
import { cronAuthorized, heartbeat } from "@/lib/security/cron";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!cronAuthorized(request)) return new Response(null, { status: 401 });
  const result = await retentionPurge();
  await heartbeat("retention", "ok", result);
  return Response.json(result);
}
