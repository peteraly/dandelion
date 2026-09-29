import { getLocale, getTranslations } from "next-intl/server";
import { Badge, Card } from "@/components/ui";
import { requireAdmin } from "@/lib/auth/current";
import { adminLog, alertThresholds, securityLog } from "@/lib/services/admin";
import { formatDateTime } from "@/lib/util/time";

export default async function LogsPage() {
  const { actor } = await requireAdmin();
  const t = await getTranslations("admin.logs");
  const locale = (await getLocale()) as "sw" | "en";
  const [admin, security, alerts] = await Promise.all([adminLog(actor), securityLog(actor), alertThresholds(actor)]);
  return (
    <>
      <h1 className="text-2xl font-bold">{t("title")}</h1>
      <Card>
        <h2 className="mb-2 font-semibold">{t("alerts")}</h2>
        <ul className="flex flex-wrap gap-2 text-sm">
          {alerts.map((a) => (
            <li key={a.type}>
              <Badge tone={a.breached ? "red" : "neutral"}>
                {a.type} {a.count}
                {a.threshold !== null ? ` / ${a.threshold}` : ""}
              </Badge>
            </li>
          ))}
        </ul>
      </Card>
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <h2 className="mb-2 font-semibold">{t("title")}</h2>
          <ul className="divide-y divide-stone-100 text-xs">
            {admin.map((a) => (
              <li key={a.id} className={`py-1 ${a.highlighted ? "bg-amber-50 font-semibold" : ""}`} data-testid={a.highlighted ? "highlighted-log" : undefined}>
                {formatDateTime(a.createdAt, locale)} · {a.action} · {a.targetType ?? ""} {a.targetId?.slice(0, 8) ?? ""} · {JSON.stringify(a.details)}
              </li>
            ))}
          </ul>
        </Card>
        <Card>
          <h2 className="mb-2 font-semibold">{t("security")}</h2>
          <ul className="divide-y divide-stone-100 text-xs">
            {security.map((e) => (
              <li key={e.id} className="py-1">
                <Badge tone={e.severity === "ALERT" ? "red" : e.severity === "WARN" ? "amber" : "neutral"}>{e.severity}</Badge> {formatDateTime(e.createdAt, locale)} · {e.type} · {JSON.stringify(e.details)}
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </>
  );
}
