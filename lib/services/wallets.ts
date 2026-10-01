/**
 * Balances and withdrawals (founders, 2026-10-01; Prompt L §2). Buyers pay Dandelion's collection account; each
 * confirmed payment is credited to the seller it was for (lib/domain/wallet.ts has the arithmetic). Members see
 * their balance and choose when to withdraw; only admins move money: one approves, a different one sends it from the
 * collection account and records the provider's reference. Nothing here talks to a payout API: the admin sends with
 * the provider's own tools and the app keeps the record.
 */
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { now } from "@/lib/clock";
import { getDb, type DbOrTx } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import { humanCode } from "@/lib/crypto/random";
import { decryptString } from "@/lib/crypto/envelope";
import { balance, withdrawalRefusal, type Balance, type CreditRow } from "@/lib/domain/wallet";
import type { WithdrawalState } from "@/lib/domain/types";
import { authorize, type Actor } from "@/lib/policy";
import { getSmsProvider } from "@/lib/sms";
import { tr, type Locale } from "@/lib/i18n/server-translator";
import { formatTzs } from "@/lib/money";
import { DomainError, getSetting, logAdminAction, recordLedgerEvent, withTx } from "./core";

export type Withdrawal = typeof s.withdrawals.$inferSelect;

/** Credits per order for one member, or for everyone (grouped by member). */
async function creditRows(db: DbOrTx, userId?: string): Promise<(CreditRow & { userId: string })[]> {
  const rows = await db
    .select({
      userId: s.paymentIntents.payeeUserId,
      orderState: s.orders.state,
      platformFeeTzs: s.orders.platformFeeTzs,
      confirmedTzs: sql<number>`coalesce(sum(${s.paymentIntents.confirmedAmountTzs}), 0)::int`,
    })
    .from(s.paymentIntents)
    .innerJoin(s.orders, eq(s.orders.id, s.paymentIntents.orderId))
    .where(and(eq(s.paymentIntents.collectedByPlatform, true), eq(s.paymentIntents.status, "PAYMENT_CONFIRMED"), userId ? eq(s.paymentIntents.payeeUserId, userId) : undefined))
    .groupBy(s.paymentIntents.payeeUserId, s.orders.id, s.orders.state, s.orders.platformFeeTzs);
  return rows.map((r) => ({ ...r, confirmedTzs: Number(r.confirmedTzs) }));
}

/** One member's balance, computed from confirmed payments and their withdrawals. */
export async function balanceFor(db: DbOrTx, userId: string): Promise<Balance> {
  const credits = await creditRows(db, userId);
  const ws = await db.select({ amountTzs: s.withdrawals.amountTzs, state: s.withdrawals.state }).from(s.withdrawals).where(eq(s.withdrawals.userId, userId));
  return balance(credits, ws);
}

export interface Wallet extends Balance {
  minTzs: number;
  /** Masked payout number the money goes to (set by an admin at enrolment; never typed by the member). */
  payoutTo: string | null;
  withdrawals: Withdrawal[];
  platformCollects: boolean;
}

/** What a member sees on their wallet page. */
export async function myWallet(actor: Actor): Promise<Wallet> {
  authorize(actor, "wallet.view");
  const db = getDb();
  const user = await db.query.users.findFirst({ where: eq(s.users.id, actor.userId) });
  return {
    ...(await balanceFor(db, actor.userId)),
    minTzs: Number(await getSetting("withdrawalMinTzs")),
    payoutTo: user?.payeeAccount ?? null,
    withdrawals: await db.query.withdrawals.findMany({ where: eq(s.withdrawals.userId, actor.userId), orderBy: desc(s.withdrawals.createdAt), limit: 20 }),
    platformCollects: (await getSetting("paymentRoute")) === "PLATFORM",
  };
}

async function uniqueWithdrawalRef(tx: DbOrTx): Promise<string> {
  for (let i = 0; i < 6; i++) {
    const ref = `WD-${humanCode(6)}`;
    if (!(await tx.query.withdrawals.findFirst({ where: eq(s.withdrawals.ref, ref), columns: { id: true } }))) return ref;
  }
  throw new Error("could not allocate withdrawal reference");
}

/** A member asks to withdraw `amountTzs` of their available balance to their registered payout number. */
export async function requestWithdrawal(actor: Actor, raw: { amountTzs: number }): Promise<{ withdrawalId: string; ref: string }> {
  authorize(actor, "wallet.withdraw");
  const { amountTzs } = z.object({ amountTzs: z.coerce.number().int().positive().max(100_000_000) }).strict().parse(raw);
  return withTx(async (tx) => {
    // One request at a time per member: lock the member's row so two taps cannot both pass the balance check.
    const [user] = await tx.select().from(s.users).where(eq(s.users.id, actor.userId)).for("update");
    if (!user || user.status !== "ACTIVE") throw new DomainError("not_active");
    if (!user.payeeAccount) throw new DomainError("no_payout_account");
    const refused = withdrawalRefusal(amountTzs, await balanceFor(tx, actor.userId), Number(await getSetting("withdrawalMinTzs", tx)));
    if (refused) throw new DomainError(refused);
    const ref = await uniqueWithdrawalRef(tx);
    const [w] = await tx.insert(s.withdrawals).values({ ref, userId: actor.userId, amountTzs, payeeAccount: user.payeeAccount }).returning({ id: s.withdrawals.id });
    return { withdrawalId: w!.id, ref };
  });
}

async function lockWithdrawal(tx: DbOrTx, id: string): Promise<Withdrawal> {
  const [w] = await tx.select().from(s.withdrawals).where(eq(s.withdrawals.id, id)).for("update");
  if (!w) throw new DomainError("not_found");
  return w;
}

async function notifyMember(tx: DbOrTx, w: Withdrawal, key: "sms.payoutSent" | "sms.payoutRejected"): Promise<void> {
  const user = await tx.query.users.findFirst({ where: eq(s.users.id, w.userId) });
  if (!user) return;
  const locale: Locale = user.preferredLocale;
  await getSmsProvider().send(await decryptString(user.phoneEnc), tr(locale, key, { name: user.displayName, amount: formatTzs(w.amountTzs, locale), ref: w.ref }), key === "sms.payoutSent" ? "PAYOUT_SENT" : "PAYOUT_REJECTED", tx);
}

/** The first admin agrees the money is owed and may go. */
export async function approveWithdrawal(actor: Actor, id: string): Promise<void> {
  authorize(actor, "admin.payout.decide");
  await withTx(async (tx) => {
    const w = await lockWithdrawal(tx, id);
    if (w.state !== "REQUESTED") throw new DomainError("withdrawal_not_requested");
    // The request already counts against the balance; refuse if a reversal has since left the member overdrawn.
    if ((await balanceFor(tx, w.userId)).overdrawn) throw new DomainError("withdrawal_exceeds_available");
    await tx.update(s.withdrawals).set({ state: "APPROVED", approvedBy: actor.userId, approvedAt: now(), updatedAt: now() }).where(eq(s.withdrawals.id, id));
    await logAdminAction(tx, actor.userId, "payout.approve", { type: "withdrawal", id }, { ref: w.ref, amountTzs: w.amountTzs });
  });
}

/** A second admin sends the money from the collection account and records the provider's reference. */
export async function sendWithdrawal(actor: Actor, id: string, raw: { providerRef: string }): Promise<void> {
  authorize(actor, "admin.payout.decide");
  const { providerRef } = z.object({ providerRef: z.string().trim().regex(/^[A-Za-z0-9-]{4,40}$/) }).strict().parse(raw);
  await withTx(async (tx) => {
    const w = await lockWithdrawal(tx, id);
    if (w.state !== "APPROVED") throw new DomainError("withdrawal_not_approved");
    if (w.approvedBy === actor.userId) throw new DomainError("payout_needs_second_admin");
    await tx.update(s.withdrawals).set({ state: "SENT", sentBy: actor.userId, sentAt: now(), providerRef, updatedAt: now() }).where(eq(s.withdrawals.id, id));
    const member = await tx.query.users.findFirst({ where: eq(s.users.id, w.userId), columns: { role: true } });
    await recordLedgerEvent(tx, { type: "PAYOUT_SENT", subjectRef: w.ref, amountTzs: w.amountTzs, role: member?.role ?? null });
    await logAdminAction(tx, actor.userId, "payout.send", { type: "withdrawal", id }, { ref: w.ref, amountTzs: w.amountTzs, providerRef });
    await notifyMember(tx, { ...w, providerRef }, "sms.payoutSent");
  });
}

/** Either admin turns a request down, with a reason the member is told; the money is available again. */
export async function rejectWithdrawal(actor: Actor, id: string, raw: { reason: string }): Promise<void> {
  authorize(actor, "admin.payout.decide");
  const { reason } = z.object({ reason: z.string().trim().min(3).max(300) }).strict().parse(raw);
  await withTx(async (tx) => {
    const w = await lockWithdrawal(tx, id);
    if (w.state !== "REQUESTED" && w.state !== "APPROVED") throw new DomainError("withdrawal_finished");
    await tx.update(s.withdrawals).set({ state: "REJECTED", decidedReason: reason, updatedAt: now() }).where(eq(s.withdrawals.id, id));
    await logAdminAction(tx, actor.userId, "payout.reject", { type: "withdrawal", id }, { ref: w.ref, amountTzs: w.amountTzs, reason });
    await notifyMember(tx, w, "sms.payoutRejected");
  });
}

export interface MoneyOverview {
  /** Confirmed buyer payments into the collection account, ever. */
  collectedTzs: number;
  /** Sent back out to members, ever. */
  paidOutTzs: number;
  /** What should be in the collection account now (collected − paid out). */
  expectedInAccountTzs: number;
  /** Dandelion's own: fees on finished orders. */
  feesTzs: number;
  /** Members' money still in the account: available + waiting to be sent + on hold. */
  owedTzs: number;
  waiting: { toApprove: number; toSend: number };
  /** Open withdrawals (newest first) with the member's name and role. */
  open: (Withdrawal & { name: string; role: string })[];
  recent: (Withdrawal & { name: string; role: string })[];
  /** Members with money in the account, most owed first. */
  members: { userId: string; name: string; role: string; balance: Balance }[];
}

/** The admins' view of the collection account (Money → Payouts). */
export async function moneyOverview(actor: Actor): Promise<MoneyOverview> {
  authorize(actor, "admin.payout.decide");
  const db = getDb();
  const credits = await creditRows(db);
  const all = await db.select().from(s.withdrawals).orderBy(desc(s.withdrawals.createdAt));
  const userIds = [...new Set([...credits.map((c) => c.userId), ...all.map((w) => w.userId)])];
  const users = userIds.length ? await db.query.users.findMany({ where: inArray(s.users.id, userIds), columns: { id: true, displayName: true, role: true } }) : [];
  const who = (id: string) => users.find((u) => u.id === id);
  const named = (w: Withdrawal) => ({ ...w, name: who(w.userId)?.displayName ?? "—", role: who(w.userId)?.role ?? "" });
  const members = userIds
    .map((userId) => ({ userId, name: who(userId)?.displayName ?? "—", role: who(userId)?.role ?? "", balance: balance(credits.filter((c) => c.userId === userId), all.filter((w) => w.userId === userId)) }))
    .filter((m) => m.balance.availableTzs + m.balance.onHoldTzs + m.balance.pendingWithdrawalTzs > 0)
    .sort((a, b) => b.balance.availableTzs + b.balance.pendingWithdrawalTzs - (a.balance.availableTzs + a.balance.pendingWithdrawalTzs));
  const collected = credits.reduce((a, c) => a + c.confirmedTzs, 0);
  const paidOut = all.filter((w) => w.state === "SENT").reduce((a, w) => a + w.amountTzs, 0);
  const fees = balance(credits, []).feesTzs;
  const open = all.filter((w) => w.state === "REQUESTED" || w.state === "APPROVED");
  return {
    collectedTzs: collected,
    paidOutTzs: paidOut,
    expectedInAccountTzs: collected - paidOut,
    feesTzs: fees,
    owedTzs: members.reduce((a, m) => a + m.balance.availableTzs + m.balance.pendingWithdrawalTzs + m.balance.onHoldTzs, 0),
    waiting: { toApprove: open.filter((w) => w.state === "REQUESTED").length, toSend: open.filter((w) => w.state === "APPROVED").length },
    open: open.map(named),
    recent: all.filter((w) => w.state === "SENT" || w.state === "REJECTED").slice(0, 20).map(named),
    members,
  };
}

/** Counts for the admin home's "Needs you now" (no names). */
export async function payoutsWaiting(db: DbOrTx = getDb()): Promise<{ toApprove: number; toSend: number }> {
  const rows = await db
    .select({ state: s.withdrawals.state, n: sql<number>`count(*)::int` })
    .from(s.withdrawals)
    .where(inArray(s.withdrawals.state, ["REQUESTED", "APPROVED"] as WithdrawalState[]))
    .groupBy(s.withdrawals.state);
  return { toApprove: Number(rows.find((r) => r.state === "REQUESTED")?.n ?? 0), toSend: Number(rows.find((r) => r.state === "APPROVED")?.n ?? 0) };
}
