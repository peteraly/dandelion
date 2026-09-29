import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { getDb } from "@/lib/db/client";
import { rejectsWithPg } from "./helpers";

describe("schema invariants", () => {
  it("§3.7: no float or numeric money columns anywhere", async () => {
    const rows = await getDb().execute<{ table_name: string; column_name: string; data_type: string }>(sql`
      select table_name, column_name, data_type from information_schema.columns
      where table_schema = 'public' and data_type in ('real','double precision','numeric','money','decimal')
    `);
    expect(rows.rows).toEqual([]);
    const moneyCols = await getDb().execute<{ table_name: string; column_name: string; data_type: string }>(sql`
      select table_name, column_name, data_type from information_schema.columns
      where table_schema = 'public'
        and (column_name like '%tzs%' or column_name like '%amount%' or column_name like '%price%')
        and column_name not like '%\\_id' and column_name not like '%\\_rule' and column_name not like '%\\_list\\_%'
    `);
    expect(moneyCols.rows.length).toBeGreaterThan(5);
    for (const c of moneyCols.rows) expect(c.data_type, `${c.table_name}.${c.column_name}`).toBe("integer");
  });

  it("§3.9: no columns for menstrual-cycle, diagnosis, pregnancy, sexual history, or precise location", async () => {
    const rows = await getDb().execute<{ table_name: string; column_name: string }>(sql`
      select table_name, column_name from information_schema.columns where table_schema = 'public'
    `);
    const forbidden = /(cycle|menstru|period|diagnos|pregnan|sexual|gps|latitude|longitude|geolocation|home_address|physical_address|street|plot|coordinates|symptom|health)/i;
    const bad = rows.rows.filter((r) => forbidden.test(r.column_name));
    expect(bad).toEqual([]);
    expect(rows.rows.length).toBeGreaterThan(100);
  });

  it("append-only tables refuse UPDATE, DELETE and TRUNCATE", async () => {
    const db = getDb();
    await db.execute(sql`insert into admin_action_log (action, details) values ('test', '{}')`);
    await rejectsWithPg(db.execute(sql`update admin_action_log set action = 'x'`), /append-only/);
    await rejectsWithPg(db.execute(sql`delete from admin_action_log`), /append-only/);
    await rejectsWithPg(db.execute(sql`truncate admin_action_log`), /append-only/);
    await db.execute(sql`insert into security_event_log (type, severity, details) values ('TEST', 'INFO', '{}')`);
    await rejectsWithPg(db.execute(sql`update security_event_log set type = 'x'`), /append-only/);
    await rejectsWithPg(db.execute(sql`truncate ledger_events cascade`), /append-only/);
    await rejectsWithPg(db.execute(sql`truncate provider_tx_dedupe cascade`), /append-only/);
    await rejectsWithPg(db.execute(sql`truncate orders cascade`), /append-only/);
  });

  it("§3.1 (DB layer): the payment-intent guard trigger is installed", async () => {
    const trig = await getDb().execute<{ tgname: string }>(sql`select tgname from pg_trigger where tgname in ('payment_intents_guard','batches_guard','price_lists_guard','orders_terms_guard')`);
    expect(trig.rows.map((r) => r.tgname).sort()).toEqual(["batches_guard", "orders_terms_guard", "payment_intents_guard", "price_lists_guard"]);
  });

  it("dual approval threshold below 2 is refused by the DB", async () => {
    const db = getDb();
    const admin = await db.execute<{ id: string }>(sql`select id from users where role = 'SUPER_ADMIN' limit 1`);
    await rejectsWithPg(
      db.execute(sql`insert into approval_requests (type, payload, summary, requested_by, threshold) values ('SETTING_CHANGE', '{}', 'x', ${admin.rows[0]!.id}, 1)`),
      /threshold_at_least_two/,
    );
  });

  it("price lists cannot be activated outside the approvals executor", async () => {
    const db = getDb();
    const pl = await db.execute<{ id: string }>(sql`select id from price_lists where status = 'ACTIVE' limit 1`);
    await rejectsWithPg(db.execute(sql`update price_lists set status = 'SUPERSEDED' where id = ${pl.rows[0]!.id}`), /dual approval/);
    await rejectsWithPg(db.execute(sql`update price_list_items set customer_price_tzs = 1`), /frozen/);
  });
});
