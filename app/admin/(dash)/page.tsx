import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Card } from "@/components/ui";
import { requireAdmin } from "@/lib/auth/current";
import { priorities } from "@/lib/services/admin";
import { formatEther } from "viem";

export default async function AdminHome() {
  const { actor } = await requireAdmin();
  const t = await getTranslations("admin");
  const p = await priorities(actor);
  const rows: [string, number, string][] = [
    [t("paymentsReview"), p.paymentsReview, "/admin/exceptions"],
    [t("deliveriesInspection"), p.deliveriesInspection, "/admin/orders"],
    [t("lowStockHubs"), p.lowStockHubs, "/admin/inventory"],
    [t("pendingApprovals"), p.pendingApprovals, "/admin/approvals"],
    [t("openExceptions"), p.openExceptions, "/admin/exceptions"],
    [t("reconFlags"), p.reconFlags, "/admin/reconciliation"],
    [t("logs.alerts"), p.alerts24h, "/admin/logs"],
  ];
  return (
    <>
      <h1 className="text-2xl font-bold">{t("priorities")}</h1>
      <Card>
        <ol className="divide-y divide-stone-100">
          {rows.map(([label, n, href], i) => (
            <li key={label}>
              <Link href={href} className="flex items-center justify-between py-3">
                <span>
                  {i + 1}. {label}
                </span>
                <span className={`badge ${n > 0 ? "bg-amber-100 text-amber-900" : "bg-stone-100 text-stone-600"}`} data-testid={`priority-${i}`}>
                  {n}
                </span>
              </Link>
            </li>
          ))}
          <li className="flex items-center justify-between py-3">
            <span>{t("ledgerStatus")}</span>
            <span className="text-sm">{t("ledgerUnanchored", { count: p.ledgerUnanchored })}</span>
          </li>
          <li className="flex items-center justify-between py-3">
            <span>{t("walletBalance")}</span>
            <span className="text-sm">{p.wallet.configured ? `${p.wallet.balanceWei === null ? "?" : formatEther(p.wallet.balanceWei)} CELO (${p.wallet.network})` : "not configured"}</span>
          </li>
        </ol>
      </Card>
      <p className="text-sm text-stone-600">
        {t("nextAction")}: <Link href="/admin/approvals" className="underline">{t("nav.approvals")}</Link>
      </p>
    </>
  );
}
