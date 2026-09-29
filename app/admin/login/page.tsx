import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { PublicShell } from "@/components/shell";
import { Card, Field, PrimaryButton } from "@/components/ui";
import { Notice } from "@/components/notice";
import { currentAdminSession } from "@/lib/auth/current";
import { flags, type SearchParams } from "@/lib/actions";
import { adminLoginAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function AdminLoginPage({ searchParams }: { searchParams: SearchParams }) {
  const session = await currentAdminSession();
  if (session?.mfaVerified) redirect("/admin");
  if (session) redirect("/admin/login/second-factor");
  const t = await getTranslations("auth");
  const tc = await getTranslations("common");
  const { error } = await flags(searchParams);
  return (
    <PublicShell path="/admin/login">
      <h1 className="text-2xl font-bold">{t("adminLoginTitle")}</h1>
      <Notice error={error} />
      <Card>
        <form action={adminLoginAction} className="flex flex-col gap-3">
          <Field label={tc("phone")} htmlFor="phone">
            <input id="phone" name="phone" className="field" inputMode="tel" autoComplete="username" required />
          </Field>
          <Field label={t("passphrase")} htmlFor="passphrase">
            <input id="passphrase" name="passphrase" className="field" type="password" autoComplete="current-password" required />
          </Field>
          <PrimaryButton>{tc("continue")}</PrimaryButton>
        </form>
      </Card>
      <p className="text-sm text-stone-600">{t("passkeyRequired")}</p>
    </PublicShell>
  );
}
