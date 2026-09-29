import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { PublicShell } from "@/components/shell";
import { Card, Field, PrimaryButton } from "@/components/ui";
import { Notice } from "@/components/notice";
import { PasskeyLogin } from "@/components/passkey";
import { currentAdminSession } from "@/lib/auth/current";
import { adminHasPasskey } from "@/lib/auth/webauthn";
import { flags, type SearchParams } from "@/lib/actions";
import { adminTotpAction } from "../actions";

export const dynamic = "force-dynamic";

export default async function SecondFactorPage({ searchParams }: { searchParams: SearchParams }) {
  const session = await currentAdminSession();
  if (!session) redirect("/admin/login");
  if (session.mfaVerified) redirect("/admin");
  const t = await getTranslations("auth");
  const { error } = await flags(searchParams);
  const hasPasskey = await adminHasPasskey(session.user.id);
  return (
    <PublicShell path="/admin/login/second-factor">
      <h1 className="text-2xl font-bold">{t("secondFactor")}</h1>
      <Notice error={error} />
      {hasPasskey ? (
        <Card>
          <PasskeyLogin label={t("usePasskey")} next="/admin" />
        </Card>
      ) : (
        <p className="rounded-xl bg-amber-50 p-3 text-amber-950">{t("passkeyRequired")}</p>
      )}
      <details className="card" open={!hasPasskey}>
        <summary className="cursor-pointer font-semibold">{t("useTotp")}</summary>
        <form action={adminTotpAction} className="mt-3 flex flex-col gap-3">
          <Field label={t("totpCode")} htmlFor="code">
            <input id="code" name="code" className="field" inputMode="numeric" pattern="\d{6}" maxLength={6} required autoComplete="one-time-code" />
          </Field>
          <PrimaryButton>{t("secondFactor")}</PrimaryButton>
        </form>
      </details>
    </PublicShell>
  );
}
