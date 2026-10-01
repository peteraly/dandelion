/**
 * Enter the code (Prompt L §3). The page reads the same whether or not the number has an account, so nobody can use
 * it to find out who buys here. In the open demo, where every number is fictional, the code is shown on screen.
 */
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { PublicShell } from "@/components/shell";
import { Card, Field, PrimaryButton } from "@/components/ui";
import { Notice } from "@/components/notice";
import { openDemoEnabled } from "@/lib/demo/open";
import { demoCodeFor } from "@/lib/services/shop";
import { flags, type SearchParams } from "@/lib/actions";
import { verifyShopAction } from "../actions";

export const dynamic = "force-dynamic";

export default async function ShopVerifyPage({ searchParams }: { searchParams: SearchParams }) {
  const t = await getTranslations("shop");
  const sp = await searchParams;
  const { error } = await flags(searchParams);
  const challengeId = typeof sp.c === "string" ? sp.c : "";
  const demoCode = challengeId && (await openDemoEnabled()) ? await demoCodeFor(challengeId) : null;
  return (
    <PublicShell path="/shop/verify">
      <h1 className="text-2xl font-bold">{t("verifyTitle")}</h1>
      <p>{t("verifyIntro")}</p>
      <Notice error={error} />
      {demoCode ? (
        <p className="rounded-xl bg-purple-50 p-3 text-purple-950" data-testid="shop-demo-code">
          {t("demoCode", { code: demoCode })}
        </p>
      ) : null}
      <Card>
        <form action={verifyShopAction} className="flex flex-col gap-3" data-testid="shop-verify-form">
          <input type="hidden" name="challengeId" value={challengeId} />
          <Field label={t("code")} htmlFor="code">
            <input id="code" name="code" className="field" inputMode="numeric" pattern="\d{6}" maxLength={6} autoComplete="one-time-code" required />
          </Field>
          <PrimaryButton>{t("confirm")}</PrimaryButton>
        </form>
      </Card>
      <p className="text-sm text-stone-600">{t("noSms")}</p>
      <div className="grid grid-cols-2 gap-2 text-sm">
        <Link href="/shop/sign-in" className="btn btn-secondary">
          {t("tryAgain")}
        </Link>
        <Link href="/shop/join" className="btn btn-secondary">
          {t("join")}
        </Link>
      </div>
    </PublicShell>
  );
}
