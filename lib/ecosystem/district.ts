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
import type { AttentionKey, EcoEdge, EcoNode, OpenOrder, RecentPayment } from "@/lib/services/ecosystem";

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
  /** Something happened here in the hour before the snapshot (a pulsing dot; Prompt E §3). */
  recent: boolean;
  /** This is the tile the viewer clicked (`?focus=`). */
  focused: boolean;
  /** Something else is focused and this tile has no open order with it: drawn faint. */
  dim: boolean;
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
  dim: boolean;
}

/**
 * Where an open order is in its life, in words a person uses. The map places
 * the order's marker by it: waiting at the sender's door, on the road, or at
 * the receiver's door. Plans being paid off in instalments are not moving and
 * get no marker (the customers block shows them).
 */
export type Stage = "prepare" | "ready" | "requested" | "paying" | "handover" | "road" | "inspecting" | "hold" | "handoverDue" | "plan";
export const STAGES: readonly Stage[] = ["prepare", "ready", "requested", "paying", "handover", "road", "inspecting", "hold", "handoverDue", "plan"];

export function orderStage(state: string): Stage {
  switch (state) {
    case "PICKUP_ASSIGNED":
      return "prepare";
    case "BATCH_READY":
      return "ready";
    case "REQUESTED":
      return "requested";
    case "AWAITING_PAYMENT":
      return "paying";
    case "PAID":
      return "handover";
    case "EN_ROUTE":
      return "road";
    case "INSPECTING":
      return "inspecting";
    case "ON_HOLD":
      return "hold";
    case "FULLY_PAID":
    case "HANDOVER_PENDING":
      return "handoverDue";
    default:
      return "plan";
  }
}

/** 0 = at the sender, 1 = at the receiver; null = no marker. A rider's delivery is paid and handed over at the hub, a pickup at the factory. */
export function stagePosition(kind: OrderKind, stage: Stage): number | null {
  switch (stage) {
    case "plan":
      return null;
    case "prepare":
    case "ready":
    case "requested":
      return 0.1;
    case "paying":
      return kind === "RIDER_TO_HUB" ? 0.92 : 0.15;
    case "handover":
      return kind === "RIDER_TO_HUB" ? 0.95 : kind === "SUPPLIER_TO_RIDER" || kind === "HUB_TO_CHAMPION" ? 0.2 : 0.85;
    case "road":
      return 0.5;
    case "inspecting":
    case "hold":
      return 0.92;
    case "handoverDue":
      return 0.85;
  }
}

/** Riders carry these (a motorbike); everything else is a parcel handed over by hand or delivered by the supplier. */
const RIDER_CARRIED: ReadonlySet<string> = new Set(["SUPPLIER_TO_RIDER", "RIDER_TO_HUB", "RIDER_TO_CUSTOMER", "RIDER_TO_ORG"]);

/** One order inside a marker. */
export interface MarkerItem {
  orderId: string;
  ref: string;
  units: number;
  stage: Stage;
  paymentState: OpenOrder["paymentState"];
}

/**
 * A marker on the map: one order on the road, or every order of one edge waiting at the same door (the sender's or
 * the receiver's), drawn once with a count so a busy door never piles markers on top of each other.
 */
export interface Marker {
  key: string;
  /** The first order (the whole marker when it holds one). */
  orderId: string;
  ref: string;
  items: MarkerItem[];
  edgeKey: string;
  kind: OrderKind;
  stage: Stage;
  carrier: "moto" | "box";
  /** The most urgent payment state among its orders (hold, review, pending, confirmed). */
  paymentState: OpenOrder["paymentState"];
  /** The place a grouped marker waits at; clicking it focuses that place. */
  at: string;
  x: number;
  y: number;
  r: number;
  /** Units across its orders. */
  units: number;
  /** 0..1 along the edge: where the order is in its life; only "on the road" moves with the clock. */
  progress: number;
  dim: boolean;
}

const URGENCY: OpenOrder["paymentState"][] = ["hold", "review", "pending", "confirmed"];

/** More open orders on an edge than markers drawn: "+N" beside the last one. */
export interface Overflow {
  edgeKey: string;
  x: number;
  y: number;
  more: number;
}

/** Provider-confirmed money that reached a tile in the last hour (a coin on its corner). */
export interface Coin {
  tileId: string;
  x: number;
  y: number;
  amountTzs: number;
  count: number;
  latestAt: string;
  dim: boolean;
}

export interface DistrictLayout {
  width: number;
  height: number;
  bands: Band[];
  tiles: Tile[];
  edges: EdgeLine[];
  markers: Marker[];
  overflow: Overflow[];
  coins: Coin[];
  /** Node ids the layout could not place (should be empty; tested). */
  unplaced: string[];
}

export const DIRECT_KINDS: ReadonlySet<string> = new Set(["RIDER_TO_CUSTOMER", "SUPPLIER_TO_CUSTOMER", "SUPPLIER_TO_HUB", "SUPPLIER_TO_CHAMPION", "SUPPLIER_TO_ORG", "HUB_TO_ORG", "RIDER_TO_ORG"]);
/** Markers on the road per edge before the rest fold into "+N" (orders waiting at a door are one marker already). */
export const MAX_MARKERS_PER_EDGE = 4;

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
/** "Live" on the map: activity within the hour before the snapshot. */
export const RECENT_MS = 60 * 60_000;

function isRecent(n: EcoNode, asOfMs: number): boolean {
  if (!n.lastActivityAt) return false;
  const age = asOfMs - new Date(n.lastActivityAt).getTime();
  return age >= 0 && age <= RECENT_MS;
}

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

export function layoutDistrict(input: {
  nodes: EcoNode[];
  edges: EcoEdge[];
  areas: { id: string; name: string }[];
  attention?: AttentionKey | "";
  asOf: string;
  /** Open orders: one marker each, placed by its stage. */
  orders?: OpenOrder[];
  /** Payments confirmed in the last hour: coins on the tiles that were paid. */
  payments?: RecentPayment[];
  /** The clicked tile: it and everyone it has open orders with stay bright, the rest go faint. */
  focus?: string | null;
}): DistrictLayout {
  const { nodes, edges } = input;
  const attention = input.attention ?? "";
  const focus = input.focus && nodes.some((n) => n.id === input.focus) ? input.focus : null;
  const orders = input.orders ?? [];
  const related = new Set<string>(focus ? [focus] : []);
  if (focus) for (const e of [...edges, ...orders]) if (e.fromId === focus || e.toId === focus) related.add(e.fromId).add(e.toId);
  const touches = (e: { fromId: string; toId: string }) => !focus || e.fromId === focus || e.toId === focus;
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
        recent: isRecent(n, asOfMs),
        focused: n.id === focus,
        dim: !!focus && !related.has(n.id),
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
      dim: !touches(e),
    });
  }

  // Every open order is on the map once, placed by where it is in its life (orderStage). Orders on the road ride it one
  // marker each and move with the clock; orders waiting at the sender's or the receiver's door are one marker per edge
  // and door, with a count. Markers ride the free stretches of road beside the tiles, never across a depot; edges
  // sharing a stretch ride in lanes so their markers never stack.
  const markers: Marker[] = [];
  const overflow: Overflow[] = [];
  const phase = Number.isFinite(asOfMs) ? (Math.floor(asOfMs / 30_000) % 20) / 20 : 0;
  const laneOf = new Map<string, number>();
  const laneCount = new Map<string, number>();
  const LANES = [0, -22, 22, -44, 44];
  for (const l of lines) {
    if (!l.road) continue;
    const stretch = `${Math.round(l.road[2])}|${Math.round(Math.min(l.road[0], l.road[1]) / 40)}`;
    const k = laneCount.get(stretch) ?? 0;
    laneOf.set(l.key, LANES[k % LANES.length]!);
    laneCount.set(stretch, k + 1);
  }
  const lineOf = new Map(lines.map((l) => [l.key, l]));
  const byEdge = new Map<string, OpenOrder[]>();
  for (const o of orders) {
    const key = `${o.kind}|${o.fromId}|${o.toId}`;
    if (!lineOf.has(key) || stagePosition(o.kind, orderStage(o.state)) === null) continue;
    byEdge.set(key, [...(byEdge.get(key) ?? []), o]);
  }
  const radius = (units: number) => 6 + Math.min(3, units / 40);
  for (const [key, list] of byEdge) {
    const l = lineOf.get(key)!;
    const lane = laneOf.get(key) ?? 0;
    const placed = list.map((o) => {
      const stage = orderStage(o.state);
      const base = stagePosition(o.kind, stage)!;
      const progress = stage === "road" ? 0.2 + ((phase + hash(o.id) * 0.6) % 1) * 0.6 : base;
      return { o, stage, progress, where: progress < 0.3 ? ("sender" as const) : progress > 0.8 ? ("receiver" as const) : ("road" as const) };
    });
    const item = (p: (typeof placed)[number]): MarkerItem => ({ orderId: p.o.id, ref: p.o.ref, units: p.o.units, stage: p.stage, paymentState: p.o.paymentState });
    const marker = (group: typeof placed, markerKey: string, pt: { x: number; y: number }, at: string): Marker => {
      const units = group.reduce((a, p) => a + p.o.units, 0);
      return {
        key: markerKey,
        orderId: group[0]!.o.id,
        ref: group[0]!.o.ref,
        items: group.map(item),
        edgeKey: key,
        kind: l.edge.kind,
        stage: group[0]!.stage,
        carrier: RIDER_CARRIED.has(l.edge.kind) ? "moto" : "box",
        paymentState: URGENCY.find((st) => group.some((p) => p.o.paymentState === st)) ?? "pending",
        at,
        x: pt.x,
        y: pt.y,
        r: radius(units / group.length),
        units,
        progress: group[0]!.progress,
        dim: !touches(l.edge),
      };
    };
    const dir = l.road ? (l.road[1] >= l.road[0] ? 1 : -1) : 1;
    // Doors: one marker each, holding every order of this edge waiting there.
    for (const where of ["sender", "receiver"] as const) {
      const group = placed.filter((p) => p.where === where);
      if (!group.length) continue;
      const pt = l.road ? { x: where === "sender" ? l.road[0] + dir * 2 : l.road[1] - dir * 2, y: l.road[2] + lane } : bezierAt(l.p, where === "sender" ? 0.12 : 0.88);
      markers.push(marker(group, group.length === 1 ? group[0]!.o.id : `${key}#${where}`, pt, where === "sender" ? l.edge.fromId : l.edge.toId));
    }
    // The road: one marker per order, up to the first tile in the way.
    const moving = placed.filter((p) => p.where === "road");
    const shown = moving.slice(0, MAX_MARKERS_PER_EDGE);
    let free: [number, number, number] | null = l.road;
    if (free) {
      const [xa, xb, ry] = free;
      const onRoad = tiles.filter((tl) => tl.areaId === (tileOf.get(l.edge.fromId)?.areaId ?? "") && tl.y <= ry && tl.y + tl.h >= ry);
      const blocking = onRoad.map((tl) => (dir > 0 ? tl.x : tl.x + tl.w)).filter((x) => (x - xa) * dir > 4 && (x - xb) * dir < 0);
      const stop = blocking.length ? blocking.reduce((a, b) => ((b - a) * dir < 0 ? b : a)) - 12 * dir : xb;
      free = [xa, stop, ry];
    }
    let last = { x: 0, y: 0 };
    shown.forEach((p, q) => {
      let pt: { x: number; y: number };
      // Between the doors (never on top of a door marker), or, with no room, a short queue above the road.
      if (free && Math.abs(free[1] - free[0]) >= 80) pt = { x: free[0] + (free[1] - free[0]) * (0.2 + ((p.progress - 0.2) / 0.6) * 0.6), y: free[2] + lane - 16 * (q % 2) };
      else if (free) pt = { x: (free[0] + free[1]) / 2, y: free[2] + lane - 22 * (q + 1) };
      else pt = bezierAt(l.p, Math.min(0.8, Math.max(0.2, p.progress)));
      last = pt;
      markers.push(marker([p], p.o.id, pt, l.edge.toId));
    });
    if (moving.length > shown.length) overflow.push({ edgeKey: key, x: last.x + 14, y: last.y - 12, more: moving.length - shown.length });
  }

  // Coins: money the provider confirmed in the last hour, on the corner of the tile it was paid to (the seller's end).
  const coinOf = new Map<string, Coin>();
  for (const p of input.payments ?? []) {
    const t = tileOf.get(p.fromId);
    if (!t) continue;
    const c = coinOf.get(t.id) ?? { tileId: t.id, x: t.x + t.w - 6, y: t.y + t.h, amountTzs: 0, count: 0, latestAt: p.at, dim: t.dim };
    c.amountTzs += p.amountTzs;
    c.count += 1;
    if (p.at > c.latestAt) c.latestAt = p.at;
    coinOf.set(t.id, c);
  }
  const coins = [...coinOf.values()];

  return {
    width,
    height: y - BAND_GAP + PAD,
    bands,
    tiles,
    edges: lines,
    markers,
    overflow,
    coins,
    unplaced,
  };
}
