/**
 * The district map (Prompt B §9): server-rendered inline SVG of the layout
 * `layoutDistrict` computed — flat pictograms from one <symbol> sprite, every
 * number printed inside its tile, edges only for orders in flight, a
 * marker per open order (a motorbike when a rider carries it, a parcel
 * otherwise) placed by where the order is in its life and ringed in its
 * payment colour, and a coin on every place the provider paid in the last
 * hour. Clicking a place focuses it (the details panel opens and everyone it
 * has no open order with goes faint); clicking a marker opens the order.
 * No canvas, no charting library; the CSS transition on the markers is the
 * only motion and it honours prefers-reduced-motion. Customers are dots and
 * counts, never names.
 */
import Link from "next/link";
import type { DistrictLayout, Stage, Tile } from "@/lib/ecosystem/district";
import { displayName } from "@/components/name";
import type { EcoEdge, EcoNode } from "@/lib/services/ecosystem";

export interface MapLabels {
  title: string;
  legend: string;
  earned: (tzs: string) => string;
  confirmed: (tzs: string) => string;
  plans: (active: number, stalled: number) => string;
  min: (n: number) => string;
  open: (n: number) => string;
  customers: (n: number) => string;
  handover: (n: number) => string;
  waiting: (n: number) => string;
  quality: (n: number) => string;
  marker: (n: number) => string;
  attention: string;
  direct: string;
  howToRead: string;
  recent: string;
  stage: (s: Stage) => string;
  coin: (count: number, tzs: string) => string;
  more: (n: number) => string;
  focus: string;
  group: (count: number) => string;
}

export interface MapContext {
  columns: Record<EcoNode["kind"], string>;
  units: (n: number) => string;
  locked: string;
  status: (s: EcoNode["status"]) => string;
  payment: (p: EcoEdge["paymentState"]) => string;
  edge: (e: EcoEdge) => string;
  money: (n: number) => string;
  map: MapLabels;
  /** Link that focuses a place on the map (keeps the page's filters). */
  focusHref: (nodeId: string) => string;
}

/** 1,234,000 → "1.2M", 45,500 → "46k": coin labels must fit on a tile corner. */
export function shortTzs(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`;
  return String(n);
}

export const EDGE_COLOUR: Record<EcoEdge["paymentState"], string> = { pending: "#a8a29e", confirmed: "#16a34a", review: "#d97706", hold: "#dc2626" };
const INK = "#1c1917";
const MUTED = "#57534e";
const TILE_FILL: Record<EcoNode["status"], string> = { active: "#ffffff", inactive: "#fafaf9", locked: "#fef2f2", suspended: "#fafaf9", pending: "#fffbeb", invited: "#fafaf9" };

function clip(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

/** The second and third line inside a tile: the numbers that matter for that kind of tile. */
export function tileLines(t: Tile, c: MapContext): [string, string] {
  const n = t.node;
  switch (n.kind) {
    case "SUPPLIER": {
      const extra = [
        n.supplier && n.supplier.waitingPastLeadTime > 0 ? c.map.waiting(n.supplier.waitingPastLeadTime) : "",
        n.supplier && n.supplier.qualityShare > 0 ? c.map.quality(Math.round(n.supplier.qualityShare * n.supplier.qualityBatches)) : "",
      ]
        .filter(Boolean)
        .join(" · ");
      return [c.map.confirmed(c.money(n.supplier?.confirmedTzs ?? 0)), extra];
    }
    case "RIDER":
      return [c.units(n.stock?.units ?? 0), n.earnedTzs === null ? "" : c.map.earned(c.money(n.earnedTzs))];
    case "HUB":
      return [`${c.units(n.hub?.available ?? 0)} · ${c.map.min(n.hub?.minStockUnits ?? 0)}`, `↓${n.hub?.pendingIn ?? 0} ↑${n.hub?.pendingOut ?? 0}${n.earnedTzs === null ? "" : ` · ${c.map.earned(c.money(n.earnedTzs))}`}`];
    case "CHAMPION":
      return [`${c.units(n.stock?.units ?? 0)} · ${c.map.plans(n.champion?.activePlans ?? 0, n.champion?.stalledPlans ?? 0)}`, n.earnedTzs === null ? "" : c.map.earned(c.money(n.earnedTzs))];
    case "CUSTOMERS":
      return [`${c.map.customers(n.customers?.count ?? 0)} · ${c.map.plans(n.customers?.activePlans ?? 0, 0).split(" · ")[0]}`, n.customers && n.customers.handoverPending > 0 ? c.map.handover(n.customers.handoverPending) : ""];
    case "ORGANISATION":
      return [`${c.map.open(n.organisation?.openOrders ?? 0)} · ${c.map.confirmed(c.money(n.organisation?.confirmedTzs ?? 0))}`, ""];
  }
}

function Dots({ t }: { t: Tile }) {
  const count = t.node.customers?.count ?? 0;
  const shown = Math.min(count, 48);
  const cols = 12;
  const x0 = t.x + 12;
  const y0 = t.y + 30;
  return (
    <g aria-hidden="true">
      {Array.from({ length: shown }, (_, i) => (
        <circle key={i} cx={x0 + (i % cols) * 9} cy={y0 + Math.floor(i / cols) * 7} r={2.2} fill={i < (t.node.customers?.activePlans ?? 0) ? "#15803d" : "#a8a29e"} />
      ))}
    </g>
  );
}

export function DistrictMap({ layout, c }: { layout: DistrictLayout; c: MapContext }) {
  const nameOf = new Map(layout.tiles.map((t) => [t.id, t.node.name]));
  const edgeOf = new Map(layout.edges.map((l) => [l.key, l.edge]));
  const ends = (edgeKey: string) => `${displayName(nameOf.get(edgeOf.get(edgeKey)?.fromId ?? "") ?? "")} → ${displayName(nameOf.get(edgeOf.get(edgeKey)?.toId ?? "") ?? "")}`;
  return (
    <div className="hidden overflow-x-auto md:block">
      {/* No inline styles anywhere: the CSP allows none, so positions are presentation attributes and motion is a class. */}
      <svg viewBox={`0 0 ${layout.width} ${layout.height}`} width="100%" role="group" aria-label={c.map.title} className="min-w-[900px] rounded-xl bg-stone-50" data-testid="district-map">
        <defs>
          <symbol id="d-factory" viewBox="0 0 24 24">
            <path d="M2 22V10l5-3v3l5-3v3l5-3v3l5-3v15z" fill="#78716c" />
            <rect x="4" y="4" width="3" height="5" fill="#78716c" />
          </symbol>
          <symbol id="d-moto" viewBox="0 0 24 24">
            <circle cx="6" cy="18" r="3.2" fill="none" stroke="#1c1917" strokeWidth="2" />
            <circle cx="18" cy="18" r="3.2" fill="none" stroke="#1c1917" strokeWidth="2" />
            <path d="M6 18l4-7h6l2 7M10 11V8h3" fill="none" stroke="#1c1917" strokeWidth="2" strokeLinejoin="round" />
          </symbol>
          <symbol id="d-depot" viewBox="0 0 24 24">
            <path d="M2 22V9l10-6 10 6v13z" fill="#a8a29e" />
            <path d="M9 22v-6h6v6" fill="#f5f5f4" />
          </symbol>
          <symbol id="d-kiosk" viewBox="0 0 24 24">
            <path d="M3 10h18l-2-5H5z" fill="#78716c" />
            <path d="M4 10v12h16V10z" fill="#d6d3d1" />
            <path d="M9 22v-7h6v7" fill="#57534e" />
          </symbol>
          <symbol id="d-school" viewBox="0 0 24 24">
            <path d="M3 22V11l9-5 9 5v11z" fill="#a8a29e" />
            <path d="M11 6V2h6l-1 2h-5" fill="#57534e" />
            <path d="M9 22v-6h6v6" fill="#f5f5f4" />
          </symbol>
          <symbol id="d-block" viewBox="0 0 24 24">
            <rect x="3" y="12" width="8" height="10" fill="#d6d3d1" />
            <rect x="13" y="8" width="8" height="14" fill="#a8a29e" />
          </symbol>
          <symbol id="d-lock" viewBox="0 0 24 24">
            <path d="M7 11V8a5 5 0 0 1 10 0v3" fill="none" stroke="#dc2626" strokeWidth="2.5" />
            <rect x="5" y="11" width="14" height="11" rx="2" fill="#dc2626" />
          </symbol>
          <symbol id="d-box" viewBox="0 0 24 24">
            <path d="M3 8l9-4 9 4v10l-9 4-9-4z" fill="#d6a86b" />
            <path d="M3 8l9 4 9-4M12 12v10" fill="none" stroke="#7c5a2e" strokeWidth="1.5" />
          </symbol>
          <symbol id="d-alert" viewBox="0 0 24 24">
            <path d="M12 3 2 21h20z" fill="#b45309" />
            <path d="M12 9v5M12 17v1.5" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" />
          </symbol>
        </defs>

        {layout.bands.map((b) => (
          <g key={b.id} data-testid="map-band">
            <text x={16} y={b.y + 16} fontSize="13" fontWeight="700" fill={INK}>
              {displayName(b.name)}
            </text>
            <line x1={b.roadX1} y1={b.roadY} x2={b.roadX2} y2={b.roadY} stroke="#e7e5e4" strokeWidth={12} strokeLinecap="round" />
            <line x1={b.roadX1} y1={b.roadY} x2={b.roadX2} y2={b.roadY} stroke="#fafaf9" strokeWidth={1.5} strokeDasharray="10 8" />
          </g>
        ))}

        {layout.edges.map((l) => (
          <path
            key={l.key}
            d={l.path}
            fill="none"
            stroke={EDGE_COLOUR[l.edge.paymentState]}
            strokeWidth={l.width}
            strokeOpacity={l.dim ? "0.15" : "0.85"}
            strokeDasharray={l.direct ? "6 4" : undefined}
            data-testid="flow-edge"
            data-payment={l.edge.paymentState}
            data-kind={l.edge.kind}
          >
            <title>{`${nameOf.get(l.edge.fromId) ?? ""} → ${nameOf.get(l.edge.toId) ?? ""}: ${c.edge(l.edge)} · ${c.payment(l.edge.paymentState)}`}</title>
          </path>
        ))}

        {layout.tiles.map((t) => {
          const [line2, line3] = tileLines(t, c);
          const isBlock = t.kind === "CUSTOMERS";
          return (
            <Link
              key={t.id}
              href={c.focusHref(t.id)}
              scroll={false}
              prefetch={false}
              aria-current={t.focused ? "true" : undefined}
              data-testid="map-tile"
              data-kind={t.kind}
              data-node={t.id}
              data-attention={t.attention ? "true" : undefined}
              data-locked={t.locked ? "true" : undefined}
              data-focused={t.focused ? "true" : undefined}
            >
              <g opacity={t.dim ? 0.3 : undefined}>
              <rect
                x={t.x}
                y={t.y}
                width={t.w}
                height={t.h}
                rx={8}
                fill={TILE_FILL[t.node.status]}
                stroke={t.focused ? "#1d4ed8" : t.locked ? "#dc2626" : t.attention ? "#b45309" : "#d6d3d1"}
                strokeWidth={t.focused ? 3 : t.locked || t.attention ? 2 : 1}
                strokeDasharray={t.attention && !t.locked && !t.focused ? "4 3" : undefined}
              />
              <use href={`#d-${t.glyph}`} x={t.x + 6} y={t.y + 5} width={18} height={18} />
              <text x={t.x + 28} y={t.y + 17} fontSize="11.5" fontWeight="700" fill={INK}>
                {clip(isBlock ? (t.node.hubId ? c.columns.CUSTOMERS : c.map.direct) : displayName(t.node.name), 19)}
              </text>
              {isBlock ? <Dots t={t} /> : null}
              <text x={t.x + 8} y={t.y + (isBlock ? t.h - 20 : 33)} fontSize="10.5" fill={INK}>
                {clip(line2, 30)}
              </text>
              {line3 ? (
                <text x={t.x + 8} y={t.y + (isBlock ? t.h - 7 : 48)} fontSize="10" fill={isBlock ? "#b45309" : MUTED} fontWeight={isBlock ? 700 : 400}>
                  {clip(line3, 32)}
                </text>
              ) : null}
              {t.locked ? <use href="#d-lock" x={t.x + t.w - 20} y={t.y + 4} width={14} height={14} /> : null}
              {t.attention && !t.locked ? <use href="#d-alert" x={t.x + t.w - 20} y={t.y + 4} width={14} height={14} /> : null}
              {t.recent ? <circle className="district-pulse" cx={t.x + t.w - (t.locked || t.attention ? 28 : 12)} cy={t.y + 11} r={4} fill="#22c55e" data-testid="tile-recent" /> : null}
              </g>
              <title>{`${t.node.name} · ${c.columns[t.kind]} · ${c.status(t.node.status)} · ${line2}${line3 ? ` · ${line3}` : ""}${t.locked ? ` · ${c.locked}` : ""}${t.attention ? ` · ${c.map.attention}` : ""}${t.recent ? ` · ${c.map.recent}` : ""} · ${c.map.focus}`}</title>
            </Link>
          );
        })}

        {layout.coins.map((k) => (
          <g key={`coin-${k.tileId}`} className="district-coin" transform={`translate(${k.x.toFixed(1)} ${k.y.toFixed(1)})`} opacity={k.dim ? 0.3 : undefined} data-testid="map-coin" data-node={k.tileId}>
            <rect x={-50} y={-9} width={50} height={18} rx={9} fill="#15803d" stroke="#fff" strokeWidth={1.5} />
            <circle cx={-41} cy={0} r={5} fill="#facc15" stroke="#a16207" strokeWidth={1} />
            <text x={-33} y={4} fontSize="10" fontWeight="700" fill="#fff">
              +{shortTzs(k.amountTzs)}
            </text>
            <title>{c.map.coin(k.count, c.money(k.amountTzs))}</title>
          </g>
        ))}

        {layout.markers.map((m) => (
          // One order opens the order; a door holding several opens the place they wait at.
          <Link
            key={m.key}
            href={m.items.length > 1 ? c.focusHref(m.at) : `/admin/orders/${m.orderId}`}
            scroll={m.items.length > 1 ? false : undefined}
            prefetch={false}
            data-testid="map-marker"
            data-kind={m.kind}
            data-stage={m.stage}
            data-payment={m.paymentState}
            data-order={m.ref}
            data-count={m.items.length}
          >
            <g className="district-marker" transform={`translate(${m.x.toFixed(1)} ${m.y.toFixed(1)})`} opacity={m.dim ? 0.2 : undefined}>
              <circle r={m.r + 3} fill="#fff" stroke={EDGE_COLOUR[m.paymentState]} strokeWidth={2.5} />
              <use href={`#d-${m.carrier}`} x={-m.r} y={-m.r} width={2 * m.r} height={2 * m.r} />
              <text x={m.r + 5} y={3.5} fontSize="9.5" fontWeight="700" fill={INK}>
                {m.units}
              </text>
              {m.items.length > 1 ? (
                <g transform={`translate(${-m.r - 2} ${-m.r - 2})`}>
                  <circle r={6.5} fill={INK} />
                  <text textAnchor="middle" y={3} fontSize="8.5" fontWeight="700" fill="#fff">
                    {m.items.length}
                  </text>
                </g>
              ) : null}
            </g>
            <title>
              {m.items.length > 1
                ? `${c.map.group(m.items.length)} · ${ends(m.edgeKey)} · ${c.units(m.units)}\n${m.items.map((it) => `${it.ref} · ${c.units(it.units)} · ${c.map.stage(it.stage)} · ${c.payment(it.paymentState)}`).join("\n")}`
                : `${m.ref} · ${c.units(m.units)} · ${ends(m.edgeKey)} · ${c.map.stage(m.stage)} · ${c.payment(m.paymentState)}`}
            </title>
          </Link>
        ))}

        {layout.overflow.map((o) => (
          <text key={`more-${o.edgeKey}`} x={o.x} y={o.y} fontSize="10" fontWeight="700" fill={MUTED} data-testid="map-more">
            {c.map.more(o.more)}
          </text>
        ))}
      </svg>
      <details className="mt-1 text-xs text-stone-500">
        <summary className="cursor-pointer underline decoration-dotted">{c.map.howToRead}</summary>
        <p className="mt-1">{c.map.legend}</p>
      </details>
    </div>
  );
}
