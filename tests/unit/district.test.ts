/**
 * Prompt B §9.3: the district map's layout is a pure function — every node
 * gets exactly one tile, edges reference existing tiles, areas never overlap,
 * attention chips point at the right tiles, and the markers move with time.
 */
import { describe, expect, it } from "vitest";
import { bezierAt, layoutDistrict, type Tile } from "@/lib/ecosystem/district";
import type { EcoEdge, EcoNode } from "@/lib/services/ecosystem";

function node(partial: Partial<EcoNode> & Pick<EcoNode, "id" | "kind" | "name">): EcoNode {
  return { status: "active", areaId: "A", areaName: "Area A", hubId: null, lastActivityAt: "2026-09-30T06:00:00.000Z", href: "/admin", stock: null, hub: null, champion: null, supplier: null, customers: null, organisation: null, earnedTzs: null, ...partial };
}
function edge(partial: Partial<EcoEdge> & Pick<EcoEdge, "kind" | "fromId" | "toId">): EcoEdge {
  return { count: 1, units: 10, expectedTzs: 1000, confirmedTzs: 0, oldestDays: 0, inReview: 0, onHold: 0, awaitingConfirmation: 0, paymentState: "pending", ...partial };
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

const overlaps = (a: Tile, b: Tile) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

describe("district layout", () => {
  const lay = layoutDistrict({ nodes, edges, areas, asOf: AS_OF });

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

  it("draws an edge only between tiles that exist, dashed for direct paths, and one motorbike per open order on the road", () => {
    expect(lay.edges.map((l) => l.edge.kind).sort()).toEqual(["CHAMPION_TO_CUSTOMER", "HUB_TO_CHAMPION", "RIDER_TO_CUSTOMER", "RIDER_TO_HUB", "SUPPLIER_TO_ORG", "SUPPLIER_TO_RIDER"]);
    const byKind = Object.fromEntries(lay.edges.map((l) => [l.edge.kind, l]));
    expect(byKind.SUPPLIER_TO_ORG!.direct).toBe(true);
    expect(byKind.RIDER_TO_CUSTOMER!.direct).toBe(true);
    expect(byKind.RIDER_TO_HUB!.direct).toBe(false);
    // The thickest edge carries the most units.
    expect(byKind.SUPPLIER_TO_RIDER!.width).toBeGreaterThan(byKind.RIDER_TO_HUB!.width);
    // Two open pickups → two markers on that edge; hub → champion is not a road leg.
    expect(lay.markers.filter((m) => m.edgeKey === byKind.SUPPLIER_TO_RIDER!.key)).toHaveLength(2);
    expect(lay.markers.filter((m) => m.kind === "HUB_TO_CHAMPION")).toHaveLength(0);
    expect(lay.markers.filter((m) => m.kind === "CHAMPION_TO_CUSTOMER")).toHaveLength(0);
    for (const m of lay.markers) {
      const l = lay.edges.find((e) => e.key === m.edgeKey)!;
      const minX = Math.min(l.p[0], l.p[6]) - 1;
      const maxX = Math.max(l.p[0], l.p[6]) + 1;
      expect(m.x).toBeGreaterThanOrEqual(minX);
      expect(m.x).toBeLessThanOrEqual(maxX);
    }
  });

  it("moves the markers a little as the clock advances, and keeps them still for the same moment", () => {
    const again = layoutDistrict({ nodes, edges, areas, asOf: AS_OF });
    expect(again.markers.map((m) => [m.x, m.y])).toEqual(lay.markers.map((m) => [m.x, m.y]));
    const later = layoutDistrict({ nodes, edges, areas, asOf: "2026-09-30T08:00:30.000Z" });
    expect(later.markers.map((m) => m.progress)).not.toEqual(lay.markers.map((m) => m.progress));
    for (const m of later.markers) expect(m.progress).toBeGreaterThanOrEqual(0);
    for (const m of later.markers) expect(m.progress).toBeLessThan(1);
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
