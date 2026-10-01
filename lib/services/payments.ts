/**
 * Payment intents and paid totals. Nothing here can confirm a payment:
 * confirmation lives only in lib/payments/verification.ts.
 */
import { and, asc, eq, or, sql } from "drizzle-orm";
import type { DbOrTx, Tx } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import { amountRuleFor } from "@/lib/domain/orders";
import { PURPOSE_BY_ORDER_KIND } from "@/lib/domain/types";
import { appEnv, paymentProviderId } from "@/lib/env";
import { DomainError, getSetting } from "./core";

export type Order = typeof s.orders.$inferSelect;
export type Intent = typeof s.paymentIntents.$inferSelect;

export interface PaidTotals {
  totalTzs: number;
  confirmedTzs: number;
  donorTzs: number;
  remainingTzs: number;
  hasConfirmed: boolean;
  fullyPaid: boolean;
}

export async function paidTotals(db: DbOrTx, order: Pick<Order, "id" | "totalTzs">): Promise<PaidTotals> {
  const [p] = await db
    .select({ sum: sql<number>`coalesce(sum(${s.paymentIntents.confirmedAmountTzs}), 0)::int`, n: sql<number>`count(*)::int` })
    .from(s.paymentIntents)
    .where(and(eq(s.paymentIntents.orderId, order.id), eq(s.paymentIntents.status, "PAYMENT_CONFIRMED")));
  const [d] = await db
    .select({ sum: sql<number>`coalesce(sum(${s.donorFundings.amountTzs}), 0)::int` })
    .from(s.donorFundings)
    .where(eq(s.donorFundings.orderId, order.id));
  // A payment that followed this order from one that passed on counts here; one that left with the order counts there.
  const [tr] = await db
    .select({
      sum: sql<number>`coalesce(sum(case when ${s.orderTransfers.toOrderId} = ${order.id} then ${s.orderTransfers.amountTzs} else -${s.orderTransfers.amountTzs} end), 0)::int`,
    })
    .from(s.orderTransfers)
    .where(or(eq(s.orderTransfers.toOrderId, order.id), eq(s.orderTransfers.fromOrderId, order.id)));
  const confirmedTzs = Number(p?.sum ?? 0) + Number(tr?.sum ?? 0);
  const donorTzs = Number(d?.sum ?? 0);
  const covered = confirmedTzs + donorTzs;
  // Invariant: coverage can never exceed the price (overpayments go to review, never counted).
  if (covered > order.totalTzs) throw new Error(`order ${order.id} over-covered: ${covered} > ${order.totalTzs}`);
  return {
    totalTzs: order.totalTzs,
    confirmedTzs,
    donorTzs,
    remainingTzs: order.totalTzs - covered,
    hasConfirmed: Number(p?.n ?? 0) > 0 || confirmedTzs > 0,
    fullyPaid: covered === order.totalTzs,
  };
}

export async function openIntent(db: DbOrTx, orderId: string): Promise<Intent | undefined> {
  return db.query.paymentIntents.findFirst({
    where: and(eq(s.paymentIntents.orderId, orderId), eq(s.paymentIntents.status, "PAYMENT_PENDING")),
    orderBy: asc(s.paymentIntents.createdAt),
  });
}

export async function latestIntent(db: DbOrTx, orderId: string): Promise<Intent | undefined> {
  return db.query.paymentIntents.findFirst({
    where: eq(s.paymentIntents.orderId, orderId),
    orderBy: sql`${s.paymentIntents.createdAt} desc`,
  });
}

/** Test collection account used outside production when none is set, so previews and tests never stall. */
export const TEST_PLATFORM_PAYEE = "TILL-DANDELION-TEST";

/**
 * Where the buyer pays for `order` (Prompt L §2.1): Dandelion's collection account when the route is PLATFORM, the
 * seller's registered payee otherwise. Never user input. Production with no collection account set refuses.
 */
export async function payeeFor(db: DbOrTx, order: Pick<Order, "sellerUserId">): Promise<{ payeeAccount: string; collectedByPlatform: boolean; sellerId: string }> {
  const seller = await db.query.users.findFirst({ where: eq(s.users.id, order.sellerUserId) });
  if (!seller) throw new DomainError("seller_has_no_payee_account");
  if ((await getSetting("paymentRoute", db)) === "PLATFORM") {
    const account = String(await getSetting("platformPayeeAccount", db)) || (appEnv() === "production" ? "" : TEST_PLATFORM_PAYEE);
    if (!account) throw new DomainError("platform_payee_not_set");
    return { payeeAccount: account, collectedByPlatform: true, sellerId: seller.id };
  }
  if (!seller.payeeAccount) throw new DomainError("seller_has_no_payee_account");
  return { payeeAccount: seller.payeeAccount, collectedByPlatform: false, sellerId: seller.id };
}

/**
 * Make sure the order has one PENDING intent for the remaining balance.
 * Payee: Dandelion's collection account or the seller's registered payee (payeeFor) — never user input.
 */
export async function ensureOpenIntent(tx: Tx, order: Order): Promise<Intent> {
  const existing = await openIntent(tx, order.id);
  if (existing) return existing;
  const totals = await paidTotals(tx, order);
  if (totals.remainingTzs <= 0) throw new DomainError("already_fully_paid");
  const payee = await payeeFor(tx, order);
  const [intent] = await tx
    .insert(s.paymentIntents)
    .values({
      orderId: order.id,
      purpose: PURPOSE_BY_ORDER_KIND[order.kind],
      provider: paymentProviderId(),
      payerUserId: order.buyerUserId,
      payerCustomerId: order.customerId,
      payeeUserId: payee.sellerId,
      payeeAccount: payee.payeeAccount,
      collectedByPlatform: payee.collectedByPlatform,
      amountTzs: totals.remainingTzs,
      amountRule: amountRuleFor(order.kind),
      status: "PAYMENT_PENDING",
    })
    .returning();
  return intent!;
}

/** Queue a provider status poll for an intent (the payer says they paid). */
export async function enqueuePoll(db: DbOrTx, intent: Intent): Promise<string> {
  const [job] = await db
    .insert(s.verificationJobs)
    .values({ paymentIntentId: intent.id, provider: intent.provider, status: "QUEUED" })
    .returning({ id: s.verificationJobs.id });
  return job!.id;
}
