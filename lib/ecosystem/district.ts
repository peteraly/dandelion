/**
 * The district map (Prompt B §9): a schematic of each service area laid out
 * by this function — never a real map, no coordinates, no addresses. Left to
 * right: the factory, the riders' stand, the hubs as depots along one road
 * with their champions' kiosks and their customers' block underneath, and on
 * the right the organisations and the customers served directly.
 *
 * Pure: a snapshot in, tile and marker positions out. The SVG component only
 * draws what comes back, and the unit tests check the geometry.
 */
import type { OrderKind } from "@/lib/domain/types";
import type { AttentionKey, EcoEdge, EcoNode } from "@/lib/services/ecosystem";

export type Glyph = "factory" | "moto" | "depot" | "kiosk" | "block" | "school";

export interface Tile {
  id: string;
  kind: EcoNode["kind"];
  glyph: Glyph;
  x: number;
  y: number;
  w: number;
  h: number;
  areaId: string;
  node: EcoNode;
  /** A lot on this tile is locked (padlock). */
  locked: boolean;
  /** The active attention chip points at this tile (outline + icon). */
  attention: boolean;
}

export interface Band {
  id: string;
  name: string;
  y: number;
  h: number;
  roadY: number;
  roadX1: number;
  roadX2: number;
}

export interface EdgeLine {
  key: string;
  edge: EcoEdge;
  path: string;
  /** Start and end with two control points (a cubic), for tests and as the fallback marker track. */
  p: [number, number, number, number, number, number, number, number];
  /** The stretch of road this edge travels, when it crosses columns: [xFrom, xTo, y]. Markers ride it. */
  road: [number, number, number] | null;
  direct: boolean;
  width: number;
}

export interface Marker {
  key: string;
  edgeKey: string;
  kind: OrderKind;
  x: number;
  y: number;
  r: number;
  units: number;
  /** 0..1 along the edge; advances a little on every refresh. */
  progress: number;
}

export interface DistrictLayout {
  width: number;
  height: number;
  bands: Band[];
  tiles: Tile[];
  edges: EdgeLine[];
  markers: Marker[];
  /** Node ids the layout could not place (should be empty; tested). */
  unplaced: string[];
}

export const DIRECT_KINDS: ReadonlySet<string> = new Set(["RIDER_TO_CUSTOMER", "SUPPLIER_TO_CUSTOMER", "SUPPLIER_TO_HUB", "SUPPLIER_TO_CHAMPION", "SUPPLIER_TO_ORG", "HUB_TO_ORG", "RIDER_TO_ORG"]);
/** Orders that travel on the road get a motorbike marker per open order. */
const ROAD_KINDS: ReadonlySet<string> = new Set(["SUPPLIER_TO_RIDER", "RIDER_TO_HUB", "RIDER_TO_CUSTOMER", "RIDER_TO_ORG", "SUPPLIER_TO_HUB", "SUPPLIER_TO_CHAMPION"]);

export const MAP_MIN_W = 1000;
const PAD = 16;
const BAND_HEADER = 26;
const BAND_GAP = 18;
const FACTORY_X = PAD;
const FACTORY_W = 176;
const FACTORY_H = 58;
const ROAD_GAP = 96; // room on the road between columns for the motorbikes
const RIDER_X = FACTORY_X + FACTORY_W + ROAD_GAP;
const RIDER_W = 150;
const RIDER_H = 58;
const HUB_X0 = RIDER_X + RIDER_W + ROAD_GAP;
const HUB_W = 176;
const HUB_H = 58;
const HUB_GAP = 64;
const KIOSK_H = 58;
const BLOCK_H = 80;
const RIGHT_W = 176;
const ORG_H = 48;
const V_GAP = 8;
const SILENT_MS = 7 * 86_400_000;

const GLYPH: Record<EcoNode["kind"], Glyph> = {
  SUPPLIER: "factory",
  RIDER: "moto",
  HUB: "depot",
  CHAMPION: "kiosk",
  CUSTOMERS: "block",
  ORGANISATION: "school",
};

function isAttention(n: EcoNode, key: AttentionKey | "", asOfMs: number, edges: EcoEdge[]): boolean {
  switch (key) {
    case "hubsBelowMin":
      return n.kind === "HUB" && !!n.hub && n.hub.available < n.hub.minStockUnits;
    case "lockedBatches":
      return !!n.stock && n.stock.lockedUnits > 0;
    case "silentNodes":
      return (n.kind === "CHAMPION" || n.kind === "RIDER" || n.kind === "HUB" || n.kind === "SUPPLIER") && n.status === "active" && (!n.lastActivityAt || asOfMs - new Date(n.lastActivityAt).getTime() > SILENT_MS);
    case "handoverPending":
      return n.kind === "CUSTOMERS" && !!n.customers && n.customers.handoverPending > 0;
    case "waitingOnSupplier":
      return n.kind === "SUPPLIER" && !!n.supplier && n.supplier.waitingPastLeadTime > 0;
    case "supplierQuality":
      return n.kind === "SUPPLIER" && !!n.supplier && n.supplier.qualityBatches > 0 && n.supplier.qualityShare > 0;
    case "orgOrdersUnpaid":
      return n.kind === "ORGANISATION" && !!n.organisation && n.organisation.openOrders > 0;
    case "paymentReviews":
      return edges.some((e) => e.inReview > 0 && (e.fromId === n.id || e.toId === n.id));
    case "paymentsPendingLong":
      return edges.some((e) => e.paymentState === "pending" && e.oldestDays >= 1 && (e.fromId === n.id || e.toId === n.id));
    default:
      return false; // approvals, reconciliation flags, dead jobs and open problems are not about one tile
  }
}

/** Point on a cubic bezier at t. */
export function bezierAt(p: EdgeLine["p"], t: number): { x: number; y: number } {
  const [x0, y0, x1, y1, x2, y2, x3, y3] = p;
  const u = 1 - t;
  const b0 = u * u * u;
  const b1 = 3 * u * u * t;
  const b2 = 3 * u * t * t;
  const b3 = t * t * t;
  return {
    x: b0 * x0 + b1 * x1 + b2 * x2 + b3 * x3,
    y: b0 * y0 + b1 * y1 + b2 * y2 + b3 * y3,
  };
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0) / 4294967295;
}

export function layoutDistrict(input: { nodes: EcoNode[]; edges: EcoEdge[]; areas: { id: string; name: string }[]; attention?: AttentionKey | ""; asOf: string }): DistrictLayout {
  const { nodes, edges } = input;
  const attention = input.attention ?? "";
  const asOfMs = new Date(input.asOf).getTime();
  const areaOrder = input.areas.map((a) => a.id);
  const nameOf = new Map(input.areas.map((a) => [a.id, a.name]));
  for (const n of nodes) if (n.areaId && !nameOf.has(n.areaId)) nameOf.set(n.areaId, n.areaName);
  const fallbackArea = areaOrder[0] ?? nodes.find((n) => n.areaId)?.areaId ?? "area";
  const areaOf = (n: EcoNode) => n.areaId ?? fallbackArea;
  const bandIds = [...new Set([...areaOrder, ...nodes.map(areaOf)])];

  const tiles: Tile[] = [];
  const bands: Band[] = [];
  const unplaced: string[] = [];
  let width = MAP_MIN_W;
  let y = PAD;
  for (const areaId of bandIds) {
    const inArea = nodes.filter((n) => areaOf(n) === areaId);
    if (!inArea.length) continue;
    const suppliers = inArea.filter((n) => n.kind === "SUPPLIER");
    const riders = inArea.filter((n) => n.kind === "RIDER");
    const hubs = inArea.filter((n) => n.kind === "HUB").sort((a, b) => a.name.localeCompare(b.name));
    const hubIds = new Set(hubs.map((h) => h.hubId));
    const champions = inArea.filter((n) => n.kind === "CHAMPION");
    const strayChampions = champions.filter((c) => !hubIds.has(c.hubId));
    const hubCustomers = inArea.filter((n) => n.kind === "CUSTOMERS" && n.hubId !== null);
    const directCustomers = inArea.filter((n) => n.kind === "CUSTOMERS" && n.hubId === null);
    const orgs = inArea.filter((n) => n.kind === "ORGANISATION");

    const top = y;
    const roadY = top + BAND_HEADER + FACTORY_H / 2 + 6;
    const push = (n: EcoNode, x: number, ty: number, w: number, h: number) =>
      tiles.push({
        id: n.id,
        kind: n.kind,
        glyph: GLYPH[n.kind],
        x,
        y: ty,
        w,
        h,
        areaId,
        node: n,
        locked: !!n.stock && n.stock.lockedUnits > 0,
        attention: isAttention(n, attention, asOfMs, edges),
      });

    // Factory column: suppliers stacked.
    let colBottom = roadY - FACTORY_H / 2;
    suppliers.forEach((s, i) => {
      const ty = roadY - FACTORY_H / 2 + i * (FACTORY_H + V_GAP);
      push(s, FACTORY_X, ty, FACTORY_W, FACTORY_H);
      colBottom = Math.max(colBottom, ty + FACTORY_H);
    });
    // Riders' stand on the road, stray champions under it.
    let ry = roadY - RIDER_H / 2;
    for (const r of riders) {
      push(r, RIDER_X, ry, RIDER_W, RIDER_H);
      ry += RIDER_H + V_GAP;
    }
    for (const c of strayChampions) {
      push(c, RIDER_X, ry, RIDER_W, KIOSK_H);
      ry += KIOSK_H + V_GAP;
    }
    colBottom = Math.max(colBottom, ry);
    // Hubs along the road, kiosks and the customers block under each.
    let hx = HUB_X0;
    for (const h of hubs) {
      push(h, hx, roadY - HUB_H / 2, HUB_W, HUB_H);
      let ky = roadY + HUB_H / 2 + 14;
      for (const c of champions.filter((c) => c.hubId === h.hubId).sort((a, b) => a.name.localeCompare(b.name))) {
        push(c, hx, ky, HUB_W, KIOSK_H);
        ky += KIOSK_H + V_GAP;
      }
      for (const cu of hubCustomers.filter((c) => c.hubId === h.hubId)) {
        push(cu, hx, ky + 4, HUB_W, BLOCK_H);
        ky += BLOCK_H + V_GAP + 4;
      }
      colBottom = Math.max(colBottom, ky);
      hx += HUB_W + HUB_GAP;
    }
    // Right column: organisations, then the customers served directly.
    const rightX = Math.max(hx - HUB_GAP + ROAD_GAP, HUB_X0 + 2 * (HUB_W + HUB_GAP) - HUB_GAP + ROAD_GAP);
    let oy = roadY - ORG_H / 2;
    for (const o of orgs.sort((a, b) => a.name.localeCompare(b.name))) {
      push(o, rightX, oy, RIGHT_W, ORG_H);
      oy += ORG_H + V_GAP;
    }
    for (const d of directCustomers) {
      push(d, rightX, oy + 4, RIGHT_W, BLOCK_H);
      oy += BLOCK_H + V_GAP + 4;
    }
    colBottom = Math.max(colBottom, oy);
    width = Math.max(width, rightX + RIGHT_W + PAD);
    const h = colBottom - top + PAD;
    bands.push({
      id: areaId,
      name: nameOf.get(areaId) ?? "—",
      y: top,
      h,
      roadY,
      roadX1: FACTORY_X + FACTORY_W,
      roadX2: rightX,
    });
    y = top + h + BAND_GAP;
  }
  const placed = new Set(tiles.map((t) => t.id));
  for (const n of nodes) if (!placed.has(n.id)) unplaced.push(n.id);

  const tileOf = new Map(tiles.map((t) => [t.id, t]));
  const maxUnits = Math.max(1, ...edges.map((e) => e.units));
  const lines: EdgeLine[] = [];
  for (const e of edges) {
    const a = tileOf.get(e.fromId);
    const b = tileOf.get(e.toId);
    if (!a || !b) continue;
    const key = `${e.kind}|${e.fromId}|${e.toId}`;
    const direct = DIRECT_KINDS.has(e.kind);
    const band = bands.find((bd) => bd.id === a.areaId) ?? bands[0]!;
    let p: EdgeLine["p"];
    let path: string;
    let road: EdgeLine["road"] = null;
    if (Math.abs(a.x - b.x) < 40) {
      // Same column (hub → kiosk, kiosk → customers block): a bracket down the column's margin, so no line crosses a tile.
      const down = b.y >= a.y;
      const from = down ? a : b;
      const to = down ? b : a;
      const mx = from.x - (direct ? 18 : 9);
      const y1 = from.y + from.h;
      const y2 = to.y + to.h / 2;
      p = [from.x + 10, y1, mx, y1 + 10, mx, y2, to.x, y2];
      path = `M ${from.x + 10} ${y1} Q ${mx} ${y1} ${mx} ${y1 + 10} L ${mx} ${y2 - 10} Q ${mx} ${y2} ${to.x} ${y2}`;
    } else {
      // Across columns: out of the tile, down (or up) to the road, along the road, into the target.
      const forward = b.x >= a.x;
      const x1 = forward ? a.x + a.w : a.x;
      const x2 = forward ? b.x : b.x + b.w;
      const y1 = a.y + a.h / 2;
      const y2 = b.y + b.h / 2;
      const dir = forward ? 1 : -1;
      const xa = x1 + 24 * dir;
      const xb = x2 - 24 * dir;
      const ry = band.roadY + (direct ? 4 : 0);
      if ((xb - xa) * dir < 20) {
        const mx = (x1 + x2) / 2;
        p = [x1, y1, mx, y1, mx, y2, x2, y2];
        path = `M ${p[0]} ${p[1]} C ${p[2]} ${p[3]}, ${p[4]} ${p[5]}, ${p[6]} ${p[7]}`;
      } else {
        p = [x1, y1, xa, ry, xb, ry, x2, y2];
        path = `M ${x1} ${y1} C ${xa} ${y1}, ${x1} ${ry}, ${xa} ${ry} L ${xb} ${ry} C ${x2} ${ry}, ${xb} ${y2}, ${x2} ${y2}`;
        road = [xa, xb, ry];
      }
    }
    lines.push({
      key,
      edge: e,
      p,
      path,
      road,
      direct,
      width: 1.5 + (e.units / maxUnits) * 6,
    });
  }

  // One motorbike per open order on the road (at most three per edge); the phase turns with the clock so markers creep
  // forward on every refresh. They ride the free stretch of road right after the sender, never across a depot.
  const markers: Marker[] = [];
  const phase = Number.isFinite(asOfMs) ? (Math.floor(asOfMs / 30_000) % 20) / 20 : 0;
  // Edges that share a stretch of road ride in lanes (on, above, below the centre line) so their motorbikes never stack.
  const laneOf = new Map<string, number>();
  const laneCount = new Map<string, number>();
  const LANES = [0, -15, 15, -30, 30];
  for (const l of lines) {
    if (!ROAD_KINDS.has(l.edge.kind) || !l.road) continue;
    const stretch = `${Math.round(l.road[2])}|${Math.round(Math.min(l.road[0], l.road[1]) / 40)}`;
    const n = laneCount.get(stretch) ?? 0;
    laneOf.set(l.key, LANES[n % LANES.length]!);
    laneCount.set(stretch, n + 1);
  }
  for (const l of lines) {
    if (!ROAD_KINDS.has(l.edge.kind)) continue;
    const lane = laneOf.get(l.key) ?? 0;
    const count = Math.min(l.edge.count, 3);
    const per = l.edge.units / Math.max(1, l.edge.count);
    let track: [number, number, number] | null = l.road;
    if (track) {
      const [xa, xb, ry] = track;
      const dir = xb >= xa ? 1 : -1;
      const onRoad = tiles.filter((tl) => tl.areaId === (tileOf.get(l.edge.fromId)?.areaId ?? "") && tl.y <= ry && tl.y + tl.h >= ry);
      const blocking = onRoad.map((tl) => (dir > 0 ? tl.x : tl.x + tl.w)).filter((x) => (x - xa) * dir > 4 && (x - xb) * dir < 0);
      const stop = blocking.length ? blocking.reduce((a, b) => ((b - a) * dir < 0 ? b : a)) - 12 * dir : xb;
      track = [xa, stop, ry];
    }
    for (let i = 0; i < count; i++) {
      const progress = ((i + 0.5) / count + phase + hash(l.key) * 0.3) % 1;
      let pt: { x: number; y: number };
      if (track && Math.abs(track[1] - track[0]) >= 30) pt = { x: track[0] + (track[1] - track[0]) * (0.1 + progress * 0.8), y: track[2] + lane };
      else if (track)
        pt = { x: (track[0] + track[1]) / 2, y: track[2] + lane - 16 * i }; // no room: a short queue above the road
      else pt = bezierAt(l.p, 0.12 + progress * 0.76);
      markers.push({
        key: `${l.key}#${i}`,
        edgeKey: l.key,
        kind: l.edge.kind,
        x: pt.x,
        y: pt.y,
        r: 5 + Math.min(4, per / 25),
        units: Math.round(per),
        progress,
      });
    }
  }

  return {
    width,
    height: y - BAND_GAP + PAD,
    bands,
    tiles,
    edges: lines,
    markers,
    unplaced,
  };
}
