import { getTranslations } from "next-intl/server";
import { PublicShell } from "@/components/shell";
import { Card, Field, PrimaryButton } from "@/components/ui";
import { Notice } from "@/components/notice";
import { beginAdminEnrollment, describeEnrollment } from "@/lib/services/users";
import { otpauthUri } from "@/lib/auth/totp";
import { flags, type SearchParams } from "@/lib/actions";
import { adminEnrollAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function AdminEnrollPage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: SearchParams }) {
  const { token } = await params;
  const t = await getTranslations("auth");
  const { error } = await flags(searchParams);
  const info = await describeEnrollment(token);
  if (!info || info.role !== "SUPER_ADMIN") {
    return (
      <PublicShell path={`/admin/enroll/${token}`}>
        <p className="rounded-xl bg-red-50 p-3 text-red-800">{t("linkInvalid")}</p>
      </PublicShell>
    );
  }
  const { totpSecret, displayName } = await beginAdminEnrollment(token);
  return (
    <PublicShell path={`/admin/enroll/${token}`}>
      <h1 className="text-2xl font-bold">{t("adminEnrollTitle")}</h1>
      <p>{t("adminEnrollIntro")}</p>
      <Notice error={error} />
      <Card>
        <p className="label">{t("totpSecret")}</p>
        <p className="break-all font-mono text-lg" data-testid="totp-secret">
          {totpSecret}
        </p>
        <p className="mt-1 break-all text-xs text-stone-500">{otpauthUri(totpSecret, displayName)}</p>
      </Card>
      <Card>
        <form action={adminEnrollAction} className="flex flex-col gap-3">
          <input type="hidden" name="token" value={token} />
          <Field label={t("passphrase")} htmlFor="passphrase" hint="12+ characters">
            <input id="passphrase" name="passphrase" className="field" type="password" minLength={12} required autoComplete="new-password" />
          </Field>
          <Field label={t("totpCode")} htmlFor="totp">
            <input id="totp" name="totp" className="field" inputMode="numeric" pattern="\d{6}" maxLength={6} required />
          </Field>
          <PrimaryButton>{t("activate")}</PrimaryButton>
        </form>
      </Card>
    </PublicShell>
  );
}
