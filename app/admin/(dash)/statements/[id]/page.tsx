import { getLocale, getTranslations } from "next-intl/server";
import { Card } from "@/components/ui";
import { requireAdmin } from "@/lib/auth/current";
import { diffForImport } from "@/lib/services/statements";
import { formatTzs } from "@/lib/money";

export default async function StatementDiffPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { actor } = await requireAdmin();
  const t = await getTranslations("admin.recon");
  const locale = (await getLocale()) as "sw" | "en";
  const diff = await diffForImport(actor, id);
  return (
    <>
      <h1 className="text-2xl font-bold">{t("statementTitle")}</h1>
      <div className="grid gap-4 md:grid-cols-2">
        <Section
          title={t("missingInStatement")}
          rows={diff.missingInStatement.map((r) => (
            <li key={r.providerTxRef} className="py-2" data-testid="missing-in-statement">
              {r.providerTxRef} · {r.orderRef} · {formatTzs(r.amountTzs, locale)}
            </li>
          ))}
        />
        <Section
          title={t("missingInApp")}
          rows={diff.missingInApp.map((r) => (
            <li key={r.providerTxRef} className="py-2" data-testid="missing-in-app">
              {r.providerTxRef} · {formatTzs(r.amountTzs, locale)} · {r.payeeAccount ?? ""}
            </li>
          ))}
        />
        <Section
          title={t("amountDiffers")}
          rows={diff.amountDiffers.map((r) => (
            <li key={r.providerTxRef} className="py-2" data-testid="amount-differs">
              {r.providerTxRef} · {r.orderRef} · statement {formatTzs(r.statementTzs, locale)} vs app {formatTzs(r.appTzs, locale)}
            </li>
          ))}
        />
        <Section
          title={t("matched")}
          rows={diff.matched.map((r) => (
            <li key={r.providerTxRef} className="py-2" data-testid="matched">
              {r.providerTxRef} · {r.orderRef} · {formatTzs(r.amountTzs, locale)}
            </li>
          ))}
        />
      </div>
    </>
  );
}

function Section({ title, rows }: { title: string; rows: React.ReactNode[] }) {
  return (
    <Card>
      <h2 className="mb-2 font-semibold">
        {title} <span className="text-stone-500">({rows.length})</span>
      </h2>
      <ul className="divide-y divide-stone-100 text-sm">{rows.length ? rows : <li className="py-2 text-stone-500">—</li>}</ul>
    </Card>
  );
}
