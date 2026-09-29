import Link from "next/link";
import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { LocaleToggle } from "@/components/shell";
import { DemoBanner } from "@/components/demo-banner";
import { requireAdmin } from "@/lib/auth/current";
import { logoutAdmin } from "@/app/actions/session";
import { appEnv, simulatorEnabled } from "@/lib/env";

export const dynamic = "force-dynamic";

const NAV: [string, string][] = [
  ["home", "/admin"],
  ["approvals", "/admin/approvals"],
  ["stakeholders", "/admin/stakeholders"],
  ["prices", "/admin/prices"],
  ["orders", "/admin/orders"],
  ["exceptions", "/admin/exceptions"],
  ["inventory", "/admin/inventory"],
  ["reconciliation", "/admin/reconciliation"],
  ["statements", "/admin/statements"],
  ["ledger", "/admin/ledger"],
  ["logs", "/admin/logs"],
  ["settings", "/admin/settings"],
  ["exports", "/admin/exports"],
  ["data", "/admin/data-requests"],
  ["brief", "/admin/brief"],
  ["messages", "/admin/messages"],
];

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const { session } = await requireAdmin();
  const t = await getTranslations("admin");
  const tc = await getTranslations("common");
  return (
    <div className="mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-4 p-4 md:flex-row">
      <aside className="md:w-56 md:shrink-0">
        <div className="mb-3 flex items-center justify-between md:block">
          <div>
            <p className="text-xl font-bold text-brand-700">Dandelion</p>
            <p className="text-sm text-stone-600">{session.user.displayName}</p>
            <p className="text-xs uppercase text-stone-400">{appEnv()}</p>
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
        <nav className="flex flex-wrap gap-1 md:flex-col">
          {NAV.map(([k, href]) => (
            <Link key={href} href={href} className="rounded-lg px-3 py-2 text-sm hover:bg-stone-200">
              {t(`nav.${k}`)}
            </Link>
          ))}
          <Link href="/admin/passkeys" className="rounded-lg px-3 py-2 text-sm hover:bg-stone-200">
            Passkeys
          </Link>
          {simulatorEnabled() ? (
            <Link href="/dev/simulator" className="rounded-lg bg-amber-100 px-3 py-2 text-sm font-semibold hover:bg-amber-200">
              Dev simulator
            </Link>
          ) : null}
        </nav>
      </aside>
      <main className="flex flex-1 flex-col gap-4">
        <DemoBanner />
        {children}
      </main>
    </div>
  );
}
