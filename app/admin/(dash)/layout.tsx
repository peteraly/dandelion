import Link from "next/link";
import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { LocaleToggle } from "@/components/shell";
import { DemoBanner, isDemoDataset } from "@/components/demo-banner";
import { Name } from "@/components/name";
import { requireAdmin } from "@/lib/auth/current";
import { logoutAdmin } from "@/app/actions/session";
import { appEnv, simulatorEnabled } from "@/lib/env";
import { LiveDistrict } from "@/components/live-district";
import { AUTO_PLAY_SECONDS } from "@/lib/demo/tick";
import { AdminNav, PageGuide } from "@/components/admin-nav";
import { adminNavGroups } from "@/components/admin-nav-groups";

export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const { session } = await requireAdmin();
  const t = await getTranslations("admin");
  const tc = await getTranslations("common");
  const demo = await isDemoDataset();
  const groups = (await adminNavGroups()).map((g) => ({ ...g, items: g.items.filter((it) => it.href !== "/admin/demo") }));
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
            {demo && simulatorEnabled() ? <LiveDistrict seconds={AUTO_PLAY_SECONDS} labels={{ running: t("live.running"), updating: t("live.updating"), away: t("live.away"), stopped: t("live.stopped") }} /> : null}
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
        {demo ? (
          <Link href="/admin/demo" className="mb-1 block rounded-lg bg-amber-100 px-3 py-2 text-sm font-semibold hover:bg-amber-200" data-testid="nav-demo-guide">
            {t("nav.demo")}
          </Link>
        ) : null}
        <AdminNav groups={groups} label={t("nav.title")} highlight="/admin/ecosystem" />
      </aside>
      <main className="flex min-w-0 flex-1 flex-col gap-4">
        <DemoBanner guide />
        <PageGuide groups={groups} />
        {children}
      </main>
    </div>
  );
}
