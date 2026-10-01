ALTER TABLE "payment_intents" ADD COLUMN "review_closed_at" timestamp with time zone;--> statement-breakpoint
-- A payment's review can be closed once, and only while it is in review (Prompt M §2).
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
    IF NEW.review_closed_at IS NOT NULL THEN
      RAISE EXCEPTION 'a new payment has no closed review' USING ERRCODE = 'P0001';
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
  IF NEW.review_closed_at IS DISTINCT FROM OLD.review_closed_at
     AND (OLD.review_closed_at IS NOT NULL OR NEW.status <> 'PAYMENT_FAILED_OR_REVIEW') THEN
    RAISE EXCEPTION 'a payment review closes once, and only while in review' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
-- Payments whose problems were all closed before this column existed are closed now, so the count is right at once.
UPDATE payment_intents p SET review_closed_at = now()
WHERE p.status = 'PAYMENT_FAILED_OR_REVIEW'
  AND EXISTS (SELECT 1 FROM exceptions e WHERE e.payment_intent_id = p.id)
  AND NOT EXISTS (SELECT 1 FROM exceptions e WHERE e.payment_intent_id = p.id AND e.status <> 'RESOLVED');
