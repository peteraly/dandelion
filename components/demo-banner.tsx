import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { getSetting } from "@/lib/services/core";

/**
 * Shown on every admin and field page, on /verify and in exports while the
 * database was populated by the demo profile (settings.seedProfile = "demo").
 * Keyed on the setting, never on names an admin could type (Prompt B §1.6).
 */
export async function isDemoDataset(): Promise<boolean> {
  try {
    return (await getSetting("seedProfile")) === "demo";
  } catch {
    return false;
  }
}

export async function DemoBanner({ guide = false }: { guide?: boolean } = {}) {
  if (!(await isDemoDataset())) return null;
  const t = await getTranslations("demo");
  return (
    <p role="status" data-testid="demo-banner" className="rounded-xl border border-amber-300 bg-amber-100 px-3 py-2 text-sm font-semibold text-amber-950">
      {t("banner")}
      {guide ? (
        <>
          {" · "}
          <Link href="/admin/demo" className="underline" data-testid="demo-guide-link">
            {t("howTo")}
          </Link>
        </>
      ) : null}
    </p>
  );
}
