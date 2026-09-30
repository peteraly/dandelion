/**
 * Presenter view (Prompt D §5.8): the ecosystem view without the sidebar,
 * map at full width, feed below. Same data, same refresh, same access rule;
 * the route is the whole feature.
 */
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { DemoBanner } from "@/components/demo-banner";
import { EcosystemView } from "@/components/ecosystem/view";
import type { SearchParams } from "@/lib/actions";

export const dynamic = "force-dynamic";

export default async function PresenterPage({ searchParams }: { searchParams: SearchParams }) {
  const t = await getTranslations("admin.nav");
  return (
    <div className="mx-auto flex min-h-screen w-full max-w-[1600px] flex-col gap-4 p-4" data-testid="presenter">
      <div className="flex items-center justify-between gap-2 text-sm">
        <p className="text-xl font-bold text-brand-700">Dandelion</p>
        <Link href="/admin/ecosystem" className="underline" data-testid="exit-presenter">
          {t("exitPresent")}
        </Link>
      </div>
      <DemoBanner />
      <EcosystemView searchParams={searchParams} present />
    </div>
  );
}
