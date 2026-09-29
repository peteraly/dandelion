import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Card, Field, PrimaryButton } from "@/components/ui";
import { Notice } from "@/components/notice";
import { requireAdmin } from "@/lib/auth/current";
import { listImports } from "@/lib/services/statements";
import { flags, type SearchParams } from "@/lib/actions";
import { importStatementAction } from "../actions";

export default async function StatementsPage({ searchParams }: { searchParams: SearchParams }) {
  const { actor } = await requireAdmin();
  const t = await getTranslations("admin.recon");
  const { error } = await flags(searchParams);
  const imports = await listImports(actor);
  return (
    <>
      <h1 className="text-2xl font-bold">{t("statementTitle")}</h1>
      <p className="text-sm text-stone-600">{t("statementIntro")}</p>
      <Notice error={error} />
      <Card>
        <form action={importStatementAction} className="flex flex-col gap-3">
          <Field label="Provider" htmlFor="provider">
            <select id="provider" name="provider" className="field" defaultValue="mock">
              <option value="mock">mock</option>
              <option value="vodacom_mpesa">vodacom_mpesa</option>
              <option value="aggregator">aggregator</option>
            </select>
          </Field>
          <Field label="CSV" htmlFor="file">
            <input id="file" name="file" type="file" accept=".csv,text/csv" className="field" required />
          </Field>
          <PrimaryButton>{t("upload")}</PrimaryButton>
        </form>
      </Card>
      <Card>
        <ul className="divide-y divide-stone-100 text-sm">
          {imports.map((i) => (
            <li key={i.id} className="py-2">
              <Link href={`/admin/statements/${i.id}`} className="underline">
                {i.filename}
              </Link>{" "}
              · {i.provider} · {i.rowCount} rows · {i.coversFrom ?? "?"} → {i.coversTo ?? "?"}
            </li>
          ))}
        </ul>
      </Card>
    </>
  );
}
