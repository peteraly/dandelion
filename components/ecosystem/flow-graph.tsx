/**
 * The flow view (Prompt B §3.3, §9): the district map as server-rendered
 * inline SVG — the schematic `layoutDistrict` computes — and a table with the
 * same nodes and edges for keyboards, screen readers and phones. No charting
 * library, no client JavaScript.
 */
import Link from "next/link";
import { layoutDistrict } from "@/lib/ecosystem/district";
import { Name, displayName } from "@/components/name";
import type { AttentionKey, EcoEdge, EcoNode, OpenOrder, RecentPayment } from "@/lib/services/ecosystem";
import { DistrictMap, shortTzs, tileLines, type MapLabels } from "./district-map";

/** Text colours for the edge list — classes, not inline styles: the CSP allows no style attributes. */
const EDGE_TEXT: Record<EcoEdge["paymentState"], string> = {
  pending: "text-stone-400",
  confirmed: "text-green-600",
  review: "text-amber-600",
  hold: "text-red-600",
};

const STATUS_ICON: Record<EcoNode["status"], string> = {
  active: "●",
  inactive: "○",
  locked: "⛔",
  suspended: "⏸",
  pending: "…",
  invited: "✉",
};

export interface GraphLabels {
  columns: Record<EcoNode["kind"], string>;
  units: (n: number) => string;
  locked: string;
  status: (s: EcoNode["status"]) => string;
  payment: (p: EcoEdge["paymentState"]) => string;
  edge: (e: EcoEdge) => string;
  money: (n: number) => string;
  tableTitle: string;
  headers: {
    node: string;
    role: string;
    status: string;
    stock: string;
    lastActivity: string;
  };
  noEdges: string;
  formatTime: (iso: string | null) => string;
  map: MapLabels;
}

export function FlowGraph({
  nodes,
  edges,
  areas,
  attention,
  asOf,
  orders,
  payments,
  focus,
  focusHref,
  labels,
}: {
  nodes: EcoNode[];
  edges: EcoEdge[];
  areas: { id: string; name: string }[];
  attention: AttentionKey | "";
  asOf: string;
  orders: OpenOrder[];
  payments: RecentPayment[];
  focus: string | null;
  focusHref: (nodeId: string) => string;
  labels: GraphLabels;
}) {
  const layout = layoutDistrict({ nodes, edges, areas, attention, asOf, orders, payments, focus });
  const drawable = layout.edges.map((l) => l.edge);
  const c = { columns: labels.columns, units: labels.units, locked: labels.locked, status: labels.status, payment: labels.payment, edge: labels.edge, money: labels.money, map: labels.map, focusHref };
  // On a phone the map is too wide to read: the same places as a list, each opening its details, busiest first.
  const moving = new Map<string, number>();
  for (const m of layout.markers) for (const id of [layout.edges.find((l) => l.key === m.edgeKey)?.edge.fromId, layout.edges.find((l) => l.key === m.edgeKey)?.edge.toId]) if (id) moving.set(id, (moving.get(id) ?? 0) + m.items.length);
  const coinOf = new Map(layout.coins.map((k) => [k.tileId, k]));
  const phoneList = [...layout.tiles].sort((a, b) => Number(b.attention) - Number(a.attention) || (moving.get(b.id) ?? 0) - (moving.get(a.id) ?? 0) || Number(b.recent) - Number(a.recent));

  return (
    <div className="flex flex-col gap-3">
      <DistrictMap layout={layout} c={c} />
      <ul className="flex flex-col gap-2 md:hidden" data-testid="places-list">
        {phoneList.map((t) => {
          const [line2, line3] = tileLines(t, c);
          const coin = coinOf.get(t.id);
          return (
            <li key={t.id}>
              <Link href={focusHref(t.id)} scroll={false} className={`flex min-h-12 items-center justify-between gap-3 rounded-xl border bg-white p-3 ${t.focused ? "border-brand-600 ring-2 ring-brand-200" : t.attention ? "border-amber-300" : "border-stone-200"}`} data-testid="place">
                <span className="min-w-0">
                  <span className="block truncate font-medium">
                    {t.kind === "CUSTOMERS" ? (t.node.hubId ? labels.columns.CUSTOMERS : labels.map.direct) : <Name value={t.node.name} />}
                  </span>
                  <span className="block truncate text-xs text-stone-600">
                    {labels.columns[t.kind]} · {line2}
                    {line3 ? ` · ${line3}` : ""}
                  </span>
                </span>
                <span className="flex shrink-0 flex-col items-end gap-1 text-xs">
                  {t.recent ? <span className="text-green-700">● {labels.map.recent}</span> : null}
                  {moving.get(t.id) ? <span className="rounded-full bg-stone-100 px-2 py-0.5">{labels.map.moving(moving.get(t.id)!)}</span> : null}
                  {coin ? <span className="rounded-full bg-green-700 px-2 py-0.5 font-semibold text-white">+{shortTzs(coin.amountTzs)}</span> : null}
                  {t.locked ? <span className="text-red-700">🔒</span> : null}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
      <details className="text-sm" data-testid="flow-table-details">
        <summary className="cursor-pointer text-sm text-stone-600 underline decoration-dotted">
          {labels.tableTitle} · {nodes.length} · {drawable.length}
        </summary>
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
                  <Link href={focusHref(n.id)} scroll={false} className="underline" data-testid="flow-focus">
                    <Name value={n.name} />
                  </Link>
                </td>
                <td>{labels.columns[n.kind]}</td>
                <td>
                  <span aria-hidden="true">{STATUS_ICON[n.status]}</span> {labels.status(n.status)}
                </td>
                <td>
                  {n.stock ? labels.units(n.stock.units) : n.customers ? labels.units(n.customers.count) : n.organisation ? `${n.organisation.openOrders} open` : "—"}
                  {n.stock && n.stock.lockedUnits > 0 ? (
                    <span className="ml-1 text-red-700">
                      ({n.stock.lockedUnits} {labels.locked})
                    </span>
                  ) : null}
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
              <span aria-hidden="true" className={EDGE_TEXT[e.paymentState]}>
                ━
              </span>{" "}
              {displayName(nodes.find((n) => n.id === e.fromId)?.name ?? "")} → {displayName(nodes.find((n) => n.id === e.toId)?.name ?? "")}: {labels.edge(e)} · {labels.payment(e.paymentState)}
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}
