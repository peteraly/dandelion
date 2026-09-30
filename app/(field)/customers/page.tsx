import Link from "next/link";
import { Name } from "@/components/name";
import { getTranslations } from "next-intl/server";
import { and, eq, inArray } from "drizzle-orm";
import { Badge, Card, LinkButton } from "@/components/ui";
import { requireField } from "@/lib/auth/current";
import { myCustomers } from "@/lib/services/customers";
import { getDb } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import { maskPhone } from "@/lib/phone";
import { decryptString } from "@/lib/crypto/envelope";

export const dynamic = "force-dynamic";

export default async function CustomersPage() {
  const { actor } = await requireField();
  const t = await getTranslations("field.customer");
  const customers = await myCustomers(actor);
  const plans = customers.length
    ? await getDb().query.orders.findMany({
        where: and(inArray(s.orders.customerId, customers.map((c) => c.id)), inArray(s.orders.state, ["PLAN_ACTIVE", "FULLY_PAID", "HANDOVER_PENDING"])),
      })
    : [];
  const rows = await Promise.all(customers.map(async (c) => ({ c, phone: maskPhone(await decryptString(c.phoneEnc)), plan: plans.find((p) => p.customerId === c.id) })));
  return (
    <>
      <h1 className="text-2xl font-bold">{t("list")}</h1>
      <LinkButton href="/customers/new">{t("add")}</LinkButton>
      <Card>
        <ul className="divide-y divide-stone-100">
          {rows.map(({ c, phone, plan }) => (
            <li key={c.id}>
              <Link href={plan ? `/orders/${plan.id}` : `/customers/${c.id}`} className="flex items-center justify-between py-3">
                <span>
                  <Name value={c.displayName} className="font-semibold" />
                  <span className="block text-sm text-stone-600">{phone}</span>
                </span>
                {plan ? <Badge tone="purple">{plan.state.replace(/_/g, " ")}</Badge> : c.phoneVerifiedAt ? <Badge>{t("noPlan")}</Badge> : <Badge tone="amber">{t("verifyPhone")}</Badge>}
              </Link>
            </li>
          ))}
          {rows.length === 0 ? <li className="py-3 text-stone-500">—</li> : null}
        </ul>
      </Card>
    </>
  );
}
