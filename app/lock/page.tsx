import { getTranslations } from "next-intl/server";
import { PublicShell } from "@/components/shell";
import { Card, Field, PrimaryButton } from "@/components/ui";
import { Notice } from "@/components/notice";
import { flags, type SearchParams } from "@/lib/actions";
import { currentFieldSession } from "@/lib/auth/current";
import { lockAction } from "../login/actions";
import { lockSelfAction } from "@/app/(field)/actions";

export const dynamic = "force-dynamic";

export default async function LockPage({ searchParams }: { searchParams: SearchParams }) {
  const t = await getTranslations("auth");
  const tc = await getTranslations("common");
  const { error, ok } = await flags(searchParams);
  const session = await currentFieldSession();
  return (
    <PublicShell path="/lock">
      <h1 className="text-2xl font-bold">{t("lockTitle")}</h1>
      <p>{t("lockIntro")}</p>
      {ok === "locked" ? (
        <p className="rounded-xl border border-green-300 bg-green-50 p-3 text-green-900" data-testid="locked-ok">
          {t("locked")}
        </p>
      ) : null}
      <Notice error={error === "login_failed" ? "login_failed" : error} />
      {session ? (
        <Card>
          <form action={lockSelfAction}>
            <PrimaryButton>{tc("lockAccount")}</PrimaryButton>
          </form>
        </Card>
      ) : null}
      <Card>
        <form action={lockAction} className="flex flex-col gap-3">
          <Field label={tc("phone")} htmlFor="phone">
            <input id="phone" name="phone" className="field" inputMode="tel" required />
          </Field>
          <Field label={tc("pin")} htmlFor="pin">
            <input id="pin" name="pin" className="field" type="password" inputMode="numeric" pattern="\d{4}" maxLength={4} required />
          </Field>
          <button type="submit" className="btn btn-danger">
            {tc("lockAccount")}
          </button>
        </form>
      </Card>
    </PublicShell>
  );
}
