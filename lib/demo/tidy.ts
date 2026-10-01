/**
 * The demo district tidies up after itself (Prompt M, M6): real admins and field people handle what comes up, so the
 * demo does too, instead of piling problems on the admin home. After a day, simulated admins close ordinary problems
 * (two of them, as the rule says) and hub keepers finish deliveries left at inspection. A customer who felt unsafe,
 * suspected theft, a reversed payment and an unwell customer stay open: those always need a person, and a visitor
 * should see them. So does the newest delivery held for each kind of hold (a problem at inspection; damaged stock set
 * aside), so the map and the admin home always show what a held delivery looks like. Every step is the real service call.
 */
import { and, asc, desc, eq, lt } from "drizzle-orm";
import { nowMs } from "@/lib/clock";
import * as s from "@/lib/db/schema";
import { isLocked } from "@/lib/domain/custody";
import { decideApproval } from "@/lib/services/approvals";
import { getSetting, putSetting } from "@/lib/services/core";
import { proposeResolution } from "@/lib/services/exceptions";
import { parseLive } from "./live";
import type { World } from "./world";

/** Kinds of problem that always need a person: never closed by the demo. */
export const ALWAYS_HUMAN = new Set(["SAFETY_CONCERN", "SUSPECTED_THEFT", "PAYMENT_REVERSED", "CUSTOMER_UNWELL"]);
const DAY = 86_400_000;

export async function tidyUp(w: World, max = 4): Promise<{ resolved: number; resumed: number }> {
  const dayAgo = new Date(nowMs() - DAY);
  const old = await w.db.query.exceptions.findMany({ where: and(eq(s.exceptions.status, "OPEN"), lt(s.exceptions.createdAt, dayAgo)), orderBy: asc(s.exceptions.createdAt), limit: 30 });
  let resolved = 0;
  const shown = await newestHeldDeliveries(w);
  for (const ex of old) {
    if (resolved >= max) break;
    if (ALWAYS_HUMAN.has(ex.type) || shown.has(ex.id)) continue;
    const batch = ex.batchId ? await w.db.query.batches.findFirst({ where: eq(s.batches.id, ex.batchId) }) : null;
    const outcome = batch && isLocked(batch.custodyState) ? "RESUME" : "CLOSE";
    try {
      const { requestId } = await proposeResolution(w.adminA, ex.id, outcome, `${outcome === "RESUME" ? "Checked at the hub; the stock is good" : "Followed up with the people involved"} (demo)`);
      await decideApproval(w.adminB, requestId, "APPROVE", "Agreed (demo)");
      resolved++;
      w.manifest.count("tidy.resolved");
    } catch (e) {
      w.manifest.skip("tidy.resolve", e);
    }
  }
  // Deliveries left at inspection for more than a day, with nothing open on them: the hub keeper finishes them, one
  // step an hour, through the live engine (lib/demo/live.ts).
  const stuck = await w.db
    .select({ id: s.orders.id })
    .from(s.orders)
    .where(and(eq(s.orders.kind, "RIDER_TO_HUB"), eq(s.orders.state, "INSPECTING"), lt(s.orders.updatedAt, dayAgo)))
    .limit(10);
  const tracked = parseLive(await getSetting("demoLiveOrders"));
  const add: string[] = [];
  for (const o of stuck) {
    if (tracked.includes(o.id) || add.length >= 3) continue;
    const open = await w.db.query.exceptions.findFirst({ where: and(eq(s.exceptions.orderId, o.id), eq(s.exceptions.status, "OPEN")), columns: { id: true } });
    if (!open) add.push(o.id);
  }
  if (add.length) {
    await putSetting(w.db, "demoLiveOrders", [...tracked, ...add], w.adminA.userId);
    w.manifest.count("tidy.resumed", add.length);
  }
  return { resolved, resumed: add.length };
}

/** For each kind of hold, the newest open problem keeping stock locked: left for a visitor to see (and two admins to decide). */
async function newestHeldDeliveries(w: World): Promise<Set<string>> {
  const open = await w.db.query.exceptions.findMany({ where: eq(s.exceptions.status, "OPEN"), orderBy: desc(s.exceptions.createdAt), limit: 50 });
  const byState = new Map<string, string>();
  for (const ex of open) {
    if (!ex.batchId) continue;
    const batch = await w.db.query.batches.findFirst({ where: eq(s.batches.id, ex.batchId), columns: { custodyState: true, quantity: true } });
    if (batch && batch.quantity > 0 && isLocked(batch.custodyState) && !byState.has(batch.custodyState)) byState.set(batch.custodyState, ex.id);
  }
  return new Set(byState.values());
}
