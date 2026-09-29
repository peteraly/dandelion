import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Badge, Card, LinkButton } from "@/components/ui";
import { requireAdmin } from "@/lib/auth/current";
import { listUsers } from "@/lib/services/admin";

export default async function StakeholdersPage() {
  const { actor } = await requireAdmin();
  const t = await getTranslations("admin.users");
  const tr = await getTranslations("roles");
  const users = await listUsers(actor);
  return (
    <>
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{t("title")}</h1>
        <div className="w-48">
          <LinkButton href="/admin/stakeholders/new">{t("create")}</LinkButton>
        </div>
      </div>
      <Card>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-stone-500">
              <th className="py-2">{t("name")}</th>
              <th>{t("role")}</th>
              <th>{t("phone")}</th>
              <th>{(await getTranslations("common"))("status")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {users.map((u) => (
              <tr key={u.id}>
                <td className="py-2">
                  <Link href={`/admin/stakeholders/${u.id}`} className="underline">
                    {u.displayName}
                  </Link>
                </td>
                <td>{tr(u.role)}</td>
                <td className="font-mono">{u.phoneMasked}</td>
                <td>
                  <Badge tone={u.status === "ACTIVE" ? "green" : u.status === "LOCKED" ? "red" : "amber"}>{t(`status.${u.status}`)}</Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </>
  );
}
