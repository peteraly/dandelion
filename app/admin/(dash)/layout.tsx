import Link from "next/link";
import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { LocaleToggle } from "@/components/shell";
import { DemoBanner, isDemoDataset } from "@/components/demo-banner";
import { Name } from "@/components/name";
import { requireAdmin } from "@/lib/auth/current";
import { logoutAdmin } from "@/app/actions/session";
import { appEnv, simulatorEnabled } from "@/lib/env";

export const dynamic = "force-dynamic";

/** Sidebar groups (Prompt D §5.4): headings are text; the eye finds "Ecosystem" and "Approvals" without reading the list. */
const GROUPS: [string, [string, string][]][] = [
  ["overview", [["home", "/admin"], ["ecosystem", "/admin/ecosystem"], ["brief", "/admin/brief"]]],
  ["operate", [["approvals", "/admin/approvals"], ["orders", "/admin/orders"], ["exceptions", "/admin/exceptions"], ["inventory", "/admin/inventory"], ["messages", "/admin/messages"]]],
  ["people", [["stakeholders", "/admin/stakeholders"], ["suppliers", "/admin/suppliers"], ["organisations", "/admin/organisations"], ["areas", "/admin/areas"], ["prices", "/admin/prices"]]],
  ["money", [["reconciliation", "/admin/reconciliation"], ["statements", "/admin/statements"], ["ledger", "/admin/ledger"], ["exports", "/admin/exports"]]],
  ["admin", [["settings", "/admin/settings"], ["logs", "/admin/logs"], ["data", "/admin/data-requests"]]],
];

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const { session } = await requireAdmin();
  const t = await getTranslations("admin");
  const tc = await getTranslations("common");
  const demo = await isDemoDataset();
  return (
    <div className="mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-4 p-4 md:flex-row">
      <aside className="md:w-56 md:shrink-0">
        <div className="mb-3 flex items-center justify-between md:block">
          <div>
            <p className="text-xl font-bold text-brand-700">Dandelion</p>
            <p className="text-sm text-stone-600">
              <Name value={session.user.displayName} />
            </p>
            {session.via === "OPEN_DEMO" ? (
              <p className="mt-1 flex items-center gap-2 text-xs">
                <span className="rounded bg-amber-100 px-1.5 py-0.5 font-semibold uppercase tracking-wide text-amber-900" data-testid="open-demo-chip">
                  {t("openDemoChip")}
                </span>
                <Link href="/demo" className="underline" data-testid="switch-role">
                  {t("switchRole")}
                </Link>
              </p>
            ) : null}
            <p className="text-xs uppercase text-stone-600">{appEnv()}</p>
          </div>
          <div className="flex gap-2 md:mt-2">
            <LocaleToggle back="/admin" />
            <form action={logoutAdmin}>
              <button type="submit" className="rounded-lg border border-stone-300 px-3 py-2 text-sm">
                {tc("logout")}
              </button>
            </form>
          </div>
        </div>
        <nav className="flex flex-wrap gap-1 md:flex-col" aria-label={t("nav.title")}>
          {demo ? (
            <Link href="/admin/demo" className="rounded-lg bg-amber-100 px-3 py-2 text-sm font-semibold hover:bg-amber-200" data-testid="nav-demo-guide">
              {t("nav.demo")}
            </Link>
          ) : null}
          {GROUPS.map(([group, items]) => (
            <div key={group} className="md:mt-2">
              <p className="px-3 pt-1 text-[11px] font-semibold uppercase tracking-wide text-stone-500">{t(`navGroups.${group}`)}</p>
              {items.map(([k, href]) => (
                <Link key={href} href={href} className="block rounded-lg px-3 py-2 text-sm hover:bg-stone-200">
                  {t(`nav.${k}`)}
                </Link>
              ))}
              {group === "admin" ? (
                <>
                  <Link href="/admin/passkeys" className="block rounded-lg px-3 py-2 text-sm hover:bg-stone-200">
                    {t("nav.passkeys")}
                  </Link>
                  {simulatorEnabled() ? (
                    <Link href="/dev/simulator" className="block rounded-lg px-3 py-2 text-sm hover:bg-stone-200">
                      {demo ? t("nav.demoControls") : t("nav.devSimulator")}
                    </Link>
                  ) : null}
                </>
              ) : null}
            </div>
          ))}
        </nav>
      </aside>
      <main className="flex flex-1 flex-col gap-4">
        <DemoBanner guide />
        {children}
      </main>
    </div>
  );
}
