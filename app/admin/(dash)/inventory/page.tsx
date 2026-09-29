import { getTranslations } from "next-intl/server";
import { Badge, Card } from "@/components/ui";
import { requireAdmin } from "@/lib/auth/current";
import { inventoryByCustodian } from "@/lib/services/admin";
import { isLocked } from "@/lib/domain/custody";

export default async function AdminInventoryPage() {
  const { actor } = await requireAdmin();
  const t = await getTranslations();
  const rows = await inventoryByCustodian(actor);
  return (
    <>
      <h1 className="text-2xl font-bold">{t("admin.nav.inventory")}</h1>
      <Card>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-stone-500">
              <th className="py-2">Batch</th>
              <th>{t("common.product")}</th>
              <th>Custodian</th>
              <th>{t("common.quantity")}</th>
              <th>{t("common.status")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {rows.map(({ batch, product, custodian, role }) => (
              <tr key={batch.id}>
                <td className="py-2 font-mono">{batch.code}</td>
                <td>{product}</td>
                <td>
                  {custodian ?? "—"} {role ? <span className="text-xs text-stone-500">({t(`roles.${role}`)})</span> : null}
                </td>
                <td>{batch.quantity}</td>
                <td>
                  <Badge tone={isLocked(batch.custodyState) ? "red" : "green"}>{batch.custodyState.replace(/_/g, " ")}</Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </>
  );
}
