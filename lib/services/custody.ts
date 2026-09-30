/**
 * Batch custody writes. Every change goes through the custody state machine,
 * appends a custody_events row, and (for registrations, transfers, handovers,
 * locks) a LedgerEvent — all in the caller's transaction.
 */
import { now } from "@/lib/clock";
import { eq, sql } from "drizzle-orm";
import type { Tx } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import { custodyMachine, canSplit, isLocked, INITIAL_CUSTODY_STATES, CUSTODY_TRANSFER_EVENTS, type CustodyCtx, type CustodyEvent, type SplitKind } from "@/lib/domain/custody";
import type { CustodyState } from "@/lib/domain/types";
import { humanCode, randomRef128 } from "@/lib/crypto/random";
import { tzDay } from "@/lib/util/time";
import { DomainError, recordLedgerEvent, type ServiceActor } from "./core";

export type Batch = typeof s.batches.$inferSelect;

export async function lockBatch(tx: Tx, batchId: string): Promise<Batch> {
  const rows = await tx.select().from(s.batches).where(eq(s.batches.id, batchId)).for("update");
  const b = rows[0];
  if (!b) throw new DomainError("not_found");
  return b;
}

async function uniqueBatchCode(tx: Tx): Promise<string> {
  for (let i = 0; i < 5; i++) {
    const code = `B-${humanCode(6)}`;
    const hit = await tx.query.batches.findFirst({ where: eq(s.batches.code, code), columns: { id: true } });
    if (!hit) return code;
  }
  throw new Error("could not allocate batch code");
}

export interface CustodyChange {
  orderId?: string | null;
  /** New custodian (for transfers). Undefined = unchanged; null = nobody (handed to customer). */
  custodianUserId?: string | null;
  hubId?: string | null;
  role?: string | null;
}

/** Apply one custody event. Throws DomainError if the machine refuses. */
export async function applyCustody(tx: Tx, batch: Batch, event: CustodyEvent, actor: ServiceActor, ctx: CustodyCtx, change: CustodyChange = {}): Promise<Batch> {
  const res = custodyMachine.transition(batch.custodyState, event, actor.kind, ctx);
  if (!res.ok) throw new DomainError("transition_refused", res.reason);
  const to = res.to;
  const locking = !isLocked(batch.custodyState) && isLocked(to);
  const unlocking = isLocked(batch.custodyState) && !isLocked(to);
  const [updated] = await tx
    .update(s.batches)
    .set({
      custodyState: to,
      lockedFromState: locking ? batch.custodyState : unlocking ? null : batch.lockedFromState,
      custodianUserId: change.custodianUserId === undefined ? batch.custodianUserId : change.custodianUserId,
      hubId: change.hubId === undefined ? batch.hubId : change.hubId,
      updatedAt: now(),
    })
    .where(eq(s.batches.id, batch.id))
    .returning();
  await tx.insert(s.custodyEvents).values({
    batchId: batch.id,
    event,
    fromState: batch.custodyState,
    toState: to,
    actorUserId: actor.userId,
    actorKind: actor.kind,
    fromCustodianId: batch.custodianUserId,
    toCustodianId: updated!.custodianUserId,
    orderId: change.orderId ?? null,
    quantity: batch.quantity,
  });
  if (CUSTODY_TRANSFER_EVENTS.includes(event)) {
    await recordLedgerEvent(tx, { type: "CUSTODY_TRANSFERRED", subjectRef: batch.code, batchId: batch.id, orderId: change.orderId ?? null, role: change.role ?? null });
  } else if (event === "CUSTOMER_HANDOVER") {
    await recordLedgerEvent(tx, { type: "HANDOVER_COMPLETED", subjectRef: batch.code, batchId: batch.id, orderId: change.orderId ?? null, role: change.role ?? actor.kind });
  }
  return updated!;
}

/** Register a new batch at the supplier (ledger: BATCH_REGISTERED). */
export async function registerBatch(
  tx: Tx,
  actor: ServiceActor,
  input: { supplierId: string; productId: string; serviceAreaId: string; quantity: number; sealId: string | null; custodianUserId: string; orderId: string | null },
): Promise<Batch> {
  const [b] = await tx
    .insert(s.batches)
    .values({
      code: await uniqueBatchCode(tx),
      verifyRef: randomRef128(),
      supplierId: input.supplierId,
      productId: input.productId,
      serviceAreaId: input.serviceAreaId,
      quantity: input.quantity,
      sealId: input.sealId,
      preparedOn: tzDay(),
      custodyState: INITIAL_CUSTODY_STATES.REGISTER,
      custodianUserId: input.custodianUserId,
    })
    .returning();
  await tx.insert(s.custodyEvents).values({
    batchId: b!.id,
    event: "REGISTER",
    fromState: null,
    toState: b!.custodyState,
    actorUserId: actor.userId,
    actorKind: actor.kind,
    toCustodianId: input.custodianUserId,
    orderId: input.orderId,
    quantity: input.quantity,
  });
  await recordLedgerEvent(tx, { type: "BATCH_REGISTERED", subjectRef: b!.code, batchId: b!.id, orderId: input.orderId, role: "SUPPLIER" });
  return b!;
}

/** Split `qty` units off an unlocked parent into a new reserved child lot. */
export async function splitBatch(tx: Tx, actor: ServiceActor, parent: Batch, kind: SplitKind, qty: number, orderId: string): Promise<Batch> {
  const refused = canSplit(kind, { state: parent.custodyState, quantity: parent.quantity }, qty);
  if (refused) throw new DomainError(refused);
  await tx.update(s.batches).set({ quantity: sql`${s.batches.quantity} - ${qty}`, updatedAt: now() }).where(eq(s.batches.id, parent.id));
  const state: CustodyState = INITIAL_CUSTODY_STATES[kind];
  const [child] = await tx
    .insert(s.batches)
    .values({
      code: await uniqueBatchCode(tx),
      verifyRef: randomRef128(),
      parentBatchId: parent.id,
      supplierId: parent.supplierId,
      productId: parent.productId,
      serviceAreaId: parent.serviceAreaId,
      quantity: qty,
      sealId: parent.sealId,
      preparedOn: parent.preparedOn,
      custodyState: state,
      // A lot delivered to an organisation leaves every custodian; nothing is tracked past it.
      custodianUserId: kind === "SPLIT_FOR_ORG" ? null : parent.custodianUserId,
      hubId: kind === "SPLIT_FOR_ORG" ? null : parent.hubId,
    })
    .returning();
  if (kind === "SPLIT_FOR_ORG") await recordLedgerEvent(tx, { type: "CUSTODY_TRANSFERRED", subjectRef: child!.code, batchId: child!.id, orderId, role: actor.kind });
  await tx.insert(s.custodyEvents).values({
    batchId: child!.id,
    event: kind,
    fromState: null,
    toState: state,
    actorUserId: actor.userId,
    actorKind: actor.kind,
    fromCustodianId: parent.custodianUserId,
    toCustodianId: parent.custodianUserId,
    orderId,
    quantity: qty,
  });
  return child!;
}

/** Return a cancelled child reservation's units to its parent lot. */
export async function returnToParent(tx: Tx, actor: ServiceActor, child: Batch, event: "CANCEL_CHAMPION_RESERVATION" | "CANCEL_CUSTOMER_RESERVATION", ctx: CustodyCtx, orderId: string): Promise<void> {
  if (!child.parentBatchId) throw new DomainError("not_a_split_lot");
  const parent = await lockBatch(tx, child.parentBatchId);
  if (isLocked(parent.custodyState)) throw new DomainError("batch_locked");
  await applyCustody(tx, child, event, actor, ctx, { orderId });
  await tx.update(s.batches).set({ quantity: sql`${s.batches.quantity} + ${child.quantity}`, updatedAt: now() }).where(eq(s.batches.id, parent.id));
  await tx.update(s.batches).set({ quantity: 0, updatedAt: now() }).where(eq(s.batches.id, child.id));
}
