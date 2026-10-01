ALTER TYPE "public"."organisation_kind" ADD VALUE 'PHARMACY';--> statement-breakpoint
ALTER TYPE "public"."organisation_kind" ADD VALUE 'BUSINESS';--> statement-breakpoint
ALTER TABLE "organisations" ADD COLUMN "women_owned" boolean DEFAULT false NOT NULL;