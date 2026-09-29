import { getTranslations } from "next-intl/server";
import { ErrorText, SuccessText } from "./ui";

/** Renders ?error=code / ?ok=key from the URL as translated banners. */
export async function Notice({ error, ok, okNamespace = "common" }: { error?: string; ok?: string; okNamespace?: string }) {
  const tErr = await getTranslations("errors");
  const tOk = await getTranslations(okNamespace);
  const has = (t: Awaited<ReturnType<typeof getTranslations>>, k: string) => {
    try {
      return t.has(k);
    } catch {
      return false;
    }
  };
  return (
    <>
      {error ? <ErrorText message={has(tErr, error) ? tErr(error) : tErr("unknown")} /> : null}
      {ok && ok !== "done" ? <SuccessText message={has(tOk, ok) ? tOk(ok) : ok} /> : null}
    </>
  );
}
