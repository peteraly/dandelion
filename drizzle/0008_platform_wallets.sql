CREATE TYPE "public"."withdrawal_state" AS ENUM('REQUESTED', 'APPROVED', 'SENT', 'REJECTED');--> statement-breakpoint
ALTER TYPE "public"."ledger_event_type" ADD VALUE 'PAYOUT_SENT';--> statement-breakpoint
CREATE TABLE "withdrawals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ref" text NOT NULL,
	"user_id" uuid NOT NULL,
	"amount_tzs" integer NOT NULL,
	"payee_account" text NOT NULL,
	"state" "withdrawal_state" DEFAULT 'REQUESTED' NOT NULL,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"sent_by" uuid,
	"sent_at" timestamp with time zone,
	"provider_ref" text,
	"decided_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "withdrawals_ref_unique" UNIQUE("ref"),
	CONSTRAINT "withdrawal_amount_positive" CHECK ("withdrawals"."amount_tzs" > 0),
	CONSTRAINT "withdrawal_two_admins" CHECK ("withdrawals"."sent_by" IS NULL OR "withdrawals"."approved_by" IS NULL OR "withdrawals"."sent_by" <> "withdrawals"."approved_by"),
	CONSTRAINT "withdrawal_sent_has_ref" CHECK ("withdrawals"."state" <> 'SENT' OR ("withdrawals"."provider_ref" IS NOT NULL AND "withdrawals"."sent_by" IS NOT NULL AND "withdrawals"."sent_at" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "platform_fee_tzs" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "payment_intents" ADD COLUMN "collected_by_platform" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "withdrawals" ADD CONSTRAINT "withdrawals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "withdrawals" ADD CONSTRAINT "withdrawals_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "withdrawals" ADD CONSTRAINT "withdrawals_sent_by_users_id_fk" FOREIGN KEY ("sent_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "withdrawals_user_idx" ON "withdrawals" USING btree ("user_id","state");--> statement-breakpoint
CREATE INDEX "withdrawals_state_idx" ON "withdrawals" USING btree ("state");--> statement-breakpoint
CREATE INDEX "payment_intents_payee_platform_idx" ON "payment_intents" USING btree ("payee_user_id","collected_by_platform","status");--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "order_platform_fee" CHECK ("orders"."platform_fee_tzs" >= 0 AND "orders"."platform_fee_tzs" <= "orders"."total_tzs");--> statement-breakpoint
-- Guards (Prompt L §2): the fee on an order and whether the platform collected a payment are fixed at creation.
CREATE OR REPLACE FUNCTION guard_order_terms() RETURNS trigger AS $$
BEGIN
  IF NEW.unit_price_tzs <> OLD.unit_price_tzs OR NEW.total_tzs <> OLD.total_tzs
     OR NEW.quantity <> OLD.quantity OR NEW.price_list_item_id <> OLD.price_list_item_id
     OR NEW.kind <> OLD.kind OR NEW.platform_fee_tzs <> OLD.platform_fee_tzs THEN
    RAISE EXCEPTION 'order terms are immutable' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
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
     OR NEW.order_id <> OLD.order_id OR NEW.amount_rule <> OLD.amount_rule
     OR NEW.collected_by_platform <> OLD.collected_by_platform THEN
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
-- Withdrawals: never deleted; who, how much and to which number are fixed; states only move forward.
CREATE OR REPLACE FUNCTION guard_withdrawal() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'withdrawals cannot be deleted' USING ERRCODE = 'P0001';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.state <> 'REQUESTED' THEN
      RAISE EXCEPTION 'a withdrawal starts as requested' USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.user_id <> OLD.user_id OR NEW.amount_tzs <> OLD.amount_tzs OR NEW.payee_account <> OLD.payee_account OR NEW.ref <> OLD.ref THEN
    RAISE EXCEPTION 'withdrawal terms are immutable' USING ERRCODE = 'P0001';
  END IF;
  IF NEW.state IS DISTINCT FROM OLD.state AND NOT (
       (OLD.state = 'REQUESTED' AND NEW.state IN ('APPROVED', 'REJECTED'))
    OR (OLD.state = 'APPROVED' AND NEW.state IN ('SENT', 'REJECTED'))) THEN
    RAISE EXCEPTION 'withdrawal state cannot move from % to %', OLD.state, NEW.state USING ERRCODE = 'P0001';
  END IF;
  IF OLD.state IN ('SENT', 'REJECTED') THEN
    RAISE EXCEPTION 'a finished withdrawal cannot change' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER withdrawals_guard BEFORE INSERT OR UPDATE OR DELETE ON withdrawals FOR EACH ROW EXECUTE FUNCTION guard_withdrawal();
--> statement-breakpoint
CREATE TRIGGER withdrawals_no_truncate BEFORE TRUNCATE ON withdrawals FOR EACH STATEMENT EXECUTE FUNCTION forbid_mutation();
