/**
 * Prices come only from the ACTIVE, dual-approved price list (§3.5).
 * Drafting is admin-only; activation runs through the approvals executor.
 */
import { now } from "@/lib/clock";
import { tzDay } from "@/lib/util/time";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb, type DbOrTx, type Tx } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import { TzsSchema } from "@/lib/money";
import { authorize, type Actor } from "@/lib/policy";
import { DomainError, logAdminAction, recordLedgerEvent, withTx } from "./core";

export type PriceItem = typeof s.priceListItems.$inferSelect & { supplierId: string; priceListId: string };

/**
 * Active price for a product in an area. If `supplierId` is omitted, the
 * area must have exactly one active list carrying the product.
 */
export async function activePriceItem(db: DbOrTx, q: { serviceAreaId: string; productId: string; supplierId?: string }): Promise<PriceItem> {
  const rows = await db
    .select({ item: s.priceListItems, supplierId: s.priceLists.supplierId })
    .from(s.priceListItems)
    .innerJoin(s.priceLists, eq(s.priceLists.id, s.priceListItems.priceListId))
    .where(
      and(
        eq(s.priceLists.status, "ACTIVE"),
        eq(s.priceLists.serviceAreaId, q.serviceAreaId),
        eq(s.priceListItems.productId, q.productId),
        sql`${s.priceLists.effectiveFrom} <= ${tzDay()}::date`,
        q.supplierId ? eq(s.priceLists.supplierId, q.supplierId) : sql`true`,
      ),
    );
  if (rows.length === 0) throw new DomainError("no_active_price");
  if (rows.length > 1) throw new DomainError("ambiguous_price");
  return { ...rows[0]!.item, supplierId: rows[0]!.supplierId };
}

export const PriceListDraftSchema = z
  .object({
    serviceAreaId: z.string().uuid(),
    supplierId: z.string().uuid(),
    effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    items: z
      .array(
        z
          .object({
            productId: z.string().uuid(),
            supplierPriceTzs: TzsSchema,
            hubPriceTzs: TzsSchema,
            championPriceTzs: TzsSchema,
            customerPriceTzs: TzsSchema,
          })
          .strict(),
      )
      .min(1)
      .max(50),
  })
  .strict();
export type PriceListDraftInput = z.input<typeof PriceListDraftSchema>;

/** Create a DRAFT list and its approval request in one go. */
export async function draftPriceList(actor: Actor, raw: PriceListDraftInput): Promise<{ priceListId: string; approvalRequestId: string }> {
  authorize(actor, "admin.pricelist.draft");
  const input = PriceListDraftSchema.parse(raw);
  for (const it of input.items) {
    if (!(it.supplierPriceTzs > 0 && it.hubPriceTzs >= it.supplierPriceTzs && it.championPriceTzs >= it.hubPriceTzs && it.customerPriceTzs >= it.championPriceTzs)) {
      throw new DomainError("price_ladder_invalid");
    }
  }
  return withTx(async (tx) => {
    const last = await tx.query.priceLists.findFirst({
      where: and(eq(s.priceLists.serviceAreaId, input.serviceAreaId), eq(s.priceLists.supplierId, input.supplierId)),
      orderBy: desc(s.priceLists.version),
    });
    const [list] = await tx
      .insert(s.priceLists)
      .values({ version: (last?.version ?? 0) + 1, serviceAreaId: input.serviceAreaId, supplierId: input.supplierId, effectiveFrom: input.effectiveFrom, status: "DRAFT", createdBy: actor.userId })
      .returning();
    await tx.insert(s.priceListItems).values(input.items.map((i) => ({ ...i, priceListId: list!.id })));
    const { createApprovalRequest } = await import("./approvals");
    const req = await createApprovalRequest(tx, actor, "PRICE_LIST_ACTIVATE", { priceListId: list!.id }, `Activate price list v${list!.version}`);
    await tx.update(s.priceLists).set({ status: "PENDING_APPROVAL", approvalRequestId: req.id }).where(eq(s.priceLists.id, list!.id));
    await logAdminAction(tx, actor.userId, "pricelist.draft", { type: "price_list", id: list!.id }, { version: list!.version });
    return { priceListId: list!.id, approvalRequestId: req.id };
  });
}

/** Approvals executor only (transaction already marked app.approvals=on). */
export async function activatePriceList(tx: Tx, priceListId: string): Promise<void> {
  const list = await tx.query.priceLists.findFirst({ where: eq(s.priceLists.id, priceListId) });
  if (!list || list.status !== "PENDING_APPROVAL") throw new DomainError("price_list_not_pending");
  await tx
    .update(s.priceLists)
    .set({ status: "SUPERSEDED" })
    .where(and(eq(s.priceLists.serviceAreaId, list.serviceAreaId), eq(s.priceLists.supplierId, list.supplierId), eq(s.priceLists.status, "ACTIVE")));
  await tx.update(s.priceLists).set({ status: "ACTIVE", activatedAt: now() }).where(eq(s.priceLists.id, priceListId));
  await recordLedgerEvent(tx, { type: "PRICE_LIST_UPDATED", subjectRef: `PL-v${list.version}`, role: "SUPER_ADMIN" });
}

export async function listPriceLists(actor: Actor) {
  authorize(actor, "admin.dashboard");
  return getDb().query.priceLists.findMany({ orderBy: desc(s.priceLists.createdAt), limit: 50 });
}
