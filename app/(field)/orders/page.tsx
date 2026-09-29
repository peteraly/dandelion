import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Card, Badge } from "@/components/ui";
import { requireField } from "@/lib/auth/current";
import { homeFor } from "@/lib/services/home";

export const dynamic = "force-dynamic";

export default async function OrdersPage() {
  const { actor } = await requireField();
  const t = await getTranslations();
  const view = await homeFor(actor);
  return (
    <Card>
      <h1 className="mb-3 text-xl font-bold">{t("admin.nav.orders")}</h1>
      <ul className="divide-y divide-stone-100">
        {view.snapshots.map((o) => (
          <li key={o.id}>
            <Link href={`/orders/${o.id}`} className="flex items-center justify-between py-3">
              <span>
                <span className="font-mono text-sm">{o.ref}</span>
                <span className="block text-sm text-stone-600">{t(`orderKinds.${o.kind}`)}</span>
              </span>
              <Badge tone={o.state === "COMPLETED" ? "green" : "neutral"}>{o.state.replace(/_/g, " ")}</Badge>
            </Link>
          </li>
        ))}
        {view.snapshots.length === 0 ? <li className="py-3 text-stone-500">—</li> : null}
      </ul>
    </Card>
  );
}
