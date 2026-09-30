/**
 * The flow graph (Prompt B §3.3): columns supplier → riders → hubs →
 * champions → customers as server-rendered inline SVG, edges only for orders
 * in flight (thickness by units, colour by payment state), and a table with
 * the same data for keyboards and screen readers. No charting library.
 */
import type { EcoEdge, EcoNode } from "@/lib/services/ecosystem";

const COLUMNS = ["SUPPLIER", "RIDER", "HUB", "CHAMPION", "CUSTOMERS"] as const;
/** Organisations sit in the customers column: they are buyers at the end of a path (prompt §8.8). */
const COLUMN_OF: Record<EcoNode["kind"], (typeof COLUMNS)[number]> = { SUPPLIER: "SUPPLIER", RIDER: "RIDER", HUB: "HUB", CHAMPION: "CHAMPION", CUSTOMERS: "CUSTOMERS", ORGANISATION: "CUSTOMERS" };
const DIRECT_KINDS = new Set(["RIDER_TO_CUSTOMER", "SUPPLIER_TO_CUSTOMER", "SUPPLIER_TO_HUB", "SUPPLIER_TO_CHAMPION", "SUPPLIER_TO_ORG", "HUB_TO_ORG", "RIDER_TO_ORG"]);
const COLOUR: Record<EcoEdge["paymentState"], string> = { pending: "#a8a29e", confirmed: "#16a34a", review: "#d97706", hold: "#dc2626" };
const STATUS_ICON: Record<EcoNode["status"], string> = { active: "●", inactive: "○", locked: "⛔", suspended: "⏸", pending: "…", invited: "✉" };

export interface GraphLabels {
  columns: Record<EcoNode["kind"], string>;
  units: (n: number) => string;
  locked: string;
  status: (s: EcoNode["status"]) => string;
  payment: (p: EcoEdge["paymentState"]) => string;
  edge: (e: EcoEdge) => string;
  legend: string;
  tableTitle: string;
  headers: { node: string; role: string; status: string; stock: string; lastActivity: string };
  noEdges: string;
  formatTime: (iso: string | null) => string;
}

const W = 1000;
const COL_X = [40, 240, 440, 640, 840];
const NODE_W = 150;
const NODE_H = 46;
const GAP = 12;

export function FlowGraph({ nodes, edges, labels }: { nodes: EcoNode[]; edges: EcoEdge[]; labels: GraphLabels }) {
  const byColumn = COLUMNS.map((col) => nodes.filter((n) => COLUMN_OF[n.kind] === col));
  const rows = Math.max(1, ...byColumn.map((c) => c.length));
  const H = 40 + rows * (NODE_H + GAP) + 20;
  const pos = new Map<string, { x: number; y: number }>();
  byColumn.forEach((col, ci) => col.forEach((n, ri) => pos.set(n.id, { x: COL_X[ci]!, y: 40 + ri * (NODE_H + GAP) })));
  const maxUnits = Math.max(1, ...edges.map((e) => e.units));
  const drawable = edges.filter((e) => pos.has(e.fromId) && pos.has(e.toId));

  return (
    <div className="flex flex-col gap-3">
      <div className="hidden overflow-x-auto md:block">
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={labels.tableTitle} className="min-w-[900px] rounded-xl bg-white" data-testid="flow-graph">
          {COLUMNS.map((kind, ci) => (
            <text key={kind} x={COL_X[ci]! + NODE_W / 2} y={24} textAnchor="middle" className="fill-stone-500" fontSize="13" fontWeight="600">
              {labels.columns[kind]}
            </text>
          ))}
          {drawable.map((e) => {
            const a = pos.get(e.fromId)!;
            const b = pos.get(e.toId)!;
            const x1 = a.x + NODE_W;
            const y1 = a.y + NODE_H / 2;
            const x2 = b.x;
            const y2 = b.y + NODE_H / 2;
            const mx = (x1 + x2) / 2;
            const width = 1.5 + (e.units / maxUnits) * 6;
            return (
              <path key={`${e.kind}-${e.fromId}-${e.toId}`} d={`M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`} fill="none" stroke={COLOUR[e.paymentState]} strokeWidth={width} strokeOpacity="0.85" strokeDasharray={DIRECT_KINDS.has(e.kind) ? "6 4" : undefined} data-testid="flow-edge" data-payment={e.paymentState} data-kind={e.kind}>
                <title>{labels.edge(e)}</title>
              </path>
            );
          })}
          {nodes.map((n) => {
            const p = pos.get(n.id);
            if (!p) return null;
            const stockText = n.stock ? labels.units(n.stock.units) : n.customers ? labels.units(n.customers.count) : n.organisation ? `${n.organisation.openOrders} open` : "";
            const locked = n.stock && n.stock.lockedUnits > 0;
            return (
              <a key={n.id} href={n.href} data-testid="flow-node" data-kind={n.kind}>
                <rect x={p.x} y={p.y} width={NODE_W} height={NODE_H} rx={10} fill={n.status === "active" ? "#f5f5f4" : "#fafaf9"} stroke={locked ? "#dc2626" : "#d6d3d1"} strokeWidth={locked ? 2 : 1} />
                <text x={p.x + 10} y={p.y + 18} fontSize="12" fontWeight="600" className="fill-stone-900">
                  {n.name.length > 20 ? `${n.name.slice(0, 19)}…` : n.name}
                </text>
                <text x={p.x + 10} y={p.y + 36} fontSize="11" className="fill-stone-600">
                  {STATUS_ICON[n.status]} {stockText}
                </text>
                {locked ? (
                  <text x={p.x + NODE_W - 8} y={p.y + 16} fontSize="10" textAnchor="end" fill="#dc2626" fontWeight="700">
                    🔒 {labels.locked}
                  </text>
                ) : null}
                <title>{`${n.name} · ${labels.status(n.status)} · ${stockText}`}</title>
              </a>
            );
          })}
        </svg>
        <p className="mt-1 text-xs text-stone-500">{labels.legend}</p>
      </div>
      <details className="md:open" open>
        <summary className="cursor-pointer text-sm font-semibold">{labels.tableTitle}</summary>
        <table className="mt-2 w-full text-sm" data-testid="flow-table">
          <thead>
            <tr className="text-left text-stone-500">
              <th className="py-1">{labels.headers.node}</th>
              <th>{labels.headers.role}</th>
              <th>{labels.headers.status}</th>
              <th>{labels.headers.stock}</th>
              <th>{labels.headers.lastActivity}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {nodes.map((n) => (
              <tr key={n.id}>
                <td className="py-1">
                  <a href={n.href} className="underline">
                    {n.name}
                  </a>
                </td>
                <td>{labels.columns[n.kind]}</td>
                <td>
                  <span aria-hidden="true">{STATUS_ICON[n.status]}</span> {labels.status(n.status)}
                </td>
                <td>
                  {n.stock ? labels.units(n.stock.units) : n.customers ? labels.units(n.customers.count) : n.organisation ? `${n.organisation.openOrders} open` : "—"}
                  {n.stock && n.stock.lockedUnits > 0 ? <span className="ml-1 text-red-700">({n.stock.lockedUnits} {labels.locked})</span> : null}
                </td>
                <td>{labels.formatTime(n.lastActivityAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <ul className="mt-2 text-sm text-stone-700" aria-label={labels.tableTitle}>
          {drawable.length === 0 ? <li className="text-stone-500">{labels.noEdges}</li> : null}
          {drawable.map((e) => (
            <li key={`${e.kind}-${e.fromId}-${e.toId}`}>
              <span aria-hidden="true" style={{ color: COLOUR[e.paymentState] }}>
                ━
              </span>{" "}
              {nodes.find((n) => n.id === e.fromId)?.name} → {nodes.find((n) => n.id === e.toId)?.name}: {labels.edge(e)} · {labels.payment(e.paymentState)}
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}
