/**
 * Provider statement import and diff (review correction §4.5). The monthly
 * merchant statement CSV is compared with our confirmed payments. This is the
 * independent check that the ledger anchoring cannot provide.
 *
 * CSV columns (header names are matched case-insensitively, order free):
 *   reference | transaction_id | tx_ref      → provider transaction reference
 *   amount                                    → integer TZS (thousands separators allowed)
 *   payee | account | till                    → payee account (optional)
 *   date                                      → YYYY-MM-DD (optional)
 */
import { and, eq, gte, lte } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import { authorize, type Actor } from "@/lib/policy";
import { sha256Hex } from "@/lib/crypto/random";
import { DomainError, logAdminAction, logSecurityEvent, withTx } from "./core";

export interface StatementRow {
  providerTxRef: string;
  amountTzs: number;
  payeeAccount: string | null;
  occurredOn: string | null;
}

export function parseStatementCsv(text: string): StatementRow[] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length < 2) throw new DomainError("statement_empty");
  const split = (l: string) => l.match(/("([^"]|"")*"|[^,]*)(,|$)/g)?.map((c) => c.replace(/,$/, "").replace(/^"|"$/g, "").replace(/""/g, '"').trim()) ?? [];
  const header = split(lines[0]!).map((h) => h.toLowerCase());
  const col = (...names: string[]) => header.findIndex((h) => names.includes(h));
  const iRef = col("reference", "transaction_id", "tx_ref", "receipt", "transactionid");
  const iAmt = col("amount", "amount_tzs", "credit");
  const iPayee = col("payee", "account", "till", "payee_account");
  const iDate = col("date", "occurred_on", "completion_time");
  if (iRef < 0 || iAmt < 0) throw new DomainError("statement_columns_missing");
  const rows: StatementRow[] = [];
  for (const line of lines.slice(1)) {
    const c = split(line);
    const ref = c[iRef]?.trim();
    const amt = Number.parseInt((c[iAmt] ?? "").replace(/[^\d-]/g, ""), 10);
    if (!ref || !Number.isFinite(amt)) continue;
    rows.push({ providerTxRef: ref, amountTzs: amt, payeeAccount: iPayee >= 0 ? c[iPayee] || null : null, occurredOn: iDate >= 0 && /^\d{4}-\d{2}-\d{2}/.test(c[iDate] ?? "") ? c[iDate]!.slice(0, 10) : null });
  }
  return rows;
}

export interface StatementDiff {
  matched: { providerTxRef: string; amountTzs: number; orderRef: string }[];
  amountDiffers: { providerTxRef: string; statementTzs: number; appTzs: number; orderRef: string }[];
  missingInStatement: { providerTxRef: string; amountTzs: number; orderRef: string; confirmedAt: Date | null }[];
  missingInApp: StatementRow[];
}

/** Pure diff between statement rows and confirmed intents. */
export function diffStatement(rows: StatementRow[], confirmed: { providerTxRef: string; amountTzs: number; orderRef: string; confirmedAt: Date | null }[]): StatementDiff {
  const byRef = new Map(confirmed.map((c) => [c.providerTxRef, c]));
  const seen = new Set<string>();
  const out: StatementDiff = { matched: [], amountDiffers: [], missingInStatement: [], missingInApp: [] };
  for (const r of rows) {
    const c = byRef.get(r.providerTxRef);
    if (!c) {
      out.missingInApp.push(r);
      continue;
    }
    seen.add(r.providerTxRef);
    if (c.amountTzs === r.amountTzs) out.matched.push({ providerTxRef: r.providerTxRef, amountTzs: r.amountTzs, orderRef: c.orderRef });
    else out.amountDiffers.push({ providerTxRef: r.providerTxRef, statementTzs: r.amountTzs, appTzs: c.amountTzs, orderRef: c.orderRef });
  }
  for (const c of confirmed) if (!seen.has(c.providerTxRef)) out.missingInStatement.push(c);
  return out;
}

export async function importStatement(actor: Actor, provider: string, filename: string, text: string): Promise<{ importId: string; diff: StatementDiff }> {
  authorize(actor, "admin.statement.import");
  if (text.length > 5 * 1024 * 1024) throw new DomainError("statement_too_large");
  const rows = parseStatementCsv(text);
  const dates = rows.map((r) => r.occurredOn).filter((d): d is string => !!d).sort();
  const from = dates[0] ?? null;
  const to = dates[dates.length - 1] ?? null;
  const importId = await withTx(async (tx) => {
    const [imp] = await tx
      .insert(s.providerStatementImports)
      .values({ provider, filename: filename.slice(0, 120), sha256: sha256Hex(text), rowCount: rows.length, coversFrom: from, coversTo: to, uploadedBy: actor.userId })
      .returning({ id: s.providerStatementImports.id });
    if (rows.length) await tx.insert(s.providerStatementRows).values(rows.map((r) => ({ importId: imp!.id, ...r })));
    await logAdminAction(tx, actor.userId, "statement.import", { type: "statement", id: imp!.id }, { provider, rows: rows.length });
    await logSecurityEvent(tx, "STATEMENT_IMPORTED", "INFO", { userId: actor.userId, details: { provider, rows: rows.length } });
    return imp!.id;
  });
  return { importId, diff: await diffForImport(actor, importId) };
}

export async function diffForImport(actor: Actor, importId: string): Promise<StatementDiff> {
  authorize(actor, "admin.statement.import");
  const db = getDb();
  const imp = await db.query.providerStatementImports.findFirst({ where: eq(s.providerStatementImports.id, importId) });
  if (!imp) throw new DomainError("not_found");
  const rows = await db.query.providerStatementRows.findMany({ where: eq(s.providerStatementRows.importId, importId) });
  const where = [eq(s.paymentIntents.status, "PAYMENT_CONFIRMED"), eq(s.paymentIntents.provider, imp.provider)];
  if (imp.coversFrom) where.push(gte(s.paymentIntents.confirmedAt, new Date(`${imp.coversFrom}T00:00:00+03:00`)));
  if (imp.coversTo) where.push(lte(s.paymentIntents.confirmedAt, new Date(`${imp.coversTo}T23:59:59+03:00`)));
  const confirmed = await db
    .select({ providerTxRef: s.paymentIntents.providerTxRef, amountTzs: s.paymentIntents.confirmedAmountTzs, orderRef: s.orders.ref, confirmedAt: s.paymentIntents.confirmedAt })
    .from(s.paymentIntents)
    .innerJoin(s.orders, eq(s.orders.id, s.paymentIntents.orderId))
    .where(and(...where));
  return diffStatement(
    rows.map((r) => ({ providerTxRef: r.providerTxRef, amountTzs: r.amountTzs, payeeAccount: r.payeeAccount, occurredOn: r.occurredOn })),
    confirmed.map((c) => ({ providerTxRef: c.providerTxRef!, amountTzs: c.amountTzs!, orderRef: c.orderRef, confirmedAt: c.confirmedAt })),
  );
}

export async function listImports(actor: Actor) {
  authorize(actor, "admin.statement.import");
  return getDb().query.providerStatementImports.findMany({ orderBy: (t, { desc }) => desc(t.createdAt), limit: 24 });
}
