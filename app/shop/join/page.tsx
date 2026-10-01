/** Join the shop (Prompt L §3): a name she chooses, her phone, a public meeting point, and her consent. */
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { PublicShell } from "@/components/shell";
import { Card, Field, PrimaryButton } from "@/components/ui";
import { Notice } from "@/components/notice";
import { shopAreas } from "@/lib/services/shop";
import { flags, type SearchParams } from "@/lib/actions";
import { joinShopAction } from "../actions";
import { PlaceSelect } from "../place-select";

export const dynamic = "force-dynamic";

export default async function JoinPage({ searchParams }: { searchParams: SearchParams }) {
  const t = await getTranslations("shop");
  const tc = await getTranslations("common");
  const { error } = await flags(searchParams);
  const areas = await shopAreas().catch(() => []);
  return (
    <PublicShell path="/shop/join">
      <h1 className="text-2xl font-bold">{t("joinTitle")}</h1>
      <p>{t("joinIntro")}</p>
      <Notice error={error} />
      {areas.length === 0 ? (
        <p className="rounded-xl bg-amber-50 p-3 text-amber-950">{t("nowhereYet")}</p>
      ) : (
        <Card>
          <form action={joinShopAction} className="flex flex-col gap-3" data-testid="shop-join-form">
            <Field label={t("name")} htmlFor="displayName" hint={t("nameHint")}>
              <input id="displayName" name="displayName" className="field" maxLength={60} autoComplete="given-name" required />
            </Field>
            <Field label={tc("phone")} htmlFor="phone" hint="+255 7xx xxx xxx">
              <input id="phone" name="phone" className="field" inputMode="tel" autoComplete="tel" required />
            </Field>
            <Field label={t("place")} htmlFor="meetingPointId" hint={t("placeHint")}>
              <PlaceSelect areas={areas} id="meetingPointId" />
            </Field>
            <label className="check">
              <input type="checkbox" name="consentMessages" value="true" required className="mt-0.5" />
              <span>{t("consentMessages")}</span>
            </label>
            <label className="check">
              <input type="checkbox" name="consentReminders" value="true" className="mt-0.5" />
              <span>{t("consentReminders")}</span>
            </label>
            <p className="text-sm text-stone-600">
              {t("privacyNote")}{" "}
              <Link href="/privacy" className="underline">
                {t("privacyLink")}
              </Link>
            </p>
            <PrimaryButton>{t("sendCode")}</PrimaryButton>
          </form>
        </Card>
      )}
      <Link href="/shop/sign-in" className="text-center text-sm underline">
        {t("haveAccount")}
      </Link>
    </PublicShell>
  );
}
