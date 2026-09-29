import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { Badge, KV } from "./ui";
import { formatTzs } from "@/lib/money";
import { formatDateTime } from "@/lib/util/time";
import type { OrderSnapshot } from "@/lib/domain/workflows";
import type { PaymentStatus } from "@/lib/domain/types";

export async function PaymentBadge({ status }: { status: PaymentStatus | null }) {
  const t = await getTranslations("payment");
  if (!status) return null;
  const tone = status === "PAYMENT_CONFIRMED" ? "green" : status === "PAYMENT_PENDING" ? "amber" : "red";
  return <Badge tone={tone}>{t(status)}</Badge>;
}

export async function OrderSummary({ snap, product }: { snap: OrderSnapshot; product: string }) {
  const t = await getTranslations();
  const locale = (await getLocale()) as "sw" | "en";
  const items: [string, React.ReactNode][] = [
    [t("common.reference"), <span key="ref" className="font-mono">{snap.ref}</span>],
    [t("common.product"), product],
    [t("common.price"), formatTzs(snap.totalTzs, locale)],
  ];
  if (snap.kind === "CHAMPION_TO_CUSTOMER" || snap.confirmedPaidTzs > 0 || snap.donorFundedTzs > 0) {
    items.push([t("common.paid"), formatTzs(snap.confirmedPaidTzs + snap.donorFundedTzs, locale)]);
    items.push([t("common.remaining"), formatTzs(snap.totalTzs - snap.confirmedPaidTzs - snap.donorFundedTzs, locale)]);
  }
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="text-sm text-stone-600">{t(`orderKinds.${snap.kind}`)}</span>
        <PaymentBadge status={snap.latestPaymentStatus} />
      </div>
      <KV items={items} />
      <div className="flex items-center justify-between text-sm text-stone-500">
        <span>{t("common.lastUpdated", { time: formatDateTime(snap.updatedAt, locale) })}</span>
        <Link href={`/verify/${snap.verifyRef}`} className="underline">
          {t("common.verifyLink")}
        </Link>
      </div>
    </div>
  );
}
