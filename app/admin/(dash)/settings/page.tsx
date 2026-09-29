import { getTranslations } from "next-intl/server";
import { Card, Check, Field, IdemKey, PrimaryButton } from "@/components/ui";
import { Notice } from "@/components/notice";
import { requireAdmin } from "@/lib/auth/current";
import { SETTING_DEFAULTS, getSetting, type SettingKey } from "@/lib/services/core";
import { referenceData } from "@/lib/services/admin";
import { getDb } from "@/lib/db/client";
import { flags, type SearchParams } from "@/lib/actions";
import { approveEducationPackAction, productAvailabilityAction, settingChangeAction } from "../actions";
import { aiUsageThisMonth, educationPackApproved, loadEducationPack } from "@/lib/services/ai-gateway";
import { appEnv, aiEnabled, paymentProviderId, smsProviderId, chainNetwork } from "@/lib/env";
import { dataKeyStatus } from "@/lib/crypto/envelope";

export default async function SettingsPage({ searchParams }: { searchParams: SearchParams }) {
  const { actor } = await requireAdmin();
  const t = await getTranslations("admin.settings");
  const { error, ok } = await flags(searchParams);
  const keys = Object.keys(SETTING_DEFAULTS) as SettingKey[];
  const values = await Promise.all(keys.map(async (k) => [k, await getSetting(k)] as const));
  const ref = await referenceData(actor);
  const avail = await getDb().query.productAreaAvailability.findMany();
  const usage = await aiUsageThisMonth();
  const { pack } = loadEducationPack();
  const packApproved = await educationPackApproved();
  return (
    <>
      <h1 className="text-2xl font-bold">{t("title")}</h1>
      <p className="text-sm text-stone-600">{t("note")}</p>
      <Notice error={error} ok={ok} />
      <Card>
        <h2 className="mb-2 font-semibold">Environment</h2>
        <ul className="text-sm">
          <li>env: {appEnv()}</li>
          <li>payment provider: {paymentProviderId()}</li>
          <li>sms provider: {smsProviderId()}</li>
          <li>chain: {chainNetwork()}</li>
          <li>AI: {aiEnabled() ? "on" : "off"}</li>
          <li>data key: {dataKeyStatus()}</li>
        </ul>
        <p className="mt-2 text-sm">{t("aiUsage", { calls: usage.calls, cost: usage.costCents, accepted: usage.accepted, rejected: usage.rejected })}</p>
        <p className="mt-1 text-sm">{t("packStatus", { version: pack.version, status: packApproved ? "approved" : "not approved" })}</p>
        {!packApproved ? (
          <form action={approveEducationPackAction} className="mt-2 w-full md:w-96">
            <IdemKey />
            <button type="submit" className="btn btn-secondary">
              {t("approvePack")}
            </button>
          </form>
        ) : null}
      </Card>
      <Card>
        <table className="w-full text-sm">
          <tbody className="divide-y divide-stone-100">
            {values.map(([k, v]) => (
              <tr key={k}>
                <td className="py-2 font-mono">{k}</td>
                <td className="py-2">{String(v)}</td>
                <td className="py-2">
                  <form action={settingChangeAction} className="flex gap-2">
                    <IdemKey />
                    <input type="hidden" name="key" value={k} />
                    <input name="value" className="field" defaultValue={String(v)} aria-label={`new value for ${k}`} />
                    <button type="submit" className="btn btn-secondary w-40">
                      {t("propose")}
                    </button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <Card>
        <h2 className="mb-2 font-semibold">Product availability (WASH)</h2>
        <ul className="mb-3 text-sm">
          {avail.map((a) => (
            <li key={`${a.productId}-${a.serviceAreaId}`}>
              {ref.products.find((p) => p.id === a.productId)?.name} @ {ref.areas.find((x) => x.id === a.serviceAreaId)?.name}: {a.available ? "available" : "unavailable"}, WASH {a.washConditionsConfirmed ? "confirmed" : "not confirmed"}
            </li>
          ))}
        </ul>
        <form action={productAvailabilityAction} className="grid gap-2 md:grid-cols-4">
          <IdemKey />
          <Field label="Product" htmlFor="productId">
            <select id="productId" name="productId" className="field">
              {ref.products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Area" htmlFor="serviceAreaId">
            <select id="serviceAreaId" name="serviceAreaId" className="field">
              {ref.areas.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </Field>
          <div className="flex flex-col gap-1">
            <Check name="available" label="Available" defaultChecked />
            <Check name="washConditionsConfirmed" label="WASH conditions confirmed" />
          </div>
          <div className="self-end">
            <PrimaryButton>{t("propose")}</PrimaryButton>
          </div>
        </form>
      </Card>
    </>
  );
}
