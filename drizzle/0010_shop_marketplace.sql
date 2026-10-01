ALTER TYPE "public"."exception_type" ADD VALUE 'SAFETY_CONCERN' BEFORE 'OTHER';--> statement-breakpoint
ALTER TABLE "customer_requests" ADD COLUMN "women_only" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "meeting_points" ADD COLUMN "when_text" text;--> statement-breakpoint
-- Who may hand over (a woman local seller only, or anyone) is part of the request's terms.
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
     OR NEW.women_only <> OLD.women_only THEN
    RAISE EXCEPTION 'shop request terms are immutable' USING ERRCODE = 'P0001';
  END IF;
  IF OLD.state <> 'OPEN' THEN
    RAISE EXCEPTION 'a finished shop request cannot change' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
