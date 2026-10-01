/**
 * Prompt M on a real database — prevented, not settled; cleared by itself, not by hand:
 * a batch cannot leave unless packed waterproof; in the rainy months a pickup needs a rain cover; a payment claim that
 * never turns into money lapses by itself with one SMS (and late money still confirms); shop numbers that never
 * confirmed are forgotten; shop sign-in codes are capped per hour, with an alarm.
 */
import { and, eq, sql } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { getDb } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import { SEED } from "@/scripts/seed";
import { setClock } from "@/lib/clock-override";
import { simulate } from "@/lib/payments/simulator";
import { tzDay } from "@/lib/util/time";
import { putSetting } from "@/lib/services/core";
import { updateAreaRains } from "@/lib/services/areas";
import { acceptPickup, adminCreatePickup, claimPaid, confirmBatchReady, pickupNeedsRainCover } from "@/lib/services/orders";
import { lapseStaleClaims, forgetUnconfirmedShopNumbers } from "@/lib/services/self-heal";
import { runDailyReconciliation } from "@/lib/services/reconciliation";
import { joinShop, startShopSignIn } from "@/lib/services/shop";
import { actors, ids, lastSms, order, userByPhone } from "./helpers";

const OPTS = { deviceId: null, ip: "127.0.0.1", openDemo: false };

async function newPickup(quantity = 5) {
  const { supplier, hub, kit } = await ids();
  const rider = await userByPhone(SEED.riders[0]!.phone);
  return (await adminCreatePickup(await actors.adminA(), { supplierId: supplier.id, productId: kit.id, hubId: hub.id, riderId: rider.id, quantity, pickupDate: tzDay() })).orderId;
}

describe("prevented, and cleared by itself", () => {
  afterEach(() => setClock(null));

  it("a batch leaves only packed waterproof; in the rainy months a pickup needs a rain cover", async () => {
    const id = await newPickup();
    await expect(confirmBatchReady(await actors.supplier(), id, "SEAL-SH-1", { packedWaterproof: false })).rejects.toMatchObject({ code: "packing_not_confirmed" });
    await confirmBatchReady(await actors.supplier(), id, "SEAL-SH-1", { packedWaterproof: true });
    const o = await order(id);
    expect((await getDb().query.batches.findFirst({ where: eq(s.batches.id, o.batchId!) }))!.packedWaterproofAt).not.toBeNull();

    // Every month rainy for this test: the rider must confirm a rain cover.
    const { area } = await ids();
    await updateAreaRains(await actors.adminA(), area.id, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(await pickupNeedsRainCover(getDb(), o)).toBe(true);
    await expect(acceptPickup(await actors.rider(), id)).rejects.toMatchObject({ code: "rain_cover_required" });
    await acceptPickup(await actors.rider(), id, { rainCover: true });
    expect((await order(id)).rainCoverAt).not.toBeNull();
    await updateAreaRains(await actors.adminA(), area.id, []);
  });

  it("a payment claim that never arrives lapses by itself, with one SMS; money that comes later still confirms", async () => {
    const id = await newPickup();
    await confirmBatchReady(await actors.supplier(), id, "SEAL-SH-2", { packedWaterproof: true });
    await acceptPickup(await actors.rider(), id);
    await claimPaid(await actors.rider(), id);
    expect(await lapseStaleClaims()).toEqual({ lapsed: 0 }); // too soon
    setClock(new Date(Date.now() + 25 * 3_600_000));
    expect((await lapseStaleClaims()).lapsed).toBeGreaterThanOrEqual(1);
    const o = await order(id);
    expect((await lastSms("NOTICE"))!.body).toContain(o.ref);
    const intent = (await getDb().query.paymentIntents.findFirst({ where: and(eq(s.paymentIntents.orderId, id), eq(s.paymentIntents.status, "PAYMENT_PENDING")) }))!;
    expect(intent.payerClaimedAt).toBeNull();
    // Nothing for an admin: no "pending too long" flag after the night's reconciliation.
    await runDailyReconciliation();
    const flags = await getDb().execute<{ n: string }>(sql`select count(*)::text as n from reconciliation_flags where order_id = ${id} and resolved_at is null`);
    expect(flags.rows[0]!.n).toBe("0");
    setClock(null);
    // The money arrives after all: matched as usual.
    expect((await simulate("success", o.ref)).outcomes).toContain("CONFIRMED");
  });

  it("shop numbers that never confirmed are forgotten after 7 days", async () => {
    const meetingPointId = (await getDb().query.meetingPoints.findFirst())!.id;
    // The shop opens on the ladder (local sellers at the hub), so a number can join.
    await joinShop({ displayName: "Unconfirmed", phone: "+255700009870", meetingPointId, consentMessages: true, consentReminders: false }, OPTS);
    expect((await forgetUnconfirmedShopNumbers()).forgotten).toBe(0);
    setClock(new Date(Date.now() + 8 * 86_400_000));
    expect((await forgetUnconfirmedShopNumbers()).forgotten).toBe(1);
    const c = await getDb().execute<{ n: string }>(sql`select count(*)::text as n from customers where display_name = 'Unconfirmed'`);
    expect(c.rows[0]!.n).toBe("0");
  });

  it("shop sign-in codes are capped per hour, with one alarm", async () => {
    await putSetting(getDb(), "shopCodeSmsPerHour", 3, null);
    await putSetting(getDb(), "shopCodeSmsAlarm", 2, null);
    const base = Number((await getDb().execute<{ n: string }>(sql`select count(*)::text as n from otp_challenges where purpose = 'CUSTOMER_LOGIN' and created_at > now() - interval '1 hour'`)).rows[0]!.n);
    const left = Math.max(0, 3 - base);
    for (let i = 0; i < left; i++) await startShopSignIn(`+2557000098${60 + i}`, OPTS);
    await expect(startShopSignIn("+255700009869", OPTS)).rejects.toMatchObject({ code: "shop_busy" });
    const alarms = await getDb().execute<{ n: string }>(sql`select count(*)::text as n from security_event_log where type = 'SHOP_CODE_SURGE'`);
    expect(alarms.rows[0]!.n).toBe("1");
    await putSetting(getDb(), "shopCodeSmsPerHour", 100, null);
    await putSetting(getDb(), "shopCodeSmsAlarm", 50, null);
  });
});
