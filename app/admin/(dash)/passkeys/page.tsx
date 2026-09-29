import { getTranslations } from "next-intl/server";
import { eq } from "drizzle-orm";
import { Card } from "@/components/ui";
import { PasskeyRegister } from "@/components/passkey";
import { requireAdmin } from "@/lib/auth/current";
import { getDb } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import type { SearchParams } from "@/lib/actions";

export default async function PasskeysPage({ searchParams }: { searchParams: SearchParams }) {
  const { session } = await requireAdmin();
  const t = await getTranslations("auth");
  const sp = await searchParams;
  const creds = await getDb().query.webauthnCredentials.findMany({ where: eq(s.webauthnCredentials.userId, session.user.id) });
  return (
    <>
      <h1 className="text-2xl font-bold">{t("registerPasskey")}</h1>
      {sp.first ? <p className="rounded-xl bg-amber-50 p-3 text-amber-950">{t("passkeyRequired")}</p> : null}
      <Card>
        <PasskeyRegister label={t("registerPasskey")} done={t("passkeyRegistered")} />
      </Card>
      <Card>
        <ul className="text-sm">
          {creds.map((c) => (
            <li key={c.id} className="py-1 font-mono">
              {c.id.slice(0, 16)}… · {c.createdAt.toISOString().slice(0, 10)}
            </li>
          ))}
          {creds.length === 0 ? <li className="text-stone-500">—</li> : null}
        </ul>
      </Card>
    </>
  );
}
