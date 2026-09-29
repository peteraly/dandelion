import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { setLocale } from "@/app/actions/session";
import { helpContacts } from "@/lib/env";

export async function LocaleToggle({ back }: { back: string }) {
  const locale = await getLocale();
  const other = locale === "sw" ? "en" : "sw";
  return (
    <form action={setLocale}>
      <input type="hidden" name="locale" value={other} />
      <input type="hidden" name="back" value={back} />
      <button type="submit" className="rounded-lg border border-stone-300 px-3 py-2 text-sm font-semibold" aria-label={`Switch language to ${other.toUpperCase()}`}>
        {locale === "sw" ? "SW" : "EN"} → {other.toUpperCase()}
      </button>
    </form>
  );
}

export async function HelpBlock() {
  const t = await getTranslations("common");
  const { phone, whatsapp } = helpContacts();
  return (
    <div className="flex flex-col gap-2 text-base">
      <a className="btn btn-secondary" href={`tel:${phone.replace(/\s/g, "")}`}>
        {t("callHelp", { phone })}
      </a>
      <a className="btn btn-secondary" href={`https://wa.me/${whatsapp.replace(/\D/g, "")}`} rel="noreferrer noopener">
        {t("whatsappHelp", { phone: whatsapp })}
      </a>
    </div>
  );
}

export async function FieldShell({
  children,
  roleLabel,
  name,
  path,
  logout,
}: {
  children: ReactNode;
  roleLabel: string;
  name: string;
  path: string;
  logout: () => Promise<void>;
}) {
  const t = await getTranslations("common");
  return (
    <div className="mx-auto flex min-h-screen w-full max-w-md flex-col gap-4 p-4">
      <header className="flex items-center justify-between gap-2">
        <div>
          <p className="text-xs uppercase tracking-wide text-stone-500">{t("yourRole")}</p>
          <p className="text-lg font-bold">{roleLabel}</p>
          <p className="text-sm text-stone-600">{name}</p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <LocaleToggle back={path} />
          <form action={logout}>
            <button type="submit" className="rounded-lg border border-stone-300 px-3 py-2 text-sm">
              {t("logout")}
            </button>
          </form>
        </div>
      </header>
      <main className="flex flex-1 flex-col gap-4">{children}</main>
      <footer className="flex flex-col gap-3 border-t border-stone-200 pt-4">
        <Link href="/problem" className="btn btn-warn text-xl">
          {t("reportProblem")}
        </Link>
        <HelpBlock />
        <Link href="/lock" className="text-center text-sm text-stone-600 underline">
          {t("lockAccount")}
        </Link>
      </footer>
    </div>
  );
}

export function PublicShell({ children, path }: { children: ReactNode; path: string }) {
  return (
    <div className="mx-auto flex min-h-screen w-full max-w-md flex-col gap-4 p-4">
      <header className="flex items-center justify-between">
        <Link href="/" className="text-xl font-bold text-brand-700">
          Dandelion
        </Link>
        <LocaleToggle back={path} />
      </header>
      <main className="flex flex-1 flex-col gap-4">{children}</main>
    </div>
  );
}
