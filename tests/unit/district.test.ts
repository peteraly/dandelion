/**
 * Prompt B §9.3: the district map's layout is a pure function — every node
 * gets exactly one tile, edges reference existing tiles, areas never overlap,
 * attention chips point at the right tiles, and the markers move with time.
 */
import { describe, expect, it } from "vitest";
import { bezierAt, layoutDistrict, MAX_MARKERS_PER_EDGE, orderStage, stagePosition, STAGES, type Tile } from "@/lib/ecosystem/district";
import type { EcoEdge, EcoNode, OpenOrder, RecentPayment } from "@/lib/services/ecosystem";

function node(partial: Partial<EcoNode> & Pick<EcoNode, "id" | "kind" | "name">): EcoNode {
  return { status: "active", areaId: "A", areaName: "Area A", hubId: null, lastActivityAt: "2026-09-30T06:00:00.000Z", href: "/admin", stock: null, hub: null, champion: null, supplier: null, customers: null, organisation: null, earnedTzs: null, ...partial };
}
function edge(partial: Partial<EcoEdge> & Pick<EcoEdge, "kind" | "fromId" | "toId">): EcoEdge {
  return { count: 1, units: 10, expectedTzs: 1000, confirmedTzs: 0, oldestDays: 0, inReview: 0, onHold: 0, awaitingConfirmation: 0, paymentState: "pending", ...partial };
}
let seq = 0;
function order(partial: Partial<OpenOrder> & Pick<OpenOrder, "kind" | "state" | "fromId" | "toId">): OpenOrder {
  seq++;
  const id = `00000000-0000-4000-8000-${String(seq).padStart(12, "0")}`;
  return { id, ref: `OR-${seq}`, fromName: "", toName: "", units: 20, totalTzs: 1000, confirmedTzs: 0, ageDays: 0, paymentState: "pending", hubId: null, ...partial };
}
const stock = (units: number, lockedUnits = 0) => ({ units, byState: {}, lockedUnits, oldestBatchDays: null });

const AS_OF = "2026-09-30T08:00:00.000Z";
const areas = [
  { id: "A", name: "Area A" },
  { id: "B", name: "Area B" },
];
const nodes: EcoNode[] = [
  node({ id: "supplier:s1", kind: "SUPPLIER", name: "Factory", supplier: { waitingPastLeadTime: 1, qualityShare: 0.5, qualityBatches: 4, confirmedTzs: 50_000 }, stock: stock(0) }),
  node({ id: "user:r1", kind: "RIDER", name: "Rider One", stock: stock(12), earnedTzs: 3_900 }),
  node({ id: "hub:h1", kind: "HUB", name: "Hub One", hubId: "h1", stock: stock(40, 5), hub: { minStockUnits: 50, available: 40, manager: "M", pendingIn: 1, pendingOut: 2 } }),
  node({ id: "hub:h2", kind: "HUB", name: "Hub Two", hubId: "h2", stock: stock(80), hub: { minStockUnits: 50, available: 80, manager: "N", pendingIn: 0, pendingOut: 0 } }),
  node({ id: "user:c1", kind: "CHAMPION", name: "Champion One", hubId: "h1", stock: stock(3), champion: { customers: 5, activePlans: 2, stalledPlans: 1, lastSaleAt: null }, lastActivityAt: "2026-09-01T06:00:00.000Z" }),
  node({ id: "user:c2", kind: "CHAMPION", name: "Champion Two", hubId: "h1", stock: stock(0), champion: { customers: 2, activePlans: 1, stalledPlans: 0, lastSaleAt: null } }),
  node({ id: "user:c3", kind: "CHAMPION", name: "Champion Three", hubId: "h2", stock: stock(6), champion: { customers: 4, activePlans: 3, stalledPlans: 0, lastSaleAt: null } }),
  node({ id: "customers:h1", kind: "CUSTOMERS", name: "Hub One", hubId: "h1", customers: { count: 7, activePlans: 3, handoverPending: 1 } }),
  node({ id: "customers:h2", kind: "CUSTOMERS", name: "Hub Two", hubId: "h2", customers: { count: 4, activePlans: 3, handoverPending: 0 } }),
  node({ id: "customers:area:A", kind: "CUSTOMERS", name: "Area A · direct", customers: { count: 3, activePlans: 2, handoverPending: 0 } }),
  node({ id: "org:o1", kind: "ORGANISATION", name: "Tumaini School", organisation: { kind: "SCHOOL", openOrders: 1, confirmedTzs: 0 } }),
  // A second area with its own hub and a champion whose hub is unknown here.
  node({ id: "supplier:s2", kind: "SUPPLIER", name: "Factory B", areaId: "B", areaName: "Area B", supplier: { waitingPastLeadTime: 0, qualityShare: 0, qualityBatches: 0, confirmedTzs: 0 } }),
  node({ id: "hub:h3", kind: "HUB", name: "Hub Three", areaId: "B", areaName: "Area B", hubId: "h3", stock: stock(10), hub: { minStockUnits: 5, available: 10, manager: null, pendingIn: 0, pendingOut: 0 } }),
  node({ id: "user:c4", kind: "CHAMPION", name: "Stray", areaId: "B", areaName: "Area B", hubId: "gone", champion: { customers: 0, activePlans: 0, stalledPlans: 0, lastSaleAt: null } }),
];
const edges: EcoEdge[] = [
  edge({ kind: "SUPPLIER_TO_RIDER", fromId: "supplier:s1", toId: "user:r1", count: 2, units: 40, oldestDays: 2 }),
  edge({ kind: "RIDER_TO_HUB", fromId: "user:r1", toId: "hub:h1", paymentState: "confirmed", confirmedTzs: 1000 }),
  edge({ kind: "HUB_TO_CHAMPION", fromId: "hub:h1", toId: "user:c1", inReview: 1, paymentState: "review" }),
  edge({ kind: "CHAMPION_TO_CUSTOMER", fromId: "user:c1", toId: "customers:h1" }),
  edge({ kind: "RIDER_TO_CUSTOMER", fromId: "user:r1", toId: "customers:area:A" }),
  edge({ kind: "SUPPLIER_TO_ORG", fromId: "supplier:s1", toId: "org:o1" }),
  edge({ kind: "HUB_TO_ORG", fromId: "hub:h1", toId: "org:missing" }),
];

const orders: OpenOrder[] = [
  // Two open pickups: one being prepared at the factory, one paid and being handed over there.
  order({ kind: "SUPPLIER_TO_RIDER", state: "PICKUP_ASSIGNED", fromId: "supplier:s1", toId: "user:r1" }),
  order({ kind: "SUPPLIER_TO_RIDER", state: "PAID", fromId: "supplier:s1", toId: "user:r1", paymentState: "confirmed" }),
  // A delivery on the road and one at inspection.
  order({ kind: "RIDER_TO_HUB", state: "EN_ROUTE", fromId: "user:r1", toId: "hub:h1" }),
  order({ kind: "RIDER_TO_HUB", state: "INSPECTING", fromId: "user:r1", toId: "hub:h1" }),
  // Hand-carried: a restock being paid for, a customer plan (no marker), a plan paid in full.
  order({ kind: "HUB_TO_CHAMPION", state: "AWAITING_PAYMENT", fromId: "hub:h1", toId: "user:c1", paymentState: "review" }),
  order({ kind: "CHAMPION_TO_CUSTOMER", state: "PLAN_ACTIVE", fromId: "user:c1", toId: "customers:h1" }),
  order({ kind: "CHAMPION_TO_CUSTOMER", state: "FULLY_PAID", fromId: "user:c1", toId: "customers:h1", paymentState: "confirmed" }),
  // An order whose edge is not on the map (organisation missing) gets no marker.
  order({ kind: "HUB_TO_ORG", state: "AWAITING_PAYMENT", fromId: "hub:h1", toId: "org:missing" }),
];
const payments: RecentPayment[] = [
  { id: "p1", at: "2026-09-30T07:40:00.000Z", orderId: "x", ref: "OR-p1", kind: "SUPPLIER_TO_RIDER", fromId: "supplier:s1", toId: "user:r1", amountTzs: 120_000 },
  { id: "p2", at: "2026-09-30T07:50:00.000Z", orderId: "y", ref: "OR-p2", kind: "RIDER_TO_HUB", fromId: "supplier:s1", toId: "user:r1", amountTzs: 30_000 },
  { id: "p3", at: "2026-09-30T07:55:00.000Z", orderId: "z", ref: "OR-p3", kind: "HUB_TO_ORG", fromId: "hub:h1", toId: "org:missing", amountTzs: 5_000 },
];

const overlaps = (a: Tile, b: Tile) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

describe("district layout", () => {
  const lay = layoutDistrict({ nodes, edges, areas, asOf: AS_OF, orders, payments });

  it("gives every node exactly one tile, in its own area's band, with no two tiles overlapping", () => {
    expect(lay.unplaced).toEqual([]);
    expect(lay.tiles.map((t) => t.id).sort()).toEqual(nodes.map((n) => n.id).sort());
    expect(new Set(lay.tiles.map((t) => t.id)).size).toBe(nodes.length);
    for (const t of lay.tiles) {
      const band = lay.bands.find((b) => b.id === t.areaId)!;
      expect(t.areaId).toBe(t.node.areaId);
      expect(t.y).toBeGreaterThanOrEqual(band.y);
      expect(t.y + t.h).toBeLessThanOrEqual(band.y + band.h);
      expect(t.x + t.w).toBeLessThanOrEqual(lay.width);
    }
    for (const a of lay.tiles) for (const b of lay.tiles) if (a !== b) expect(overlaps(a, b), `${a.id} vs ${b.id}`).toBe(false);
  });

  it("lays the bands out top to bottom without overlap and reads left to right: factory, riders, hubs, organisations", () => {
    expect(lay.bands.map((b) => b.id)).toEqual(["A", "B"]);
    expect(lay.bands[1]!.y).toBeGreaterThan(lay.bands[0]!.y + lay.bands[0]!.h);
    expect(lay.height).toBeGreaterThan(lay.bands[1]!.y + lay.bands[1]!.h - 1);
    const x = (id: string) => lay.tiles.find((t) => t.id === id)!.x;
    expect(x("supplier:s1")).toBeLessThan(x("user:r1"));
    expect(x("user:r1")).toBeLessThan(x("hub:h1"));
    expect(x("hub:h1")).toBeLessThan(x("hub:h2"));
    expect(x("hub:h2")).toBeLessThan(x("org:o1"));
    expect(x("org:o1")).toBe(x("customers:area:A"));
    // Kiosks and the customers block sit under their hub, on the same column.
    expect(x("user:c1")).toBe(x("hub:h1"));
    expect(x("customers:h1")).toBe(x("hub:h1"));
    expect(lay.tiles.find((t) => t.id === "customers:h1")!.y).toBeGreaterThan(lay.tiles.find((t) => t.id === "user:c2")!.y);
    // A champion whose hub is not on the map still gets a tile (under the riders' stand).
    expect(x("user:c4")).toBe(lay.tiles.find((t) => t.id === "user:r1")!.x);
    // Hubs sit on the road.
    const band = lay.bands[0]!;
    const hub = lay.tiles.find((t) => t.id === "hub:h1")!;
    expect(hub.y).toBeLessThan(band.roadY);
    expect(hub.y + hub.h).toBeGreaterThan(band.roadY);
  });

  it("draws an edge only between tiles that exist, dashed for direct paths, thickest where most units move", () => {
    expect(lay.edges.map((l) => l.edge.kind).sort()).toEqual(["CHAMPION_TO_CUSTOMER", "HUB_TO_CHAMPION", "RIDER_TO_CUSTOMER", "RIDER_TO_HUB", "SUPPLIER_TO_ORG", "SUPPLIER_TO_RIDER"]);
    const byKind = Object.fromEntries(lay.edges.map((l) => [l.edge.kind, l]));
    expect(byKind.SUPPLIER_TO_ORG!.direct).toBe(true);
    expect(byKind.RIDER_TO_CUSTOMER!.direct).toBe(true);
    expect(byKind.RIDER_TO_HUB!.direct).toBe(false);
    expect(byKind.SUPPLIER_TO_RIDER!.width).toBeGreaterThan(byKind.RIDER_TO_HUB!.width);
  });

  it("puts every moving open order on the map exactly once, a motorbike when a delivery partner carries it, ringed by the most urgent payment", () => {
    const byRef = Object.fromEntries(orders.map((o) => [o.ref, o]));
    // Plans being paid off are not moving; an order whose edge is off the map has nowhere to go.
    const onMap = lay.markers.flatMap((m) => m.items.map((it) => it.ref));
    expect(onMap.sort()).toEqual(orders.filter((_, i) => i !== 5 && i !== 7).map((o) => o.ref).sort());
    for (const m of lay.markers) {
      expect(m.units).toBe(m.items.reduce((a, it) => a + it.units, 0));
      for (const it of m.items) {
        const o = byRef[it.ref]!;
        expect(it.orderId).toBe(o.id);
        expect(it.stage).toBe(orderStage(o.state));
        expect(it.paymentState).toBe(o.paymentState);
      }
      expect(m.carrier).toBe(m.kind.startsWith("RIDER_") || m.kind === "SUPPLIER_TO_RIDER" ? "moto" : "box");
      expect(m.paymentState).toBe(["hold", "review", "pending", "confirmed"].find((st) => m.items.some((it) => it.paymentState === st)));
    }
  });

  it("places orders by where they are: waiting at the sender's door, on the road, or at the receiver's door; a busy door is one marker with a count", () => {
    const mk = (i: number) => lay.markers.find((x) => x.items.some((it) => it.ref === orders[i]!.ref))!;
    const tile = (id: string) => lay.tiles.find((t) => t.id === id)!;
    const factory = tile("supplier:s1");
    const rider = tile("user:r1");
    const hub = tile("hub:h1");
    // Both pickups wait at the factory: one marker holding both, which opens the factory.
    expect(mk(0)).toBe(mk(1));
    expect(mk(0).items).toHaveLength(2);
    expect(mk(0).at).toBe("supplier:s1");
    expect(mk(0).paymentState).toBe("pending"); // one confirmed, one pending: the pending one is what needs watching
    expect(mk(0).x).toBeGreaterThan(factory.x + factory.w);
    expect(mk(0).x).toBeLessThan(rider.x);
    expect(mk(0).x - (factory.x + factory.w)).toBeLessThan(rider.x - mk(0).x);
    // The one at inspection sits alone at the hub's door; the one on the road between the stand and the hub.
    expect(mk(3).items).toHaveLength(1);
    expect(mk(3).x).toBeLessThan(hub.x);
    expect(hub.x - mk(3).x).toBeLessThan(40);
    expect(mk(2).x).toBeGreaterThan(rider.x + rider.w);
    expect(mk(2).x).toBeLessThan(hub.x);
    expect(mk(2)).not.toBe(mk(3));
    // No marker sits inside a tile, and no two markers overlap.
    for (const x of lay.markers) for (const t of lay.tiles) expect(x.x > t.x + 2 && x.x < t.x + t.w - 2 && x.y > t.y + 2 && x.y < t.y + t.h - 2, `${x.ref} inside ${t.id}`).toBe(false);
    for (const a of lay.markers) for (const b of lay.markers) if (a !== b) expect(Math.hypot(a.x - b.x, a.y - b.y), `${a.key} vs ${b.key}`).toBeGreaterThanOrEqual(a.r + b.r);
  });

  it("gives every state a place, and only plans being paid off none", () => {
    for (const st of STAGES) expect(stagePosition("RIDER_TO_HUB", st) === null).toBe(st === "plan");
    expect(orderStage("PLAN_ACTIVE")).toBe("plan");
    expect(orderStage("EN_ROUTE")).toBe("road");
    expect(stagePosition("RIDER_TO_HUB", "paying")).toBeGreaterThan(0.8); // the hub pays after inspection, at its door
    expect(stagePosition("SUPPLIER_TO_RIDER", "paying")).toBeLessThan(0.3); // the rider pays at the factory
  });

  it("draws at most a few markers per edge and says how many more there are", () => {
    const many = Array.from({ length: MAX_MARKERS_PER_EDGE + 3 }, () => order({ kind: "RIDER_TO_HUB", state: "EN_ROUTE", fromId: "user:r1", toId: "hub:h1" }));
    const busy = layoutDistrict({ nodes, edges, areas, asOf: AS_OF, orders: many });
    expect(busy.markers).toHaveLength(MAX_MARKERS_PER_EDGE);
    expect(busy.overflow).toHaveLength(1);
    expect(busy.overflow[0]!.more).toBe(3);
  });

  it("moves only the orders on the road as the clock advances, and keeps everything still for the same moment", () => {
    const again = layoutDistrict({ nodes, edges, areas, asOf: AS_OF, orders, payments });
    expect(again.markers.map((m) => [m.x, m.y])).toEqual(lay.markers.map((m) => [m.x, m.y]));
    const later = layoutDistrict({ nodes, edges, areas, asOf: "2026-09-30T08:00:30.000Z", orders, payments });
    for (const m of later.markers) {
      const before = lay.markers.find((x) => x.key === m.key)!;
      if (m.stage === "road") expect(m.progress).not.toBe(before.progress);
      else expect([m.x, m.y]).toEqual([before.x, before.y]);
      expect(m.progress).toBeGreaterThanOrEqual(0);
      expect(m.progress).toBeLessThan(1);
    }
  });

  it("puts a coin on each place the provider paid in the last hour, summed, and none for places not on the map", () => {
    expect(lay.coins).toHaveLength(2);
    const factory = lay.coins.find((c) => c.tileId === "supplier:s1")!;
    expect(factory.amountTzs).toBe(150_000);
    expect(factory.count).toBe(2);
    expect(factory.latestAt).toBe("2026-09-30T07:50:00.000Z");
    expect(lay.coins.find((c) => c.tileId === "hub:h1")!.amountTzs).toBe(5_000);
  });

  it("focuses a place: it and everyone it has open orders with stay bright, the rest go faint", () => {
    const f = layoutDistrict({ nodes, edges, areas, asOf: AS_OF, orders, payments, focus: "hub:h1" });
    const t = (id: string) => f.tiles.find((x) => x.id === id)!;
    expect(t("hub:h1").focused).toBe(true);
    expect(t("hub:h1").dim).toBe(false);
    expect(t("user:r1").dim).toBe(false); // delivering to it
    expect(t("user:c1").dim).toBe(false); // buying from it
    expect(t("supplier:s1").dim).toBe(true);
    expect(t("hub:h2").dim).toBe(true);
    for (const l of f.edges) expect(l.dim).toBe(!(l.edge.fromId === "hub:h1" || l.edge.toId === "hub:h1"));
    for (const m of f.markers) expect(m.dim).toBe(!(m.edgeKey.includes("|hub:h1|") || m.edgeKey.endsWith("|hub:h1")));
    expect(f.coins.find((c) => c.tileId === "supplier:s1")!.dim).toBe(true);
    // An unknown focus (a stale link) focuses nothing.
    const stale = layoutDistrict({ nodes, edges, areas, asOf: AS_OF, orders, focus: "user:gone" });
    expect(stale.tiles.every((x) => !x.dim && !x.focused)).toBe(true);
  });

  it("points the attention outline at the right tiles for each chip", () => {
    const flagged = (attention: Parameters<typeof layoutDistrict>[0]["attention"]) =>
      layoutDistrict({ nodes, edges, areas, attention, asOf: AS_OF })
        .tiles.filter((t) => t.attention)
        .map((t) => t.id)
        .sort();
    expect(flagged("hubsBelowMin")).toEqual(["hub:h1"]);
    expect(flagged("lockedBatches")).toEqual(["hub:h1"]);
    expect(flagged("silentNodes")).toEqual(["user:c1"]);
    expect(flagged("handoverPending")).toEqual(["customers:h1"]);
    expect(flagged("waitingOnSupplier")).toEqual(["supplier:s1"]);
    expect(flagged("supplierQuality")).toEqual(["supplier:s1"]);
    expect(flagged("orgOrdersUnpaid")).toEqual(["org:o1"]);
    expect(flagged("paymentReviews")).toEqual(["hub:h1", "user:c1"]);
    expect(flagged("paymentsPendingLong")).toEqual(["supplier:s1", "user:r1"]);
    expect(flagged("approvalsWaiting")).toEqual([]);
    expect(flagged("")).toEqual([]);
    // The padlock is independent of the chip.
    expect(lay.tiles.filter((t) => t.locked).map((t) => t.id)).toEqual(["hub:h1"]);
  });

  it("marks a place live when something happened there in the hour before the snapshot, never in the future", () => {
    const at = (iso: string) => node({ id: `user:${iso}`, kind: "RIDER", name: iso, lastActivityAt: iso });
    const lay = layoutDistrict({ nodes: [at("2026-09-30T07:30:00.000Z"), at("2026-09-30T06:59:00.000Z"), at("2026-09-30T08:10:00.000Z"), node({ id: "user:none", kind: "RIDER", name: "none", lastActivityAt: null })], edges: [], areas, asOf: AS_OF });
    const recent = Object.fromEntries(lay.tiles.map((x) => [x.node.name, x.recent]));
    expect(recent).toEqual({ "2026-09-30T07:30:00.000Z": true, "2026-09-30T06:59:00.000Z": false, "2026-09-30T08:10:00.000Z": false, none: false });
  });

  it("copes with an empty snapshot and with nodes outside the listed areas", () => {
    const empty = layoutDistrict({ nodes: [], edges: [], areas, asOf: AS_OF });
    expect(empty.tiles).toEqual([]);
    expect(empty.bands).toEqual([]);
    expect(empty.height).toBeGreaterThan(0);
    const stray = layoutDistrict({ nodes: [node({ id: "user:r9", kind: "RIDER", name: "Nowhere", areaId: null, areaName: "—" })], edges: [], areas: [], asOf: AS_OF });
    expect(stray.tiles).toHaveLength(1);
    expect(stray.unplaced).toEqual([]);
  });

  it("evaluates a cubic bezier at its ends and middle", () => {
    const p: [number, number, number, number, number, number, number, number] = [0, 0, 50, 0, 50, 100, 100, 100];
    expect(bezierAt(p, 0)).toEqual({ x: 0, y: 0 });
    expect(bezierAt(p, 1)).toEqual({ x: 100, y: 100 });
    expect(bezierAt(p, 0.5)).toEqual({ x: 50, y: 50 });
  });
});
