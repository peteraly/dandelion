/**
 * Prompt B §3.6 (integration, minimal seed): the snapshot parses, its
 * counts match direct SQL and the admin priorities, it carries no phone
 * number or customer name, and the view is logged once per session per day.
 */
import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { getDb } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import { actors, ids, userByPhone } from "./helpers";
import { SEED } from "@/scripts/seed";
import { containsPhone, ecosystemSnapshot, logEcosystemView, SnapshotSchema } from "@/lib/services/ecosystem";
import { priorities } from "@/lib/services/admin";
import { adminCreatePickup } from "@/lib/services/orders";
import { tzDay } from "@/lib/util/time";

describe("ecosystem snapshot", () => {
  it("parses, and its counts match the database", async () => {
    const admin = await actors.adminA();
    const { supplier, hub, kit } = await ids();
    const rider = await userByPhone(SEED.riders[0]!.phone);
    await adminCreatePickup(admin, { supplierId: supplier.id, productId: kit.id, hubId: hub.id, riderId: rider.id, quantity: 12, pickupDate: tzDay() });
    const snap = await ecosystemSnapshot(admin, { window: "7d" });
    expect(SnapshotSchema.safeParse(snap).success).toBe(true);
    const count = async (q: string) => Number((await getDb().execute<{ n: string }>(sql.raw(`select count(*)::text as n from ${q}`))).rows[0]!.n);
    expect(snap.nodes.filter((n) => n.kind === "HUB").length).toBe(await count("hubs"));
    expect(snap.nodes.filter((n) => n.kind === "SUPPLIER").length).toBe(await count("suppliers"));
    expect(snap.nodes.filter((n) => n.kind === "RIDER").length).toBe(await count("users where role = 'BOSS_RIDER' and status <> 'REMOVED'"));
    expect(snap.nodes.filter((n) => n.kind === "CHAMPION").length).toBe(await count("users where role = 'FIELD_CHAMPION' and status <> 'REMOVED'"));
    const customersNode = snap.nodes.find((n) => n.kind === "CUSTOMERS");
    expect(customersNode?.customers?.count).toBe(await count("customers where status = 'ACTIVE'"));
    expect(snap.openOrders.length).toBe(await count("orders where state not in ('COMPLETED','CANCELLED','CLOSED')"));
    const pickupEdge = snap.edges.find((e) => e.kind === "SUPPLIER_TO_RIDER");
    expect(pickupEdge?.units).toBeGreaterThanOrEqual(12);
    expect(pickupEdge?.paymentState).toBe("pending");
    const hubNode = snap.nodes.find((n) => n.kind === "HUB")!;
    expect(hubNode.hub?.minStockUnits).toBe(10);
    expect(hubNode.hub?.pendingIn).toBeGreaterThanOrEqual(1);
    expect(hubNode.href).toBe("/admin/inventory");
    expect(snap.system.seedProfile).toBe("minimal");
    expect(snap.system.demo).toBe(false);
    expect(snap.feed.length).toBeGreaterThan(0);
    expect(snap.feed.some((f) => f.source === "admin" && f.labelKey === "pickup_create")).toBe(true);
  });

  it("attention counts agree with the admin priorities", async () => {
    const admin = await actors.adminA();
    const snap = await ecosystemSnapshot(admin, { window: "24h" });
    const p = await priorities(admin);
    expect(snap.attention.paymentReviews).toBe(p.paymentsReview);
    expect(snap.attention.approvalsWaiting).toBe(p.pendingApprovals);
    expect(snap.attention.openExceptions).toBe(p.openExceptions);
    expect(snap.attention.reconFlags).toBe(p.reconFlags);
    expect(snap.attention.hubsBelowMin).toBe(p.lowStockHubs);
  });

  it("carries no phone number and no customer name", async () => {
    const admin = await actors.adminA();
    const text = JSON.stringify(await ecosystemSnapshot(admin, { window: "30d" }));
    expect(containsPhone(text)).toBe(false);
    for (const c of await getDb().select({ n: s.customers.displayName }).from(s.customers)) expect(text).not.toContain(c.n);
    expect(text).toContain(SEED.hub.name); // stakeholders appear by display name
  });

  it("filters by area and by hub", async () => {
    const admin = await actors.adminA();
    const { area, hub } = await ids();
    const byArea = await ecosystemSnapshot(admin, { window: "24h", areaId: area.id });
    expect(byArea.filters.areaId).toBe(area.id);
    expect(byArea.nodes.some((n) => n.kind === "HUB" && n.id === `hub:${hub.id}`)).toBe(true);
    const byHub = await ecosystemSnapshot(admin, { window: "24h", hubId: hub.id });
    expect(byHub.nodes.filter((n) => n.kind === "HUB").length).toBe(1);
    const byOther = await ecosystemSnapshot(admin, { window: "24h", hubId: "00000000-0000-0000-0000-000000000000" });
    expect(byOther.nodes.filter((n) => n.kind === "HUB" || n.kind === "CHAMPION").length).toBe(0);
  });

  it("is admin-only and logged once per session per day", async () => {
    await expect(ecosystemSnapshot(await actors.supplier(), { window: "24h" })).rejects.toThrow(/forbidden/);
    const admin = await actors.adminA();
    const sessionId = `test-session-${Date.now()}`;
    expect(await logEcosystemView(admin, sessionId)).toBe(true);
    expect(await logEcosystemView(admin, sessionId)).toBe(false);
    expect(await logEcosystemView(admin, `${sessionId}-b`)).toBe(true);
    const rows = await getDb().query.adminActionLog.findMany({ where: eq(s.adminActionLog.action, "ecosystem.view") });
    expect(rows.filter((r) => r.targetId === sessionId).length).toBe(1);
  });
});
