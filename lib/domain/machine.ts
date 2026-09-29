/**
 * A tiny table-driven state machine. Pure: no I/O, no clock, no randomness.
 *
 * Each transition row names the states it may start from, the event, the
 * target state (fixed, or picked from an explicit set), the actors allowed
 * to fire it, and guards. A guard returns a failure reason or null.
 */
import type { ActorKind } from "./types";

export type Guard<C> = (ctx: C) => string | null;

export interface TransitionRow<S extends string, E extends string, C> {
  event: E;
  from: readonly S[];
  /** Fixed target, or a set of allowed targets plus a picker. */
  to: S | { oneOf: readonly S[]; pick: (ctx: C, from: S) => S };
  actors: readonly ActorKind[];
  guards?: readonly Guard<C>[];
}

export type TransitionResult<S extends string> =
  | { ok: true; to: S; rowIndex: number }
  | { ok: false; reason: string };

export interface Machine<S extends string, E extends string, C> {
  readonly name: string;
  readonly states: readonly S[];
  readonly rows: readonly TransitionRow<S, E, C>[];
  transition(from: S, event: E, actor: ActorKind, ctx: C): TransitionResult<S>;
  /** Events that could be valid from this state for this actor (ignoring guards). */
  eventsFrom(from: S, actor?: ActorKind): E[];
  /** Every (row, from, to) edge, for coverage tests and docs. */
  edges(): { rowIndex: number; event: E; from: S; to: S }[];
}

export function defineMachine<S extends string, E extends string, C>(
  name: string,
  states: readonly S[],
  rows: readonly TransitionRow<S, E, C>[],
): Machine<S, E, C> {
  const stateSet = new Set<string>(states);
  rows.forEach((r, i) => {
    for (const f of r.from) if (!stateSet.has(f)) throw new Error(`${name} row ${i}: unknown from-state ${f}`);
    const targets = typeof r.to === "string" ? [r.to] : r.to.oneOf;
    for (const t of targets) if (!stateSet.has(t)) throw new Error(`${name} row ${i}: unknown to-state ${t}`);
  });

  return {
    name,
    states,
    rows,
    transition(from, event, actor, ctx) {
      const candidates = rows
        .map((r, i) => ({ r, i }))
        .filter(({ r }) => r.event === event && r.from.includes(from));
      if (candidates.length === 0) return { ok: false, reason: `${name}: ${event} not allowed from ${from}` };
      let lastReason = "";
      for (const { r, i } of candidates) {
        if (!r.actors.includes(actor)) {
          lastReason = `${name}: ${actor} may not ${event}`;
          continue;
        }
        const failed = (r.guards ?? []).map((g) => g(ctx)).find((x) => x !== null);
        if (failed) {
          lastReason = `${name}: ${event} blocked: ${failed}`;
          continue;
        }
        let to: S;
        if (typeof r.to === "string") to = r.to;
        else {
          to = r.to.pick(ctx, from);
          if (!r.to.oneOf.includes(to)) return { ok: false, reason: `${name}: ${event} picked invalid target ${to}` };
        }
        return { ok: true, to, rowIndex: i };
      }
      return { ok: false, reason: lastReason };
    },
    eventsFrom(from, actor) {
      const out = new Set<E>();
      for (const r of rows) if (r.from.includes(from) && (!actor || r.actors.includes(actor))) out.add(r.event);
      return [...out];
    },
    edges() {
      const out: { rowIndex: number; event: E; from: S; to: S }[] = [];
      rows.forEach((r, i) => {
        const targets = typeof r.to === "string" ? [r.to] : r.to.oneOf;
        for (const f of r.from) for (const t of targets) out.push({ rowIndex: i, event: r.event, from: f, to: t });
      });
      return out;
    },
  };
}

/** Helper to build boolean guards with a stable reason code. */
export function requireTrue<C>(pick: (c: C) => boolean | undefined, reason: string): Guard<C> {
  return (c) => (pick(c) === true ? null : reason);
}
