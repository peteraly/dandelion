CREATE TYPE "public"."road_type" AS ENUM('PAVED', 'GRAVEL', 'DIRT');--> statement-breakpoint
CREATE TABLE "hub_stock_days" (
	"hub_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"day" date NOT NULL,
	"on_hand" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hub_stock_days_hub_id_product_id_day_pk" PRIMARY KEY("hub_id","product_id","day"),
	CONSTRAINT "hub_stock_days_nonnegative" CHECK ("hub_stock_days"."on_hand" >= 0)
);
--> statement-breakpoint
ALTER TABLE "hubs" ADD COLUMN "distance_km" integer;--> statement-breakpoint
ALTER TABLE "hubs" ADD COLUMN "road" "road_type";--> statement-breakpoint
ALTER TABLE "hubs" ADD COLUMN "slow_in_rains" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "service_areas" ADD COLUMN "rainy_months" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "hub_stock_days" ADD CONSTRAINT "hub_stock_days_hub_id_hubs_id_fk" FOREIGN KEY ("hub_id") REFERENCES "public"."hubs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hub_stock_days" ADD CONSTRAINT "hub_stock_days_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hubs" ADD CONSTRAINT "hub_distance_range" CHECK ("hubs"."distance_km" IS NULL OR ("hubs"."distance_km" >= 0 AND "hubs"."distance_km" <= 2000));