import { notFound } from "next/navigation";
import { Name } from "@/components/name";
import { getTranslations } from "next-intl/server";
import { eq } from "drizzle-orm";
import { Badge, Card, IdemKey, KV } from "@/components/ui";
import { Notice } from "@/components/notice";
import { requireAdmin } from "@/lib/auth/current";
import { getDb } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import { decryptString } from "@/lib/crypto/envelope";
import { maskPhone } from "@/lib/phone";
import { flags, type SearchParams } from "@/lib/actions";
import { lockUserAction, reenrollUserAction, suspendUserAction } from "../../actions";

export default async function StakeholderPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SearchParams }) {
  const { id } = await params;
  const { actor } = await requireAdmin();
  const t = await getTranslations("admin.users");
  const tr = await getTranslations("roles");
  const sp = await searchParams;
  const { error, ok } = await flags(searchParams);
  const u = await getDb().query.users.findFirst({ where: eq(s.users.id, id) });
  if (!u) notFound();
  const link = typeof sp.link === "string" ? sp.link : null;
  const training = await getDb().query.trainingRecords.findMany({ where: eq(s.trainingRecords.userId, id) });
  const self = u.id === actor.userId;
  return (
    <>
      <h1 className="text-2xl font-bold">
        <Name value={u.displayName} />
      </h1>
      <Notice error={error} ok={ok} okNamespace="admin.users" />
      {link ? (
        <Card className="border-2 border-amber-400">
          <p className="font-semibold">{t("adminCreated")}</p>
          <p className="break-all font-mono text-sm" data-testid="admin-enroll-link">
            {link}
          </p>
        </Card>
      ) : null}
      <Card>
        <KV
          items={[
            [t("role"), tr(u.role)],
            [t("phone"), maskPhone(await decryptString(u.phoneEnc))],
            [(await getTranslations("common"))("status"), <Badge key="s" tone={u.status === "ACTIVE" ? "green" : "amber"}>{t(`status.${u.status}`)}</Badge>],
            [t("payee"), u.payeeAccount ?? "—"],
            [t("training"), training.length ? training.map((x) => x.module).join(", ") : "—"],
          ]}
        />
      </Card>
      {!self ? (
        <div className="grid gap-3 md:grid-cols-3">
          <Card>
            <form action={reenrollUserAction} className="flex flex-col gap-2">
              <IdemKey />
              <input type="hidden" name="userId" value={u.id} />
              <button type="submit" className="btn btn-primary" data-testid="reenroll">
                {t("reenroll")}
              </button>
              <p className="text-xs text-stone-600">{t("reenrollNote")}</p>
            </form>
          </Card>
          <Card>
            <form action={lockUserAction} className="flex flex-col gap-2">
              <IdemKey />
              <input type="hidden" name="userId" value={u.id} />
              <input name="reason" className="field" placeholder="Reason" maxLength={200} />
              <button type="submit" className="btn btn-danger">
                {t("lock")}
              </button>
            </form>
          </Card>
          <Card>
            <form action={suspendUserAction} className="flex flex-col gap-2">
              <IdemKey />
              <input type="hidden" name="userId" value={u.id} />
              <input type="hidden" name="suspend" value={u.status === "SUSPENDED" ? "false" : "true"} />
              <button type="submit" className="btn btn-secondary">
                {u.status === "SUSPENDED" ? t("unsuspend") : t("suspend")}
              </button>
            </form>
          </Card>
        </div>
      ) : null}
    </>
  );
}
