import { getTranslations } from "next-intl/server";
import { Badge, Card, Field, PrimaryButton } from "@/components/ui";
import { Notice } from "@/components/notice";
import { requireAdmin } from "@/lib/auth/current";
import { openDataRequests } from "@/lib/services/admin";
import { flags, type SearchParams } from "@/lib/actions";
import { dataRequestCreateAction, dataRequestHandleAction } from "../actions";

export default async function DataRequestsPage({ searchParams }: { searchParams: SearchParams }) {
  const { actor } = await requireAdmin();
  const t = await getTranslations("admin.data");
  const { error, ok } = await flags(searchParams);
  const rows = await openDataRequests(actor);
  return (
    <>
      <h1 className="text-2xl font-bold">{t("title")}</h1>
      <Notice error={error} ok={ok} />
      <Card>
        <form action={dataRequestCreateAction} className="grid gap-2 md:grid-cols-4">
          <Field label="Kind" htmlFor="kind">
            <select id="kind" name="kind" className="field">
              <option value="CORRECTION">CORRECTION</option>
              <option value="DELETION">DELETION</option>
            </select>
          </Field>
          <Field label="Subject" htmlFor="subjectType">
            <select id="subjectType" name="subjectType" className="field">
              <option value="CUSTOMER">CUSTOMER</option>
              <option value="USER">USER</option>
            </select>
          </Field>
          <Field label="Subject id" htmlFor="subjectId">
            <input id="subjectId" name="subjectId" className="field" required />
          </Field>
          <Field label="Details" htmlFor="details">
            <input id="details" name="details" className="field" required minLength={3} />
          </Field>
          <div className="md:col-span-4">
            <PrimaryButton>{(await getTranslations("common"))("submit")}</PrimaryButton>
          </div>
        </form>
      </Card>
      {rows.map((r) => (
        <Card key={r.id}>
          <div className="flex items-center justify-between">
            <span>
              <Badge>{r.kind}</Badge> {r.subjectType} <span className="font-mono text-xs">{r.subjectId}</span>
            </span>
            <Badge tone={r.status === "OPEN" ? "amber" : "neutral"}>{t(r.status.toLowerCase() as "open" | "done" | "declined")}</Badge>
          </div>
          <p className="mt-1 whitespace-pre-wrap text-sm">{r.details}</p>
          {r.status === "OPEN" ? (
            <form action={dataRequestHandleAction} className="mt-2 flex gap-2">
              <input type="hidden" name="requestId" value={r.id} />
              <input name="note" className="field" placeholder="Note" required />
              <button type="submit" name="outcome" value="DONE" className="btn btn-primary w-32">
                {t("done")}
              </button>
              <button type="submit" name="outcome" value="DECLINED" className="btn btn-secondary w-32">
                {t("declined")}
              </button>
            </form>
          ) : null}
        </Card>
      ))}
    </>
  );
}
