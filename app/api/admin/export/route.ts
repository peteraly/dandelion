import { currentAdminSession, toActor } from "@/lib/auth/current";
import { exportCsv } from "@/lib/services/admin";
import { errorCode } from "@/lib/actions";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const session = await currentAdminSession();
  if (!session?.mfaVerified) return new Response(null, { status: 401 });
  if (session.via === "OPEN_DEMO") return Response.json({ error: "open_demo_not_allowed" }, { status: 403 });
  const url = new URL(request.url);
  try {
    const { filename, content } = await exportCsv(toActor(session), url.searchParams.get("dataset") ?? "", url.searchParams.get("approval") ?? undefined);
    return new Response(content, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${filename}"`, "cache-control": "no-store" } });
  } catch (e) {
    return Response.json({ error: errorCode(e) }, { status: 400 });
  }
}
