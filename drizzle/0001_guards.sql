-- Defense-in-depth database guards. The application enforces every rule in
-- lib/domain first; these triggers make an application bug fail loudly
-- instead of silently breaking an invariant. They do not protect against a
-- database owner who disables triggers (see docs/DECISIONS.md).

-- 1. Append-only tables -------------------------------------------------------
CREATE OR REPLACE FUNCTION forbid_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'append-only table %: % is not allowed', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'P0001';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
-- Log tables allow DELETE only during a retention purge (app.retention_purge = 'on').
CREATE OR REPLACE FUNCTION forbid_mutation_except_retention() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' AND coalesce(current_setting('app.retention_purge', true), '') = 'on' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'append-only table %: % is not allowed', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'P0001';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'custody_events', 'provider_transactions', 'provider_tx_dedupe', 'ledger_events',
    'ledger_anchor_members', 'receipts', 'approval_decisions', 'donor_fundings',
    'consent_records', 'training_records', 'approval_evidence'
  ] LOOP
    EXECUTE format('CREATE TRIGGER %I_append_only BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION forbid_mutation()', t, t);
    EXECUTE format('CREATE TRIGGER %I_no_truncate BEFORE TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION forbid_mutation()', t, t);
  END LOOP;
  FOREACH t IN ARRAY ARRAY['admin_action_log', 'security_event_log'] LOOP
    EXECUTE format('CREATE TRIGGER %I_append_only BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION forbid_mutation_except_retention()', t, t);
    EXECUTE format('CREATE TRIGGER %I_no_truncate BEFORE TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION forbid_mutation()', t, t);
  END LOOP;
END $$;
--> statement-breakpoint

-- 2. Payment status: only the verification job (app.verifier = 'on') ---------
CREATE OR REPLACE FUNCTION guard_payment_intent() RETURNS trigger AS $$
DECLARE verifier boolean := coalesce(current_setting('app.verifier', true), '') = 'on';
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'payment intents cannot be deleted' USING ERRCODE = 'P0001';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'PAYMENT_PENDING' AND NOT verifier THEN
      RAISE EXCEPTION 'only the verification job may create a non-pending payment' USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status AND NOT verifier THEN
    RAISE EXCEPTION 'payment status can only be changed by the verification job' USING ERRCODE = 'P0001';
  END IF;
  IF NEW.amount_tzs <> OLD.amount_tzs OR NEW.payee_account <> OLD.payee_account
     OR NEW.order_id <> OLD.order_id OR NEW.amount_rule <> OLD.amount_rule THEN
    RAISE EXCEPTION 'payment intent terms are immutable' USING ERRCODE = 'P0001';
  END IF;
  IF OLD.status = 'PAYMENT_CONFIRMED' AND (
       NEW.confirmed_amount_tzs IS DISTINCT FROM OLD.confirmed_amount_tzs
    OR NEW.provider_tx_ref IS DISTINCT FROM OLD.provider_tx_ref) THEN
    RAISE EXCEPTION 'confirmed payment details are immutable' USING ERRCODE = 'P0001';
  END IF;
  IF NEW.provider_tx_ref IS DISTINCT FROM OLD.provider_tx_ref AND NOT verifier THEN
    RAISE EXCEPTION 'only the verification job may attach a provider transaction' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER payment_intents_guard BEFORE INSERT OR UPDATE OR DELETE ON payment_intents
  FOR EACH ROW EXECUTE FUNCTION guard_payment_intent();
--> statement-breakpoint

-- 3. Locked batches stay locked unless the approvals executor runs ------------
CREATE OR REPLACE FUNCTION guard_batch() RETURNS trigger AS $$
DECLARE approvals boolean := coalesce(current_setting('app.approvals', true), '') = 'on';
BEGIN
  IF OLD.custody_state IN ('INSPECTION_ISSUE', 'DAMAGED_OR_QUARANTINED') AND NOT approvals THEN
    IF NEW.custody_state IS DISTINCT FROM OLD.custody_state
       OR NEW.quantity IS DISTINCT FROM OLD.quantity
       OR NEW.custodian_user_id IS DISTINCT FROM OLD.custodian_user_id THEN
      RAISE EXCEPTION 'batch % is locked until a dual-approved resolution', OLD.code USING ERRCODE = 'P0001';
    END IF;
  END IF;
  IF NEW.product_id <> OLD.product_id OR NEW.supplier_id <> OLD.supplier_id THEN
    RAISE EXCEPTION 'batch product/supplier are immutable' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER batches_guard BEFORE UPDATE ON batches FOR EACH ROW EXECUTE FUNCTION guard_batch();
--> statement-breakpoint

-- 4. Prices: only dual-approved lists become ACTIVE; approved lists are frozen --
CREATE OR REPLACE FUNCTION guard_price_list() RETURNS trigger AS $$
DECLARE approvals boolean := coalesce(current_setting('app.approvals', true), '') = 'on';
BEGIN
  IF TG_OP = 'INSERT' AND NEW.status NOT IN ('DRAFT', 'PENDING_APPROVAL') THEN
    RAISE EXCEPTION 'price lists start as DRAFT' USING ERRCODE = 'P0001';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status
     AND NEW.status IN ('ACTIVE', 'SUPERSEDED') AND NOT approvals THEN
    RAISE EXCEPTION 'price list activation requires dual approval' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER price_lists_guard BEFORE INSERT OR UPDATE ON price_lists FOR EACH ROW EXECUTE FUNCTION guard_price_list();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION guard_price_list_items() RETURNS trigger AS $$
DECLARE st price_list_status;
BEGIN
  SELECT status INTO st FROM price_lists WHERE id = coalesce(NEW.price_list_id, OLD.price_list_id);
  IF st <> 'DRAFT' THEN
    RAISE EXCEPTION 'price list items are frozen once submitted for approval' USING ERRCODE = 'P0001';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER price_list_items_guard BEFORE INSERT OR UPDATE OR DELETE ON price_list_items
  FOR EACH ROW EXECUTE FUNCTION guard_price_list_items();
--> statement-breakpoint

-- 5. Order money terms are immutable after creation ---------------------------
CREATE OR REPLACE FUNCTION guard_order_terms() RETURNS trigger AS $$
BEGIN
  IF NEW.unit_price_tzs <> OLD.unit_price_tzs OR NEW.total_tzs <> OLD.total_tzs
     OR NEW.quantity <> OLD.quantity OR NEW.price_list_item_id <> OLD.price_list_item_id
     OR NEW.kind <> OLD.kind THEN
    RAISE EXCEPTION 'order terms are immutable' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER orders_terms_guard BEFORE UPDATE ON orders FOR EACH ROW EXECUTE FUNCTION guard_order_terms();
--> statement-breakpoint
CREATE TRIGGER orders_no_delete BEFORE DELETE ON orders FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
--> statement-breakpoint
-- 6. Core financial tables can never be truncated --------------------------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['orders', 'payment_intents', 'batches', 'exceptions', 'approval_requests'] LOOP
    EXECUTE format('CREATE TRIGGER %I_no_truncate BEFORE TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION forbid_mutation()', t, t);
  END LOOP;
END $$;
