CREATE TYPE "public"."customer_request_state" AS ENUM('OPEN', 'ACCEPTED', 'CANCELLED', 'EXPIRED');--> statement-breakpoint
CREATE TABLE "customer_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ref" text NOT NULL,
	"customer_id" uuid NOT NULL,
	"service_area_id" uuid NOT NULL,
	"meeting_point_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"state" "customer_request_state" DEFAULT 'OPEN' NOT NULL,
	"accepted_by" uuid,
	"accepted_at" timestamp with time zone,
	"order_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_requests_ref_unique" UNIQUE("ref"),
	CONSTRAINT "customer_request_accepted" CHECK ("customer_requests"."state" <> 'ACCEPTED' OR ("customer_requests"."accepted_by" IS NOT NULL AND "customer_requests"."order_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "customer_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"customer_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "meeting_points" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"service_area_id" uuid NOT NULL,
	"name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "consent_records" ALTER COLUMN "recorded_by" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "customers" ALTER COLUMN "champion_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "self_registered" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "meeting_point_id" uuid;--> statement-breakpoint
ALTER TABLE "customer_requests" ADD CONSTRAINT "customer_requests_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_requests" ADD CONSTRAINT "customer_requests_service_area_id_service_areas_id_fk" FOREIGN KEY ("service_area_id") REFERENCES "public"."service_areas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_requests" ADD CONSTRAINT "customer_requests_meeting_point_id_meeting_points_id_fk" FOREIGN KEY ("meeting_point_id") REFERENCES "public"."meeting_points"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_requests" ADD CONSTRAINT "customer_requests_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_requests" ADD CONSTRAINT "customer_requests_accepted_by_users_id_fk" FOREIGN KEY ("accepted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_requests" ADD CONSTRAINT "customer_requests_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_sessions" ADD CONSTRAINT "customer_sessions_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_points" ADD CONSTRAINT "meeting_points_service_area_id_service_areas_id_fk" FOREIGN KEY ("service_area_id") REFERENCES "public"."service_areas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "customer_requests_open_idx" ON "customer_requests" USING btree ("state","service_area_id");--> statement-breakpoint
CREATE INDEX "customer_requests_customer_idx" ON "customer_requests" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "customer_sessions_customer_idx" ON "customer_sessions" USING btree ("customer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "meeting_points_area_name_uq" ON "meeting_points" USING btree ("service_area_id","name");--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_meeting_point_id_meeting_points_id_fk" FOREIGN KEY ("meeting_point_id") REFERENCES "public"."meeting_points"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- Shop requests (Prompt L §3): never deleted; who asked, for what and where is fixed; a request only leaves OPEN, once.
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
     OR NEW.meeting_point_id <> OLD.meeting_point_id OR NEW.product_id <> OLD.product_id OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'shop request terms are immutable' USING ERRCODE = 'P0001';
  END IF;
  IF OLD.state <> 'OPEN' THEN
    RAISE EXCEPTION 'a finished shop request cannot change' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER customer_requests_guard BEFORE INSERT OR UPDATE OR DELETE ON customer_requests FOR EACH ROW EXECUTE FUNCTION guard_customer_request();
--> statement-breakpoint
CREATE TRIGGER customer_requests_no_truncate BEFORE TRUNCATE ON customer_requests FOR EACH STATEMENT EXECUTE FUNCTION forbid_mutation();
