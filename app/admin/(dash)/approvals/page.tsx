import { getTranslations } from "next-intl/server";
import { Badge, Card, IdemKey } from "@/components/ui";
import { Notice } from "@/components/notice";
import { requireAdmin } from "@/lib/auth/current";
import { pendingApprovals } from "@/lib/services/approvals";
import { flags, type SearchParams } from "@/lib/actions";
import { decideApprovalAction } from "../actions";

export default async function ApprovalsPage({ searchParams }: { searchParams: SearchParams }) {
  const { actor } = await requireAdmin();
  const t = await getTranslations("admin.approvals");
  const { error, ok } = await flags(searchParams);
  const reqs = await pendingApprovals(actor);
  return (
    <>
      <h1 className="text-2xl font-bold">{t("title")}</h1>
      <Notice error={error} ok={ok} />
      {reqs.length === 0 ? <p className="text-stone-500">{t("none")}</p> : null}
      {reqs.map((r) => (
        <Card key={r.id} className={r.highlighted ? "border-2 border-amber-400" : ""} data-testid="approval">
          <div className="flex items-start justify-between gap-2">
            <div>
              {r.highlighted ? <Badge tone="amber">{t("donorHighlight")}</Badge> : <Badge>{r.type.replace(/_/g, " ")}</Badge>}
              <p className="mt-1 font-semibold">{r.summary}</p>
              <p className="text-sm text-stone-600">
                {t("threshold", { have: 1 + r.decisions.filter((d) => d.decision === "APPROVE").length, need: r.threshold })}
              </p>
            </div>
            <span className="text-xs text-stone-500">{r.createdAt.toISOString().slice(0, 16).replace("T", " ")}</span>
          </div>
          <pre className="mt-2 overflow-x-auto rounded-lg bg-stone-50 p-2 text-xs">{JSON.stringify(r.payload, null, 1)}</pre>
          {r.canDecide ? (
            <form action={decideApprovalAction} className="mt-3 flex flex-col gap-2 md:flex-row">
              <IdemKey />
              <input type="hidden" name="requestId" value={r.id} />
              <input name="comment" className="field md:flex-1" placeholder="Comment (optional)" maxLength={500} />
              <button type="submit" name="decision" value="APPROVE" className="btn btn-primary md:w-40">
                {t("approve")}
              </button>
              <button type="submit" name="decision" value="REJECT" className="btn btn-danger md:w-40">
                {t("reject")}
              </button>
            </form>
          ) : (
            <p className="mt-3 rounded-lg bg-stone-100 p-2 text-sm" data-testid="own-request">
              {t("ownRequest")}
            </p>
          )}
        </Card>
      ))}
    </>
  );
}
