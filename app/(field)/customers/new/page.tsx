import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Card, Check, Field, IdemKey, PrimaryButton } from "@/components/ui";
import { Notice } from "@/components/notice";
import { requireField } from "@/lib/auth/current";
import { can } from "@/lib/policy";
import { flags, type SearchParams } from "@/lib/actions";
import { createCustomerAction } from "../../actions";

export const dynamic = "force-dynamic";

export default async function NewCustomerPage({ searchParams }: { searchParams: SearchParams }) {
  const { actor } = await requireField();
  // Only local sellers hold customers (safeguarding, lib/domain/sales.ts CLOSED_KINDS).
  if (!can(actor, "customer.create")) notFound();
  const t = await getTranslations("field.customer");
  const tc = await getTranslations("common");
  const { error } = await flags(searchParams);
  return (
    <>
      <h1 className="text-2xl font-bold">{t("add")}</h1>
      <p className="rounded-xl bg-brand-50 p-3 text-sm">{t("privacyShort")}</p>
      <Notice error={error} />
      <Card>
        <form action={createCustomerAction} className="flex flex-col gap-3">
          <IdemKey />
          <Field label={t("name")} htmlFor="displayName">
            <input id="displayName" name="displayName" className="field" required maxLength={60} />
          </Field>
          <Field label={tc("phone")} htmlFor="phone" hint="+255 7xx xxx xxx">
            <input id="phone" name="phone" className="field" inputMode="tel" required autoComplete="off" />
          </Field>
          <Check name="consentMessages" label={t("consentMessages")} />
          <Check name="consentReminders" label={t("consentReminders")} />
          <PrimaryButton>{tc("continue")}</PrimaryButton>
        </form>
      </Card>
    </>
  );
}
