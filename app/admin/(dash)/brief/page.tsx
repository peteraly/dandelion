import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Card } from "@/components/ui";
import { requireAdmin } from "@/lib/auth/current";
import { buildBriefItems } from "@/lib/services/brief";
import { aiEnabled } from "@/lib/env";
import { aiExplainBrief } from "@/lib/services/ai-gateway";

export default async function BriefPage() {
  const { actor } = await requireAdmin();
  const t = await getTranslations("admin.brief");
  const items = await buildBriefItems(actor);
  // AI only orders/explains what the deterministic queries selected; any failure just means no AI text.
  const ai = aiEnabled() && items.length > 0 ? await aiExplainBrief(actor, items).then((r) => r.explanation).catch(() => null) : null;
  return (
    <>
      <h1 className="text-2xl font-bold">{t("title")}</h1>
      <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-950">{ai ? t("draft") : t("aiOff")}</p>
      {ai ? (
        <Card data-testid="ai-brief">
          <p className="whitespace-pre-wrap">{ai.summary}</p>
        </Card>
      ) : null}
      <Card>
        <ol className="divide-y divide-stone-100">
          {items.map((it, i) => (
            <li key={it.id} className="py-3" data-testid="brief-item">
              <div className="flex items-start justify-between gap-2">
                <span>
                  {i + 1}. <span className="font-semibold">{it.title}</span>
                  <span className="block text-sm text-stone-600">{it.detail}</span>
                  {ai?.explanations[it.id] ? <span className="block text-sm text-brand-800">{ai.explanations[it.id]}</span> : null}
                </span>
                <Link href={it.href} className="text-sm underline">
                  open
                </Link>
              </div>
              {it.triggers.length ? (
                <p className="mt-1 text-xs text-red-700">
                  {t("triggers")}: {it.triggers.join(", ")}
                </p>
              ) : null}
            </li>
          ))}
          {items.length === 0 ? <li className="py-3 text-stone-500">—</li> : null}
        </ol>
      </Card>
    </>
  );
}
