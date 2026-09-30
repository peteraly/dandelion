/**
 * Data requests: a deletion tombstones the phone number, and open orders still
 * need that number (codes, receipts, reminders), so the deletion is refused
 * until they are finished — for a customer and for a stakeholder alike.
 */
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { getDb } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import { actors, ids, lastSms } from "./helpers";
import { createDataRequest, handleDataRequest, openDataRequests } from "@/lib/services/admin";
import { createCustomer, verifyCustomerPhone } from "@/lib/services/customers";
import { startPlan } from "@/lib/services/orders";
import type { Actor } from "@/lib/policy";

async function enrol(seller: Actor, name: string, phone: string): Promise<string> {
  const { customerId, challengeId } = await createCustomer(seller, { displayName: name, phone, consentMessages: true, consentReminders: true }, "test-device", "127.0.0.1");
  const otp = (await lastSms("OTP"))!.body.match(/\b(\d{6})\b/)![1]!;
  await verifyCustomerPhone(seller, customerId, challengeId, otp);
  return customerId;
}

async function requestDeletion(admin: Actor, subjectType: "USER" | "CUSTOMER", subjectId: string): Promise<string> {
  await createDataRequest(admin, { kind: "DELETION", subjectType, subjectId, details: "Asked for deletion (TEST)" });
  const req = (await openDataRequests(admin)).find((r) => r.subjectId === subjectId && r.status === "OPEN");
  if (!req) throw new Error("request not open");
  return req.id;
}

describe("deletion requests and open orders", () => {
  it("refuses to delete a customer with an open plan, or the seller of one, until the plan is finished", async () => {
    const champion = await actors.champion();
    const admin = await actors.adminA();
    const { kit } = await ids();
    const customerId = await enrol(champion, "Deletion with plan (TEST)", "+255700009970");
    await startPlan(champion, customerId, kit.id);

    const forCustomer = await requestDeletion(admin, "CUSTOMER", customerId);
    await expect(handleDataRequest(admin, forCustomer, "DONE", "Records anonymised")).rejects.toMatchObject({ code: "subject_has_open_orders" });
    const customer = (await getDb().query.customers.findFirst({ where: eq(s.customers.id, customerId) }))!;
    expect(customer.status).toBe("ACTIVE");
    expect(customer.displayName).toBe("Deletion with plan (TEST)");
    // The request stays open; declining it is always possible.
    await handleDataRequest(admin, forCustomer, "DECLINED", "Plan still running; asked again later");
    expect((await openDataRequests(admin)).find((r) => r.id === forCustomer)?.status).toBe("DECLINED");

    const forSeller = await requestDeletion(admin, "USER", champion.userId);
    await expect(handleDataRequest(admin, forSeller, "DONE", "Left the programme")).rejects.toMatchObject({ code: "subject_has_open_orders" });
    expect((await getDb().query.users.findFirst({ where: eq(s.users.id, champion.userId) }))!.status).toBe("ACTIVE");
  });

  it("deletes a customer without open orders: name and phone tombstoned, status DELETED", async () => {
    const champion = await actors.champion();
    const admin = await actors.adminA();
    const customerId = await enrol(champion, "Deletion without plan (TEST)", "+255700009971");
    const id = await requestDeletion(admin, "CUSTOMER", customerId);
    await handleDataRequest(admin, id, "DONE", "Records anonymised per policy");
    const customer = (await getDb().query.customers.findFirst({ where: eq(s.customers.id, customerId) }))!;
    expect(customer.status).toBe("DELETED");
    expect(customer.displayName).toBe("[deleted]");
    expect(customer.phoneEnc.startsWith("deleted-")).toBe(true);
  });
});
