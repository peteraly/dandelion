/**
 * The flow view (Prompt B §3.3, §9): the district map as server-rendered
 * inline SVG — the schematic `layoutDistrict` computes — and a table with the
 * same nodes and edges for keyboards, screen readers and phones. No charting
 * library, no client JavaScript.
 */
import { layoutDistrict } from "@/lib/ecosystem/district";
import { Name, displayName } from "@/components/name";
import type { AttentionKey, EcoEdge, EcoNode } from "@/lib/services/ecosystem";
import { DistrictMap, type MapLabels } from "./district-map";

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

export function FlowGraph({ nodes, edges, areas, attention, asOf, labels }: { nodes: EcoNode[]; edges: EcoEdge[]; areas: { id: string; name: string }[]; attention: AttentionKey | ""; asOf: string; labels: GraphLabels }) {
  const layout = layoutDistrict({ nodes, edges, areas, attention, asOf });
  const drawable = layout.edges.map((l) => l.edge);

  return (
    <div className="flex flex-col gap-3">
      <DistrictMap
        layout={layout}
        c={{
          columns: labels.columns,
          units: labels.units,
          locked: labels.locked,
          status: labels.status,
          payment: labels.payment,
          edge: labels.edge,
          money: labels.money,
          map: labels.map,
        }}
      />
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
                  <a href={n.href} className="underline">
                    <Name value={n.name} />
                  </a>
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
