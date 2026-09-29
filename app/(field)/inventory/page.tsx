import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Badge, Card } from "@/components/ui";
import { requireField } from "@/lib/auth/current";
import { can } from "@/lib/policy";
import { hubInventory } from "@/lib/services/home";
import { isLocked } from "@/lib/domain/custody";

export const dynamic = "force-dynamic";

export default async function InventoryPage() {
  const { actor } = await requireField();
  const t = await getTranslations("field.inventory");
  const tc = await getTranslations("common");
  const rows = actor.hubId && can(actor, "hub.inventory.view") ? await hubInventory(actor.hubId) : [];
  return (
    <>
      <h1 className="text-2xl font-bold">{t("title")}</h1>
      <Card>
        <ul className="divide-y divide-stone-100">
          {rows.map(({ batch, product }) => (
            <li key={batch.id} className="flex items-center justify-between py-3">
              <span>
                <span className="font-mono text-sm">{batch.code}</span>
                <span className="block text-sm text-stone-600">{product}</span>
              </span>
              <span className="flex flex-col items-end gap-1">
                <span className="font-semibold">{tc("units", { count: batch.quantity })}</span>
                {isLocked(batch.custodyState) ? <Badge tone="red">{t("locked")}</Badge> : <Badge tone="green">{batch.custodyState.replace(/_/g, " ")}</Badge>}
              </span>
            </li>
          ))}
          {rows.length === 0 ? <li className="py-3 text-stone-500">{t("empty")}</li> : null}
        </ul>
      </Card>
      <Link href="/problem?type=DAMAGED_OR_WET" className="btn btn-danger">
        {(await getTranslations("field.inspection"))("reportDamage")}
      </Link>
    </>
  );
}
