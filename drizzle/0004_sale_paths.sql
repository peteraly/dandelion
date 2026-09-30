CREATE TYPE "public"."organisation_kind" AS ENUM('NGO', 'NON_PROFIT', 'SCHOOL', 'COMMUNITY', 'OTHER');--> statement-breakpoint
ALTER TYPE "public"."approval_type" ADD VALUE 'AREA_SALES_CHANGE';--> statement-breakpoint
ALTER TYPE "public"."custody_state" ADD VALUE 'WITH_RIDER' BEFORE 'RESERVED_FOR_RIDER';--> statement-breakpoint
ALTER TYPE "public"."custody_state" ADD VALUE 'DELIVERED_TO_ORG' BEFORE 'RESERVED_FOR_RIDER';--> statement-breakpoint
ALTER TYPE "public"."order_kind" ADD VALUE 'RIDER_TO_CUSTOMER';--> statement-breakpoint
ALTER TYPE "public"."order_kind" ADD VALUE 'SUPPLIER_TO_CUSTOMER';--> statement-breakpoint
ALTER TYPE "public"."order_kind" ADD VALUE 'SUPPLIER_TO_HUB';--> statement-breakpoint
ALTER TYPE "public"."order_kind" ADD VALUE 'SUPPLIER_TO_CHAMPION';--> statement-breakpoint
ALTER TYPE "public"."order_kind" ADD VALUE 'SUPPLIER_TO_ORG';--> statement-breakpoint
ALTER TYPE "public"."order_kind" ADD VALUE 'HUB_TO_ORG';--> statement-breakpoint
ALTER TYPE "public"."order_kind" ADD VALUE 'RIDER_TO_ORG';--> statement-breakpoint
ALTER TYPE "public"."payment_purpose" ADD VALUE 'ORGANISATION_SALE';--> statement-breakpoint
CREATE TABLE "organisations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"kind" "organisation_kind" NOT NULL,
	"service_area_id" uuid,
	"active" boolean DEFAULT false NOT NULL,
	"contact_name" text,
	"contact_phone_enc" text,
	"contact_phone_index" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "orders" DROP CONSTRAINT "customer_order_has_customer";--> statement-breakpoint
ALTER TABLE "orders" DROP CONSTRAINT "b2b_order_has_buyer";--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "organisation_id" uuid;--> statement-breakpoint
ALTER TABLE "price_list_items" ADD COLUMN "organisation_price_tzs" integer;--> statement-breakpoint
ALTER TABLE "service_areas" ADD COLUMN "allowed_sales" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "organisations" ADD CONSTRAINT "organisations_service_area_id_service_areas_id_fk" FOREIGN KEY ("service_area_id") REFERENCES "public"."service_areas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "order_has_buyer" CHECK (("orders"."buyer_user_id" IS NOT NULL)::int + ("orders"."customer_id" IS NOT NULL)::int + ("orders"."organisation_id" IS NOT NULL)::int = 1);