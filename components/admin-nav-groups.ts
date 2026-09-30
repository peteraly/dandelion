/**
 * The admin navigation, translated on the server: the sidebar, the page guide
 * and the admin home's "Everything else" all read this one list.
 */
import { getTranslations } from "next-intl/server";
import { isDemoDataset } from "@/components/demo-banner";
import { simulatorEnabled } from "@/lib/env";
import type { NavGroup } from "./admin-nav";

/** Sidebar groups (Prompt D §5.4): headings are text; the eye finds the live map and approvals without reading. Every item carries a one-line hint (admin.navHints), shown as the page guide and on the home page. */
const GROUPS: [string, [string, string][]][] = [
  ["overview", [["home", "/admin"], ["ecosystem", "/admin/ecosystem"], ["brief", "/admin/brief"]]],
  ["operate", [["approvals", "/admin/approvals"], ["orders", "/admin/orders"], ["exceptions", "/admin/exceptions"], ["inventory", "/admin/inventory"], ["messages", "/admin/messages"]]],
  ["people", [["stakeholders", "/admin/stakeholders"], ["suppliers", "/admin/suppliers"], ["organisations", "/admin/organisations"], ["areas", "/admin/areas"], ["prices", "/admin/prices"]]],
  ["money", [["reconciliation", "/admin/reconciliation"], ["statements", "/admin/statements"], ["ledger", "/admin/ledger"], ["exports", "/admin/exports"]]],
  ["admin", [["settings", "/admin/settings"], ["logs", "/admin/logs"], ["data", "/admin/data-requests"], ["passkeys", "/admin/passkeys"]]],
];

/** The translated navigation, shared by the sidebar, the page guide and the admin home's "Everything else". */
export async function adminNavGroups(): Promise<NavGroup[]> {
  const t = await getTranslations("admin");
  const demo = await isDemoDataset();
  const groups: NavGroup[] = GROUPS.map(([group, items]) => ({ heading: t(`navGroups.${group}`), items: items.map(([k, href]) => ({ href, label: t(`nav.${k}`), hint: t(`navHints.${k}`) })) }));
  const admin = groups[groups.length - 1]!;
  if (simulatorEnabled()) admin.items.push({ href: "/dev/simulator", label: demo ? t("nav.demoControls") : t("nav.devSimulator"), hint: t("navHints.demoControls") });
  if (demo) groups[0]!.items.push({ href: "/admin/demo", label: t("nav.demo"), hint: t("navHints.demo") });
  if (demo && simulatorEnabled()) groups[0]!.items.push({ href: "/admin/demo/journey", label: t("nav.journey"), hint: t("navHints.journey") });
  return groups;
}
