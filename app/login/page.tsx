import Link from "next/link";
import { openDemoEnabled } from "@/lib/demo/open";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { PublicShell } from "@/components/shell";
import { Card, Field, PrimaryButton } from "@/components/ui";
import { Notice } from "@/components/notice";
import { currentFieldSession } from "@/lib/auth/current";
import { flags, type SearchParams } from "@/lib/actions";
import { loginAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: SearchParams }) {
  if (await currentFieldSession()) redirect("/home");
  const t = await getTranslations("auth");
  const tc = await getTranslations("common");
  const sp = await searchParams;
  const { error } = await flags(searchParams);
  return (
    <PublicShell path="/login">
      <h1 className="text-2xl font-bold">{t("loginTitle")}</h1>
      <p>{t("loginIntro")}</p>
      {sp.expired ? <p className="rounded-xl bg-amber-50 p-3 text-amber-950">{t("sessionExpired")}</p> : null}
      <Notice error={error} />
      <Card>
        <form action={loginAction} className="flex flex-col gap-3">
          <Field label={tc("phone")} htmlFor="phone" hint="+255 7xx xxx xxx">
            <input id="phone" name="phone" className="field" inputMode="tel" autoComplete="tel" required />
          </Field>
          <Field label={tc("pin")} htmlFor="pin">
            <input id="pin" name="pin" className="field" type="password" inputMode="numeric" pattern="\d{4}" maxLength={4} autoComplete="current-password" required />
          </Field>
          <PrimaryButton>{t("loginTitle")}</PrimaryButton>
        </form>
      </Card>
      {(await openDemoEnabled()) ? (
        <Link href="/demo" className="text-center text-sm underline" data-testid="open-demo-link">
          {(await getTranslations("openDemo"))("loginLink")}
        </Link>
      ) : null}
      <p className="text-sm text-stone-600">{t("pinResetNote")}</p>
      <Link href="/lock" className="btn btn-danger">
        {tc("lockAccount")}
      </Link>
      <Link href="/admin/login" className="text-center text-sm text-stone-500 underline">
        {t("adminLoginTitle")}
      </Link>
    </PublicShell>
  );
}
