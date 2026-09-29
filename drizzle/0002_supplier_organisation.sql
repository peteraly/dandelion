CREATE TABLE "supplier_products" (
	"supplier_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"supplier_sku" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "supplier_products_supplier_id_product_id_pk" PRIMARY KEY("supplier_id","product_id")
);
--> statement-breakpoint
ALTER TABLE "suppliers" ADD COLUMN "contact_name" text;--> statement-breakpoint
ALTER TABLE "suppliers" ADD COLUMN "contact_phone_enc" text;--> statement-breakpoint
ALTER TABLE "suppliers" ADD COLUMN "contact_phone_index" text;--> statement-breakpoint
ALTER TABLE "suppliers" ADD COLUMN "lead_time_days" integer DEFAULT 2 NOT NULL;--> statement-breakpoint
ALTER TABLE "suppliers" ADD COLUMN "payment_terms_note" text;--> statement-breakpoint
ALTER TABLE "suppliers" ADD COLUMN "notes" text;--> statement-breakpoint
ALTER TABLE "suppliers" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "supplier_products" ADD CONSTRAINT "supplier_products_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_products" ADD CONSTRAINT "supplier_products_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- Existing suppliers supply what their price lists already price (Prompt B §8.1 backfill; new rows come from /admin/suppliers).
INSERT INTO "supplier_products" ("supplier_id", "product_id")
SELECT DISTINCT pl."supplier_id", pli."product_id"
FROM "price_list_items" pli
JOIN "price_lists" pl ON pl."id" = pli."price_list_id"
ON CONFLICT DO NOTHING;
