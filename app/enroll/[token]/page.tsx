import { getTranslations } from "next-intl/server";
import { PublicShell } from "@/components/shell";
import { Card, Field, PrimaryButton } from "@/components/ui";
import { Notice } from "@/components/notice";
import { describeEnrollment } from "@/lib/services/users";
import { flags, type SearchParams } from "@/lib/actions";
import { completeEnrollAction, startEnrollAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function EnrollPage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: SearchParams }) {
  const { token } = await params;
  const t = await getTranslations("auth");
  const tc = await getTranslations("common");
  const tr = await getTranslations("roles");
  const sp = await searchParams;
  const { error } = await flags(searchParams);
  const info = await describeEnrollment(token);
  const challenge = typeof sp.challenge === "string" ? sp.challenge : "";
  const path = `/enroll/${token}`;
  if (!info || info.role === "SUPER_ADMIN") {
    return (
      <PublicShell path={path}>
        <h1 className="text-2xl font-bold">{t("enrollTitle")}</h1>
        <p className="rounded-xl bg-red-50 p-3 text-red-800">{t("linkInvalid")}</p>
      </PublicShell>
    );
  }
  return (
    <PublicShell path={path}>
      <h1 className="text-2xl font-bold">{t("enrollTitle")}</h1>
      <p>{t("enrollIntro", { name: info.displayName, role: tr(info.role) })}</p>
      <Notice error={error} />
      {!challenge ? (
        <Card>
          <form action={startEnrollAction} className="flex flex-col gap-3">
            <input type="hidden" name="token" value={token} />
            <Field label={tc("phone")} htmlFor="phone" hint={t("enterPhone")}>
              <input id="phone" name="phone" className="field" inputMode="tel" autoComplete="tel" required />
            </Field>
            <PrimaryButton>{t("sendCode")}</PrimaryButton>
          </form>
        </Card>
      ) : (
        <Card>
          <p className="mb-3 rounded-xl bg-green-50 p-3 text-green-900">{t("codeSent")}</p>
          <form action={completeEnrollAction} className="flex flex-col gap-3">
            <input type="hidden" name="token" value={token} />
            <input type="hidden" name="challengeId" value={challenge} />
            <Field label={t("enterCode")} htmlFor="code">
              <input id="code" name="code" className="field" inputMode="numeric" pattern="\d{6}" maxLength={6} required autoComplete="one-time-code" />
            </Field>
            <Field label={t("choosePin")} htmlFor="pin">
              <input id="pin" name="pin" className="field" type="password" inputMode="numeric" pattern="\d{4}" maxLength={4} required autoComplete="new-password" />
            </Field>
            <Field label={t("repeatPin")} htmlFor="pin2">
              <input id="pin2" name="pin2" className="field" type="password" inputMode="numeric" pattern="\d{4}" maxLength={4} required autoComplete="new-password" />
            </Field>
            <PrimaryButton>{t("activate")}</PrimaryButton>
          </form>
        </Card>
      )}
    </PublicShell>
  );
}
