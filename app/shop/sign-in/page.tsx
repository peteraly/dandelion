/** Sign in to the shop with a code by SMS (Prompt L §3). */
import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { PublicShell } from "@/components/shell";
import { Card, Field, PrimaryButton } from "@/components/ui";
import { Notice } from "@/components/notice";
import { currentCustomer } from "@/lib/auth/current";
import { flags, type SearchParams } from "@/lib/actions";
import { signInShopAction } from "../actions";

export const dynamic = "force-dynamic";

export default async function ShopSignInPage({ searchParams }: { searchParams: SearchParams }) {
  if (await currentCustomer()) redirect("/shop");
  const t = await getTranslations("shop");
  const tc = await getTranslations("common");
  const sp = await searchParams;
  const { error } = await flags(searchParams);
  return (
    <PublicShell path="/shop/sign-in">
      <h1 className="text-2xl font-bold">{t("signInTitle")}</h1>
      {sp.expired ? <p className="rounded-xl bg-amber-50 p-3 text-amber-950">{t("expiredSession")}</p> : null}
      <Notice error={error} />
      <Card>
        <form action={signInShopAction} className="flex flex-col gap-3" data-testid="shop-sign-in-form">
          <Field label={tc("phone")} htmlFor="phone" hint="+255 7xx xxx xxx">
            <input id="phone" name="phone" className="field" inputMode="tel" autoComplete="tel" required />
          </Field>
          <PrimaryButton>{t("sendCode")}</PrimaryButton>
        </form>
      </Card>
      <Link href="/shop/join" className="text-center text-sm underline">
        {t("noAccount")}
      </Link>
    </PublicShell>
  );
}
