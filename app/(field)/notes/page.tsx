import { getTranslations } from "next-intl/server";
import { Card } from "@/components/ui";
import { requireField } from "@/lib/auth/current";
import { myNotes } from "@/lib/services/notes";
import { OfflineNotes } from "@/components/offline-notes";

export const dynamic = "force-dynamic";

export default async function NotesPage() {
  const { actor } = await requireField();
  const t = await getTranslations("field.notes");
  const synced = await myNotes(actor);
  return (
    <>
      <h1 className="text-2xl font-bold">{t("title")}</h1>
      <p className="rounded-xl bg-brand-50 p-3 text-sm font-semibold">{t("rule")}</p>
      <OfflineNotes
        labels={{
          body: t("body"),
          category: t("category"),
          categories: { GENERAL: t("GENERAL"), STOCK: t("STOCK"), CUSTOMER_VISIT: t("CUSTOMER_VISIT"), PROBLEM: t("PROBLEM") },
          save: (await getTranslations("common"))("save"),
          saved: t("saved"),
          pending: t("pending"),
          synced: t("synced"),
        }}
      />
      <Card>
        <h2 className="mb-2 font-semibold">{t("synced")}</h2>
        <ul className="divide-y divide-stone-100">
          {synced.map((n) => (
            <li key={n.id} className="py-2">
              <span className="text-xs uppercase text-stone-500">{t(n.category)}</span>
              <p>{n.body}</p>
            </li>
          ))}
          {synced.length === 0 ? <li className="py-2 text-stone-500">—</li> : null}
        </ul>
      </Card>
    </>
  );
}
