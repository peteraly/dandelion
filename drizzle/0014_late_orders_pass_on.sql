ALTER TYPE "public"."ledger_event_type" ADD VALUE 'ORDER_REASSIGNED';--> statement-breakpoint
CREATE TABLE "order_transfers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"from_order_id" uuid NOT NULL,
	"to_order_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"amount_tzs" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "order_transfer_positive" CHECK ("order_transfers"."amount_tzs" > 0)
);
--> statement-breakpoint
ALTER TABLE "customer_requests" ADD COLUMN "carried_from_order_id" uuid;--> statement-breakpoint
ALTER TABLE "customer_requests" ADD COLUMN "carried_tzs" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "customer_requests" ADD COLUMN "excluded_seller_id" uuid;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "fully_paid_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "due_reminder_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "order_transfers" ADD CONSTRAINT "order_transfers_from_order_id_orders_id_fk" FOREIGN KEY ("from_order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_transfers" ADD CONSTRAINT "order_transfers_to_order_id_orders_id_fk" FOREIGN KEY ("to_order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_transfers" ADD CONSTRAINT "order_transfers_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "order_transfers_from_uq" ON "order_transfers" USING btree ("from_order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "order_transfers_to_uq" ON "order_transfers" USING btree ("to_order_id");--> statement-breakpoint
ALTER TABLE "customer_requests" ADD CONSTRAINT "customer_requests_carried_from_order_id_orders_id_fk" FOREIGN KEY ("carried_from_order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_requests" ADD CONSTRAINT "customer_requests_excluded_seller_id_users_id_fk" FOREIGN KEY ("excluded_seller_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- A payment that followed its order is a permanent record: never changed, never deleted (Prompt M §3.1).
CREATE OR REPLACE FUNCTION guard_order_transfer() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'order transfers cannot be changed or deleted' USING ERRCODE = 'P0001';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER order_transfers_guard BEFORE UPDATE OR DELETE ON order_transfers FOR EACH ROW EXECUTE FUNCTION guard_order_transfer();
--> statement-breakpoint
CREATE TRIGGER order_transfers_no_truncate BEFORE TRUNCATE ON order_transfers FOR EACH STATEMENT EXECUTE FUNCTION forbid_mutation();
--> statement-breakpoint
-- What a reopened request carries, and who may not take it again, are part of its terms.
CREATE OR REPLACE FUNCTION guard_customer_request() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'shop requests cannot be deleted' USING ERRCODE = 'P0001';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.state <> 'OPEN' THEN
      RAISE EXCEPTION 'a shop request starts open' USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.ref <> OLD.ref OR NEW.customer_id <> OLD.customer_id OR NEW.service_area_id <> OLD.service_area_id
     OR NEW.meeting_point_id <> OLD.meeting_point_id OR NEW.product_id <> OLD.product_id OR NEW.created_at <> OLD.created_at
     OR NEW.women_only <> OLD.women_only OR NEW.carried_tzs <> OLD.carried_tzs
     OR NEW.carried_from_order_id IS DISTINCT FROM OLD.carried_from_order_id
     OR NEW.excluded_seller_id IS DISTINCT FROM OLD.excluded_seller_id THEN
    RAISE EXCEPTION 'shop request terms are immutable' USING ERRCODE = 'P0001';
  END IF;
  IF OLD.state <> 'OPEN' THEN
    RAISE EXCEPTION 'a finished shop request cannot change' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
