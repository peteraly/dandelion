/**
 * The ecosystem view (Prompt B §3), rendered by /admin/ecosystem (with the
 * admin sidebar) and by /admin/present (Prompt D §5.8, full width). Filters,
 * sort and the attention focus live in the URL so a refresh keeps them.
 */
import Link from "next/link";
import { displayName, Name } from "@/components/name";
import { getLocale, getTranslations } from "next-intl/server";
import { Badge, Card } from "@/components/ui";
import { FlowGraph } from "./flow-graph";
import { LiveRefresh } from "./live-refresh";
import { requireAdmin } from "@/lib/auth/current";
import { appEnv, simulatorEnabled } from "@/lib/env";
import { tickAction } from "@/app/dev/simulator/actions";
import { ATTENTION_KEYS, ecosystemSnapshot, logEcosystemView, WINDOWS, type AttentionKey, type EcosystemSnapshot, type OpenOrder, type Window } from "@/lib/services/ecosystem";
import { formatTzs } from "@/lib/money";
import { isHumanRef } from "@/lib/domain/events";
import { formatDateTime } from "@/lib/util/time";
import type { SearchParams } from "@/lib/actions";

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

function href(base: Record<string, string>, patch: Record<string, string | null>, path = "/admin/ecosystem"): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...base, ...patch })) if (v) p.set(k, v);
  const qs = p.toString();
  return `${path}${qs ? `?${qs}` : ""}`;
}

function sortRows<T>(rows: T[], sort: string, table: string, keys: Record<string, (r: T) => number | string | null>): T[] {
  const [t, col, dir] = sort.split(".");
  if (t !== table || !col || !keys[col]) return rows;
  const get = keys[col]!;
  const sorted = [...rows].sort((a, b) => {
    const x = get(a);
    const y = get(b);
    if (x === null || x === undefined) return 1;
    if (y === null || y === undefined) return -1;
    return x < y ? -1 : x > y ? 1 : 0;
  });
  return dir === "desc" ? sorted.reverse() : sorted;
}

/** The view itself; `present` (Prompt D §5.8) drops the side column so the map takes the full width. */
export async function EcosystemView({ searchParams, present = false }: { searchParams: SearchParams; present?: boolean }) {
  const { actor, session } = await requireAdmin();
  const path = present ? "/admin/present" : "/admin/ecosystem";
  const sp = await searchParams;
  const t = await getTranslations("ecosystem");
  const tk = await getTranslations("orderKinds");
  const tp = await getTranslations("problems");
  const locale = (await getLocale()) as "sw" | "en";
  const windowParam = one(sp.window);
  const window: Window = (WINDOWS as readonly string[]).includes(windowParam) ? (windowParam as Window) : "24h";
  const areaId = one(sp.area) || null;
  const hubId = one(sp.hub) || null;
  const attention = one(sp.attention) as AttentionKey | "";
  const sort = one(sp.sort);
  const intervalParam = Number(one(sp.interval));
  const intervalSeconds = appEnv() !== "production" && intervalParam >= 1 ? intervalParam : 30;
  const base: Record<string, string> = { window, area: areaId ?? "", hub: hubId ?? "", attention, sort };
  const ticked = one(sp.ticked);

  await logEcosystemView(actor, session.id);
  const snap: EcosystemSnapshot = await ecosystemSnapshot(actor, { areaId, hubId, window });
  const attentionTotal = ATTENTION_KEYS.reduce((a, k) => a + snap.attention[k], 0);
  const asOfMs = new Date(snap.asOf).getTime();
  const fmt = (iso: string | null) => (iso ? formatDateTime(new Date(iso), locale) : "—");
  const money = (n: number) => formatTzs(n, locale);

  const hubs = sortRows(
    snap.nodes.filter((n) => n.kind === "HUB" && (attention !== "hubsBelowMin" || (n.hub && n.hub.available < n.hub.minStockUnits))),
    sort,
    "hubs",
    { name: (n) => n.name, available: (n) => n.hub?.available ?? 0, min: (n) => n.hub?.minStockUnits ?? 0, pendingIn: (n) => n.hub?.pendingIn ?? 0, pendingOut: (n) => n.hub?.pendingOut ?? 0, last: (n) => n.lastActivityAt },
  );
  const champions = sortRows(
    snap.nodes.filter((n) => n.kind === "CHAMPION" && (attention !== "silentNodes" || !n.lastActivityAt || asOfMs - new Date(n.lastActivityAt).getTime() > 7 * 86_400_000)),
    sort,
    "champions",
    { name: (n) => n.name, customers: (n) => n.champion?.customers ?? 0, active: (n) => n.champion?.activePlans ?? 0, stalled: (n) => n.champion?.stalledPlans ?? 0, stock: (n) => n.stock?.units ?? 0, last: (n) => n.champion?.lastSaleAt ?? null },
  );
  const orderFilter = (o: OpenOrder): boolean => {
    switch (attention) {
      case "paymentReviews":
        return o.paymentState === "review";
      case "paymentsPendingLong":
        return o.paymentState === "pending";
      case "lockedBatches":
        return o.paymentState === "hold";
      case "handoverPending":
        return o.state === "FULLY_PAID" || o.state === "HANDOVER_PENDING";
      case "waitingOnSupplier":
        return o.state === "PICKUP_ASSIGNED";
      case "orgOrdersUnpaid":
        return o.kind.endsWith("_TO_ORG") && o.state === "AWAITING_PAYMENT";
      default:
        return true;
    }
  };
  const openOrders = sortRows(snap.openOrders.filter(orderFilter), sort, "orders", { ref: (o) => o.ref, kind: (o) => o.kind, from: (o) => o.fromName, to: (o) => o.toName, units: (o) => o.units, amount: (o) => o.totalTzs, age: (o) => o.ageDays, payment: (o) => o.paymentState });
  const sortLink = (table: string, col: string, label: string) => {
    const current = sort === `${table}.${col}` ? `${table}.${col}.desc` : `${table}.${col}`;
    return (
      <Link href={href(base, { sort: current }, path)} className="underline decoration-dotted">
        {label}
        {sort.startsWith(`${table}.${col}`) ? (sort.endsWith(".desc") ? " ↓" : " ↑") : ""}
      </Link>
    );
  };
  const tt = await getTranslations("ecosystem.tables");
  const ta = await getTranslations("ecosystem.attention");
  const tg = await getTranslations("ecosystem.graph");
  const tm = await getTranslations("ecosystem.map");
  const tst = await getTranslations("ecosystem.status");
  const tpay = await getTranslations("ecosystem.payment");
  const tsys = await getTranslations("ecosystem.system");
  const tf = await getTranslations("ecosystem.feed");
  const problemLabel = (type: string | null) => (type && tp.has(`${type}.label`) ? tp(`${type}.label`) : (type ?? ""));

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold">{t("title")}</h1>
          <p className="text-sm text-stone-600">{t("subtitle")}</p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <div className="flex items-center gap-2 text-xs">
            {!present ? (
              <Link href={href(base, {}, "/admin/present")} className="underline" data-testid="present-link">
                {t("present")}
              </Link>
            ) : null}
            <Badge tone={snap.system.environment === "production" ? "red" : "amber"}>{snap.system.environment}</Badge>
            <span className="font-mono text-stone-500" data-testid="app-version">
              {snap.system.version}
            </span>
          </div>
          <LiveRefresh intervalSeconds={intervalSeconds} attentionTotal={attentionTotal} asOf={new Date(snap.asOf).toLocaleTimeString(locale === "sw" ? "sw-TZ" : "en-GB", { timeZone: "Africa/Dar_es_Salaam" })} labels={{ live: t("live"), paused: t("paused"), pause: t("pause"), resume: t("resume"), idle: t("idle"), hidden: t("hidden"), asOf: t("asOf", { time: "{time}" }) }} />
        </div>
      </div>

      <nav className="flex flex-wrap items-center gap-2 text-sm" aria-label={t("window")}>
        <span className="text-stone-500">{t("window")}:</span>
        {WINDOWS.map((w) => (
          <Link key={w} href={href(base, { window: w }, path)} className={`btn w-auto min-h-12 px-3 py-1 text-sm ${window === w ? "btn-primary" : "btn-secondary"}`} aria-current={window === w ? "true" : undefined} data-testid={`window-${w}`}>
            {t(`windows.${w}`)}
          </Link>
        ))}
        <span className="ml-3 text-stone-500">{t("area")}:</span>
        <Link href={href(base, { area: null, hub: null }, path)} className={`btn w-auto min-h-12 px-3 py-1 text-sm ${!areaId && !hubId ? "btn-primary" : "btn-secondary"}`}>
          {t("all")}
        </Link>
        {snap.areas.map((a) => (
          <Link key={a.id} href={href(base, { area: a.id, hub: null }, path)} className={`btn w-auto min-h-12 px-3 py-1 text-sm ${areaId === a.id ? "btn-primary" : "btn-secondary"}`}>
            {displayName(a.name)}
          </Link>
        ))}
        <span className="ml-3 text-stone-500">{t("hub")}:</span>
        {snap.hubs
          .filter((h) => !areaId || h.areaId === areaId)
          .map((h) => (
            <Link key={h.id} href={href(base, { hub: h.id, area: null }, path)} className={`btn w-auto min-h-12 px-3 py-1 text-sm ${hubId === h.id ? "btn-primary" : "btn-secondary"}`}>
              {displayName(h.name)}
            </Link>
          ))}
      </nav>

      <section aria-label={ta("title")} className="flex flex-wrap gap-2" data-testid="attention-strip">
        {ATTENTION_KEYS.map((k) => {
          const count = snap.attention[k];
          const active = attention === k;
          return (
            <Link
              key={k}
              href={href(base, { attention: active ? null : k }, path)}
              aria-current={active ? "true" : undefined}
              className={`inline-flex min-h-12 items-center gap-2 rounded-full border px-3 py-1 text-sm ${active ? "border-brand-700 bg-brand-100 text-brand-800" : count > 0 ? "border-amber-300 bg-amber-50 text-amber-950" : "border-stone-200 bg-stone-100 text-stone-700"}`}
              data-testid={`attention-${k}`}
            >
              <span className="font-bold tabular-nums">{count}</span>
              <span>{ta(k)}</span>
            </Link>
          );
        })}
        {attention ? (
          <Link href={href(base, { attention: null }, path)} className="inline-flex min-h-12 items-center rounded-full border border-stone-300 px-3 py-1 text-sm underline">
            {ta("clear")}
          </Link>
        ) : null}
      </section>
      {attention === "openExceptions" && Object.keys(snap.attention.openExceptionsByType).length ? (
        <p className="text-sm text-stone-700" data-testid="exceptions-by-type">
          {Object.entries(snap.attention.openExceptionsByType)
            .map(([type, n]) => `${problemLabel(type)}: ${n}`)
            .join(" · ")}
        </p>
      ) : null}

      <div className={present ? "grid gap-4" : "grid gap-4 2xl:grid-cols-[minmax(0,1fr)_320px]"}>
        <Card>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-semibold">{tm("title")}</h2>
            {snap.system.demo && simulatorEnabled() ? (
              // The SimCity speed knob (prompt §9.1): the same admin-only, rate-limited, logged server action as /dev/simulator.
              <div className="flex items-center gap-2 text-sm" data-testid="map-speed">
                <span className="text-stone-500">{tm("speed")}:</span>
                {(["hour", "day"] as const).map((k) => (
                  <form key={k} action={tickAction}>
                    <input type="hidden" name="kind" value={k} />
                    <input type="hidden" name="redirectTo" value={href(base, {}, path)} />
                    <button type="submit" className="btn btn-secondary w-auto min-h-12 px-3 py-1 text-sm" data-testid={`map-tick-${k}`}>
                      {tm(k)}
                    </button>
                  </form>
                ))}
              </div>
            ) : null}
          </div>
          {ticked === "hour" || ticked === "day" ? (
            <p className="mb-2 rounded-xl bg-green-50 p-2 text-sm text-green-900" data-testid="map-ticked">
              {ticked === "hour" ? tm("tickedHour") : tm("tickedDay")}
            </p>
          ) : null}
          <FlowGraph
            nodes={snap.nodes}
            edges={snap.edges}
            areas={snap.areas}
            attention={attention}
            asOf={snap.asOf}
            labels={{
              columns: { SUPPLIER: tg("suppliers"), RIDER: tg("riders"), HUB: tg("hubs"), CHAMPION: tg("champions"), CUSTOMERS: tg("customers"), ORGANISATION: tg("organisations") },
              units: (n) => tg("units", { n }),
              locked: tg("locked"),
              status: (st) => tst(st),
              payment: (p) => tpay(p),
              edge: (e) => tg("edge", { count: e.count, units: e.units, paid: money(e.confirmedTzs), expected: money(e.expectedTzs) }),
              money,
              tableTitle: tg("tableTitle"),
              headers: { node: tg("node"), role: tg("role"), status: tg("status"), stock: tg("stock"), lastActivity: tg("lastActivity") },
              noEdges: tg("noEdges"),
              formatTime: fmt,
              map: {
                title: tm("title"),
                legend: tm("legend"),
                earned: (tzs) => tm("earned", { tzs }),
                confirmed: (tzs) => tm("confirmed", { tzs }),
                plans: (active, stalled) => tm("plans", { active, stalled }),
                min: (n) => tm("min", { n }),
                open: (n) => tm("open", { n }),
                customers: (n) => tm("customers", { n }),
                handover: (n) => tm("handover", { n }),
                waiting: (n) => tm("waiting", { n }),
                quality: (n) => tm("quality", { n }),
                marker: (n) => tm("marker", { n }),
                attention: tm("attention"),
                direct: tm("direct"),
              },
            }}
          />
        </Card>
        {/* A scrollable region must be reachable by keyboard (axe scrollable-region-focusable): focusable and labelled. */}
        <Card className="max-h-[720px] overflow-y-auto focus:outline-2 focus:outline-brand-700" tabIndex={0} aria-labelledby="feed-title">
          <h2 id="feed-title" className="mb-2 font-semibold">
            {tf("title")}
          </h2>
          <ol className="divide-y divide-stone-100 text-sm" data-testid="feed" aria-live="polite">
            {snap.feed.length === 0 ? <li className="py-2 text-stone-500">{tf("empty")}</li> : null}
            {snap.feed.map((item) => (
              <li key={item.id} className="py-2" data-testid="feed-item">
                <div className="flex items-start justify-between gap-2">
                  <span>
                    <span className={item.severity === "ALERT" ? "font-semibold text-red-800" : item.severity === "WARN" ? "font-semibold text-amber-800" : ""}>
                      {item.source === "security" && item.labelKey === "PROBLEM" ? tf("security.PROBLEM", { type: problemLabel(item.problem) }) : tf(`${item.source}.${item.labelKey}`)}
                    </span>
                    {item.subject && isHumanRef(item.subject) ? <span className="ml-1 font-mono text-xs text-stone-600">{item.subject}</span> : null}
                    {item.actor ? (
                      <span className="block text-xs text-stone-500">
                        <Name value={item.actor} />
                      </span>
                    ) : null}
                  </span>
                  <time dateTime={item.at} className="shrink-0 text-xs text-stone-500">
                    {fmt(item.at)}
                  </time>
                </div>
              </li>
            ))}
          </ol>
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <h2 className="mb-2 font-semibold">{t("money.title")}</h2>
          <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-sm">
            {Object.entries(snap.money.byKind).map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="text-stone-600">{tk(k)}</dt>
                <dd className="text-right font-medium tabular-nums" data-testid={`money-${k}`}>
                  {money(v)}
                </dd>
              </div>
            ))}
          </dl>
          <p className="mt-2 text-sm text-stone-600">
            {t("money.pendingIntents", { n: snap.money.pendingIntents })} · {t("money.reviewIntents", { n: snap.money.reviewIntents })}
          </p>
          <p className="text-sm text-stone-600">{t("money.plans", { active: snap.money.plans.active, completed: snap.money.plans.completedInWindow, stalled: snap.money.plans.stalled })}</p>
        </Card>
        <Card>
          <h2 className="mb-2 font-semibold">{tsys("title")}</h2>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            <dt className="text-stone-600">{tsys("heartbeats")}</dt>
            <dd>
              {snap.system.heartbeats.length === 0 ? tsys("never") : null}
              {snap.system.heartbeats.map((h) => (
                <span key={h.name} className="mr-3 inline-block">
                  <span className="font-mono">{h.name}</span> {h.status}
                  {h.manual ? <Badge tone="amber">{tsys("manual")}</Badge> : null} <span className="text-stone-500">{tsys("ago", { n: h.ageSeconds })}</span>
                </span>
              ))}
            </dd>
            <dt className="text-stone-600">{tsys("anchoring")}</dt>
            <dd>
              {snap.system.anchoring.configured ? `${snap.system.anchoring.network} · ${snap.system.anchoring.lastStatus ?? "—"} · ${fmt(snap.system.anchoring.lastAnchorAt)}` : tsys("notConfigured")} · {tsys("unanchored", { n: snap.system.anchoring.unanchored })}
            </dd>
            <dt className="text-stone-600">{tsys("sms")}</dt>
            <dd>{snap.system.smsOutbox24h}</dd>
            <dt className="text-stone-600">{tsys("providers")}</dt>
            <dd className="font-mono">
              {snap.system.paymentProvider} · {snap.system.smsProvider}
            </dd>
            <dt className="text-stone-600">{tsys("ai")}</dt>
            <dd>{snap.system.ai.enabled ? tsys("aiOn", { calls: snap.system.ai.monthCalls, usd: `$${(snap.system.ai.monthCostMicroUsd / 1_000_000).toFixed(2)}` }) : tsys("aiOff")}</dd>
            <dt className="text-stone-600">{tsys("seedProfile")}</dt>
            <dd data-testid="seed-profile">{snap.system.seedProfile || "—"}</dd>
          </dl>
        </Card>
      </div>

      <Card>
        <h2 className="mb-2 font-semibold">{tt("hubs")}</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm" data-testid="hubs-table">
            <thead>
              <tr className="text-left text-stone-500">
                <th className="py-1">{sortLink("hubs", "name", tt("name"))}</th>
                <th>{sortLink("hubs", "available", tt("available"))}</th>
                <th>{sortLink("hubs", "min", tt("min"))}</th>
                <th>{sortLink("hubs", "pendingIn", tt("pendingIn"))}</th>
                <th>{sortLink("hubs", "pendingOut", tt("pendingOut"))}</th>
                <th>{tt("manager")}</th>
                <th>{sortLink("hubs", "last", tg("lastActivity"))}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {hubs.map((h) => (
                <tr key={h.id} data-testid="hub-row" className={h.hub && h.hub.available < h.hub.minStockUnits ? "bg-amber-50" : ""}>
                  <td className="py-1">
                    <Link href={h.href} className="underline">
                      <Name value={h.name} />
                    </Link>
                    {h.stock && h.stock.lockedUnits > 0 ? <span className="ml-1 text-red-700">🔒 {h.stock.lockedUnits}</span> : null}
                  </td>
                  <td className="tabular-nums">{h.hub?.available ?? 0}</td>
                  <td className="tabular-nums">{h.hub?.minStockUnits ?? 0}</td>
                  <td className="tabular-nums">{h.hub?.pendingIn ?? 0}</td>
                  <td className="tabular-nums">{h.hub?.pendingOut ?? 0}</td>
                  <td>{h.hub?.manager ? <Name value={h.hub.manager} /> : "—"}</td>
                  <td>{fmt(h.lastActivityAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {hubs.length === 0 ? <p className="text-stone-500">{tt("none")}</p> : null}
        </div>
      </Card>

      <Card>
        <h2 className="mb-2 font-semibold">{tt("champions")}</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm" data-testid="champions-table">
            <thead>
              <tr className="text-left text-stone-500">
                <th className="py-1">{sortLink("champions", "name", tt("name"))}</th>
                <th>{sortLink("champions", "customers", tt("customers"))}</th>
                <th>{sortLink("champions", "active", tt("activePlans"))}</th>
                <th>{sortLink("champions", "stalled", tt("stalledPlans"))}</th>
                <th>{sortLink("champions", "stock", tg("stock"))}</th>
                <th>{sortLink("champions", "last", tt("lastSale"))}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {champions.map((c) => (
                <tr key={c.id} data-testid="champion-row">
                  <td className="py-1">
                    <Link href={c.href} className="underline">
                      <Name value={c.name} />
                    </Link>{" "}
                    <span className="text-xs text-stone-500">{tst(c.status)}</span>
                  </td>
                  <td className="tabular-nums">{c.champion?.customers ?? 0}</td>
                  <td className="tabular-nums">{c.champion?.activePlans ?? 0}</td>
                  <td className="tabular-nums">{c.champion?.stalledPlans ?? 0}</td>
                  <td className="tabular-nums">{c.stock?.units ?? 0}</td>
                  <td>{fmt(c.champion?.lastSaleAt ?? null)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {champions.length === 0 ? <p className="text-stone-500">{tt("none")}</p> : null}
        </div>
      </Card>

      <Card>
        <h2 className="mb-2 font-semibold">{tt("openOrders")}</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm" data-testid="orders-table">
            <thead>
              <tr className="text-left text-stone-500">
                <th className="py-1">{sortLink("orders", "ref", tt("name"))}</th>
                <th>{sortLink("orders", "kind", tt("kind"))}</th>
                <th>{sortLink("orders", "from", tt("from"))}</th>
                <th>{sortLink("orders", "to", tt("to"))}</th>
                <th>{sortLink("orders", "units", tg("stock"))}</th>
                <th>{sortLink("orders", "amount", t("money.title"))}</th>
                <th>{sortLink("orders", "age", tt("age"))}</th>
                <th>{sortLink("orders", "payment", tt("payment"))}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {openOrders.map((o) => (
                <tr key={o.id} data-testid="order-row" data-payment={o.paymentState}>
                  <td className="py-1 font-mono">
                    <Link href={`/admin/orders/${o.id}`} className="underline">
                      {o.ref}
                    </Link>
                  </td>
                  <td>{tk(o.kind)}</td>
                  <td>
                    <Name value={o.fromName} />
                  </td>
                  <td>
                    <Name value={o.toName} />
                  </td>
                  <td className="tabular-nums">{o.units}</td>
                  <td className="tabular-nums">
                    {money(o.confirmedTzs)} / {money(o.totalTzs)}
                  </td>
                  <td className="tabular-nums">{o.ageDays}</td>
                  <td>
                    <Badge tone={o.paymentState === "confirmed" ? "green" : o.paymentState === "review" ? "amber" : o.paymentState === "hold" ? "red" : "neutral"}>{tpay(o.paymentState)}</Badge> <span className="text-xs text-stone-500">{o.state.replace(/_/g, " ")}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {openOrders.length === 0 ? <p className="text-stone-500">{tt("none")}</p> : null}
        </div>
      </Card>
    </>
  );
}
