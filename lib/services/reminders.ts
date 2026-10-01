/**
 * "Time to restock?" (founders, 2026-10-01): periods come monthly, so a short reminder is the best way to bring a
 * customer back. Only to customers who agreed to reminders (their latest choice wins), about 25 days after their last
 * pack was handed over, once per pack and never twice within 30 days, never while an order is open, and never naming
 * the product. One SMS part each. Runs with the nightly reconciliation.
 */
import { sql } from "drizzle-orm";
import { now, nowMs } from "@/lib/clock";
import { getDb } from "@/lib/db/client";
import { decryptString } from "@/lib/crypto/envelope";
import { getSmsProvider } from "@/lib/sms";
import { tr } from "@/lib/i18n/server-translator";
import { appOrigin } from "@/lib/env";
import { firstName } from "@/lib/util/names";

export const REMINDER_AFTER_DAYS = 25;
const DAY = 86_400_000;

export async function sendRestockReminders(limit = 500): Promise<{ sent: number }> {
  const db = getDb();
  const at = now();
  const due = new Date(nowMs() - REMINDER_AFTER_DAYS * DAY);
  const monthAgo = new Date(nowMs() - 30 * DAY);
  const rows = await db.execute<{ id: string; display_name: string; phone_enc: string }>(sql`
    with last as (
      select customer_id, max(completed_at) as last_at from orders
      where customer_id is not null and state = 'COMPLETED' group by 1
    ), consent as (
      select distinct on (customer_id) customer_id, granted from consent_records
      where kind = 'REMINDERS' order by customer_id, created_at desc
    )
    select c.id, c.display_name, c.phone_enc from customers c
      join last l on l.customer_id = c.id
      join consent k on k.customer_id = c.id and k.granted
    where c.status = 'ACTIVE' and c.phone_verified_at is not null
      and l.last_at <= ${due}
      and (c.last_reminder_at is null or (c.last_reminder_at < l.last_at and c.last_reminder_at < ${monthAgo}))
      and not exists (select 1 from orders o where o.customer_id = c.id and o.state in ('PLAN_ACTIVE', 'FULLY_PAID', 'HANDOVER_PENDING'))
      and not exists (select 1 from customer_requests r where r.customer_id = c.id and r.state = 'OPEN')
    order by l.last_at
    limit ${limit}`);
  const link = `${appOrigin()}/shop`;
  let sent = 0;
  for (const c of rows.rows) {
    await db.transaction(async (tx) => {
      // Marked first, in the same transaction: a retried night never texts her twice.
      const marked = await tx.execute(sql`update customers set last_reminder_at = ${at} where id = ${c.id} and (last_reminder_at is null or last_reminder_at < ${monthAgo})`);
      if (!marked.rowCount) return;
      await getSmsProvider().send(await decryptString(c.phone_enc), tr("sw", "sms.reminder", { name: firstName(c.display_name), link }), "REMINDER", tx);
      sent++;
    });
  }
  return { sent };
}
