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
  // Today: the to-do list (home), what needs a second admin, problems, and the live picture.
  ["overview", [["home", "/admin"], ["approvals", "/admin/approvals"], ["exceptions", "/admin/exceptions"], ["ecosystem", "/admin/ecosystem"], ["brief", "/admin/brief"]]],
  // The marketplace: customers' orders, every order, stock, prices, messages to members.
  ["operate", [["shop", "/admin/shop"], ["orders", "/admin/orders"], ["inventory", "/admin/inventory"], ["prices", "/admin/prices"], ["messages", "/admin/messages"]]],
  ["money", [["payouts", "/admin/payouts"], ["reconciliation", "/admin/reconciliation"], ["statements", "/admin/statements"], ["ledger", "/admin/ledger"], ["exports", "/admin/exports"]]],
  ["people", [["stakeholders", "/admin/stakeholders"], ["suppliers", "/admin/suppliers"], ["organisations", "/admin/organisations"], ["areas", "/admin/areas"]]],
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
