CREATE TYPE "public"."anchor_status" AS ENUM('BUILT', 'SUBMITTED', 'CONFIRMED', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."approval_status" AS ENUM('PENDING', 'APPROVED', 'REJECTED', 'EXECUTED', 'FAILED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."approval_type" AS ENUM('PRICE_LIST_ACTIVATE', 'EXCEPTION_RESOLVE', 'DONOR_FUNDING', 'LARGE_EXPORT', 'SETTING_CHANGE', 'PRODUCT_AVAILABILITY', 'STAKEHOLDER_ACTIVATE');--> statement-breakpoint
CREATE TYPE "public"."custody_state" AS ENUM('AVAILABLE_AT_SUPPLIER', 'RESERVED_FOR_RIDER', 'PAYMENT_PENDING', 'READY_FOR_PICKUP', 'PICKED_UP', 'IN_TRANSIT', 'AT_HUB_INSPECTION', 'ACCEPTED_AT_HUB', 'AVAILABLE_AT_HUB', 'RESERVED_FOR_CHAMPION', 'WITH_CHAMPION', 'RESERVED_FOR_CUSTOMER', 'HANDED_TO_CUSTOMER', 'INSPECTION_ISSUE', 'DAMAGED_OR_QUARANTINED', 'RETURNED');--> statement-breakpoint
CREATE TYPE "public"."exception_status" AS ENUM('OPEN', 'RESOLUTION_PENDING', 'RESOLVED');--> statement-breakpoint
CREATE TYPE "public"."exception_type" AS ENUM('PAYMENT_PENDING_TOO_LONG', 'PAYMENT_REVERSED', 'WRONG_AMOUNT', 'OVERPAYMENT', 'PAYEE_MISMATCH', 'UNMATCHED_PAYMENT', 'STOCK_SHORT', 'DAMAGED_OR_WET', 'SEAL_BROKEN', 'WRONG_HUB', 'PHONE_LOST', 'REFUND_REQUEST', 'CUSTOMER_UNWELL', 'SUSPECTED_THEFT', 'WASH_CONCERN', 'RECONCILIATION_MISMATCH', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."job_status" AS ENUM('QUEUED', 'RUNNING', 'DONE', 'RETRY', 'DEAD');--> statement-breakpoint
CREATE TYPE "public"."ledger_event_type" AS ENUM('BATCH_REGISTERED', 'PAYMENT_CONFIRMED', 'PAYMENT_REVIEW', 'CUSTODY_TRANSFERRED', 'HANDOVER_COMPLETED', 'EXCEPTION_RAISED', 'EXCEPTION_RESOLVED', 'STAKEHOLDER_ACTIVATED', 'PRICE_LIST_UPDATED', 'DONOR_FUNDING_APPROVED', 'DAILY_RECONCILIATION');--> statement-breakpoint
CREATE TYPE "public"."locale" AS ENUM('sw', 'en');--> statement-breakpoint
CREATE TYPE "public"."order_kind" AS ENUM('SUPPLIER_TO_RIDER', 'RIDER_TO_HUB', 'HUB_TO_CHAMPION', 'CHAMPION_TO_CUSTOMER');--> statement-breakpoint
CREATE TYPE "public"."order_state" AS ENUM('PICKUP_ASSIGNED', 'BATCH_READY', 'EN_ROUTE', 'INSPECTING', 'REQUESTED', 'PLAN_ACTIVE', 'AWAITING_PAYMENT', 'PAID', 'FULLY_PAID', 'HANDOVER_PENDING', 'ON_HOLD', 'COMPLETED', 'CANCELLED', 'CLOSED');--> statement-breakpoint
CREATE TYPE "public"."payment_purpose" AS ENUM('SUPPLIER_SALE', 'HUB_SALE', 'CHAMPION_SALE', 'CUSTOMER_SALE');--> statement-breakpoint
CREATE TYPE "public"."payment_status" AS ENUM('PAYMENT_PENDING', 'PAYMENT_CONFIRMED', 'PAYMENT_FAILED_OR_REVIEW');--> statement-breakpoint
CREATE TYPE "public"."price_list_status" AS ENUM('DRAFT', 'PENDING_APPROVAL', 'ACTIVE', 'SUPERSEDED', 'REJECTED');--> statement-breakpoint
CREATE TYPE "public"."product_category" AS ENUM('REUSABLE', 'DISPOSABLE');--> statement-breakpoint
CREATE TYPE "public"."role" AS ENUM('SUPER_ADMIN', 'SUPPLIER', 'BOSS_RIDER', 'HUB_MANAGER', 'FIELD_CHAMPION');--> statement-breakpoint
CREATE TYPE "public"."user_status" AS ENUM('INVITED', 'ACTIVE', 'SUSPENDED', 'LOCKED', 'REMOVED');--> statement-breakpoint
CREATE TABLE "admin_action_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"admin_id" uuid,
	"action" text NOT NULL,
	"target_type" text,
	"target_id" text,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"highlighted" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_interaction_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"feature" text NOT NULL,
	"prompt_version" text NOT NULL,
	"model" text NOT NULL,
	"user_id" uuid,
	"scrubbed_input" text NOT NULL,
	"output" text NOT NULL,
	"input_tokens" integer,
	"output_tokens" integer,
	"cost_micro_usd" integer,
	"accepted" boolean,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "approval_decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"admin_id" uuid NOT NULL,
	"decision" text NOT NULL,
	"comment" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "approval_evidence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"filename" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"sha256" text NOT NULL,
	"data" "bytea" NOT NULL,
	"uploaded_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "approval_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" "approval_type" NOT NULL,
	"status" "approval_status" DEFAULT 'PENDING' NOT NULL,
	"payload" jsonb NOT NULL,
	"summary" text NOT NULL,
	"requested_by" uuid NOT NULL,
	"threshold" integer NOT NULL,
	"highlighted" boolean DEFAULT false NOT NULL,
	"decided_at" timestamp with time zone,
	"executed_at" timestamp with time zone,
	"execution_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "threshold_at_least_two" CHECK ("approval_requests"."threshold" >= 2)
);
--> statement-breakpoint
CREATE TABLE "batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"verify_ref" text NOT NULL,
	"parent_batch_id" uuid,
	"supplier_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"service_area_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	"seal_id" text,
	"prepared_on" date,
	"custody_state" "custody_state" NOT NULL,
	"locked_from_state" "custody_state",
	"custodian_user_id" uuid,
	"hub_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "batches_code_unique" UNIQUE("code"),
	CONSTRAINT "batches_verify_ref_unique" UNIQUE("verify_ref"),
	CONSTRAINT "batch_quantity_nonnegative" CHECK ("batches"."quantity" >= 0)
);
--> statement-breakpoint
CREATE TABLE "consent_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"granted" boolean NOT NULL,
	"notice_version" text NOT NULL,
	"recorded_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contract_deployments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"chain_id" integer NOT NULL,
	"network" text NOT NULL,
	"contract_address" text NOT NULL,
	"deploy_tx_hash" text,
	"active" boolean DEFAULT true NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "custody_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"batch_id" uuid NOT NULL,
	"event" text NOT NULL,
	"from_state" "custody_state",
	"to_state" "custody_state" NOT NULL,
	"actor_user_id" uuid,
	"actor_kind" text NOT NULL,
	"from_custodian_id" uuid,
	"to_custodian_id" uuid,
	"order_id" uuid,
	"quantity" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"champion_id" uuid NOT NULL,
	"display_name" text NOT NULL,
	"phone_enc" text NOT NULL,
	"phone_index" text NOT NULL,
	"service_area_id" uuid,
	"phone_verified_at" timestamp with time zone,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "data_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" uuid NOT NULL,
	"details" text NOT NULL,
	"status" text DEFAULT 'OPEN' NOT NULL,
	"handled_by" uuid,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "donor_fundings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"donor_ref" text NOT NULL,
	"amount_tzs" integer NOT NULL,
	"approval_request_id" uuid NOT NULL,
	"evidence_sha256" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "donor_fundings_approval_request_id_unique" UNIQUE("approval_request_id"),
	CONSTRAINT "donor_amount_positive" CHECK ("donor_fundings"."amount_tzs" > 0)
);
--> statement-breakpoint
CREATE TABLE "education_content_approvals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pack_sha256" text NOT NULL,
	"approved_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "enrollment_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"purpose" text NOT NULL,
	"created_by" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "enrollment_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "exceptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ref" text NOT NULL,
	"type" "exception_type" NOT NULL,
	"status" "exception_status" DEFAULT 'OPEN' NOT NULL,
	"batch_id" uuid,
	"order_id" uuid,
	"payment_intent_id" uuid,
	"reported_by" uuid,
	"reported_by_system" boolean DEFAULT false NOT NULL,
	"note" text,
	"locked_batch" boolean DEFAULT false NOT NULL,
	"resolution" text,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "exceptions_ref_unique" UNIQUE("ref")
);
--> statement-breakpoint
CREATE TABLE "hubs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"service_area_id" uuid NOT NULL,
	"min_stock_units" integer DEFAULT 10 NOT NULL,
	"active" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "idempotency_keys" (
	"key" text PRIMARY KEY NOT NULL,
	"user_id" uuid,
	"action" text NOT NULL,
	"response" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job_heartbeats" (
	"name" text PRIMARY KEY NOT NULL,
	"last_run_at" timestamp with time zone NOT NULL,
	"last_status" text NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ledger_anchor_members" (
	"event_id" bigint PRIMARY KEY NOT NULL,
	"anchor_id" uuid NOT NULL,
	"leaf_index" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ledger_anchors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"root" text NOT NULL,
	"from_event_id" bigint NOT NULL,
	"to_event_id" bigint NOT NULL,
	"event_count" integer NOT NULL,
	"status" "anchor_status" DEFAULT 'BUILT' NOT NULL,
	"contract_deployment_id" uuid,
	"chain_id" integer,
	"tx_hash" text,
	"error" text,
	"submitted_at" timestamp with time zone,
	"confirmed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ledger_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"type" "ledger_event_type" NOT NULL,
	"subject_ref" text NOT NULL,
	"order_id" uuid,
	"batch_id" uuid,
	"canonical" text NOT NULL,
	"salt" text NOT NULL,
	"leaf_hash" text NOT NULL,
	"event_date" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ledger_events_leaf_hash_unique" UNIQUE("leaf_hash")
);
--> statement-breakpoint
CREATE TABLE "mock_provider_ledger" (
	"provider_tx_ref" text PRIMARY KEY NOT NULL,
	"account_reference" text NOT NULL,
	"payee_account" text NOT NULL,
	"payer_msisdn" text NOT NULL,
	"amount_tzs" integer NOT NULL,
	"status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "offline_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"category" text NOT NULL,
	"body" text NOT NULL,
	"written_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ref" text NOT NULL,
	"verify_ref" text NOT NULL,
	"payment_ref" text NOT NULL,
	"kind" "order_kind" NOT NULL,
	"state" "order_state" NOT NULL,
	"batch_id" uuid,
	"parent_order_id" uuid,
	"seller_user_id" uuid NOT NULL,
	"buyer_user_id" uuid,
	"customer_id" uuid,
	"supplier_id" uuid,
	"hub_id" uuid,
	"product_id" uuid NOT NULL,
	"price_list_item_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	"unit_price_tzs" integer NOT NULL,
	"total_tzs" integer NOT NULL,
	"unit_cost_tzs" integer NOT NULL,
	"pickup_date" date,
	"delivery_code_hash" text,
	"delivery_code_enc" text,
	"handover_code_hash" text,
	"handover_code_expires_at" timestamp with time zone,
	"receipt_token_hash" text,
	"inspection_passed_at" timestamp with time zone,
	"sender_confirmed_at" timestamp with time zone,
	"receiver_confirmed_at" timestamp with time zone,
	"education_confirmed_at" timestamp with time zone,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "orders_ref_unique" UNIQUE("ref"),
	CONSTRAINT "orders_verify_ref_unique" UNIQUE("verify_ref"),
	CONSTRAINT "orders_payment_ref_unique" UNIQUE("payment_ref"),
	CONSTRAINT "order_amounts" CHECK ("orders"."quantity" > 0 AND "orders"."unit_price_tzs" >= 0 AND "orders"."total_tzs" = "orders"."unit_price_tzs" * "orders"."quantity" AND "orders"."unit_cost_tzs" >= 0),
	CONSTRAINT "customer_order_has_customer" CHECK ("orders"."kind" <> 'CHAMPION_TO_CUSTOMER' OR "orders"."customer_id" IS NOT NULL),
	CONSTRAINT "b2b_order_has_buyer" CHECK ("orders"."kind" = 'CHAMPION_TO_CUSTOMER' OR "orders"."buyer_user_id" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "otp_challenges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"purpose" text NOT NULL,
	"phone_index" text NOT NULL,
	"subject_id" uuid,
	"code_hash" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"device_id" text,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_intents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"purpose" "payment_purpose" NOT NULL,
	"provider" text NOT NULL,
	"payer_user_id" uuid,
	"payer_customer_id" uuid,
	"payee_user_id" uuid NOT NULL,
	"payee_account" text NOT NULL,
	"amount_tzs" integer NOT NULL,
	"amount_rule" text NOT NULL,
	"status" "payment_status" DEFAULT 'PAYMENT_PENDING' NOT NULL,
	"confirmed_amount_tzs" integer,
	"provider_tx_ref" text,
	"review_reason" text,
	"payer_claimed_at" timestamp with time zone,
	"confirmed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "intent_amount_positive" CHECK ("payment_intents"."amount_tzs" > 0 AND ("payment_intents"."confirmed_amount_tzs" IS NULL OR "payment_intents"."confirmed_amount_tzs" > 0)),
	CONSTRAINT "confirmed_needs_provider_ref" CHECK ("payment_intents"."status" <> 'PAYMENT_CONFIRMED' OR ("payment_intents"."provider_tx_ref" IS NOT NULL AND "payment_intents"."confirmed_amount_tzs" IS NOT NULL AND "payment_intents"."confirmed_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "price_list_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"price_list_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"supplier_price_tzs" integer NOT NULL,
	"hub_price_tzs" integer NOT NULL,
	"champion_price_tzs" integer NOT NULL,
	"customer_price_tzs" integer NOT NULL,
	CONSTRAINT "price_ladder_nonnegative_margins" CHECK ("price_list_items"."supplier_price_tzs" > 0 AND "price_list_items"."hub_price_tzs" >= "price_list_items"."supplier_price_tzs" AND "price_list_items"."champion_price_tzs" >= "price_list_items"."hub_price_tzs" AND "price_list_items"."customer_price_tzs" >= "price_list_items"."champion_price_tzs")
);
--> statement-breakpoint
CREATE TABLE "price_lists" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"version" integer NOT NULL,
	"service_area_id" uuid NOT NULL,
	"supplier_id" uuid NOT NULL,
	"effective_from" date NOT NULL,
	"status" "price_list_status" DEFAULT 'DRAFT' NOT NULL,
	"created_by" uuid NOT NULL,
	"approval_request_id" uuid,
	"activated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_area_availability" (
	"product_id" uuid NOT NULL,
	"service_area_id" uuid NOT NULL,
	"available" boolean NOT NULL,
	"wash_conditions_confirmed" boolean DEFAULT false NOT NULL,
	"approval_request_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_area_availability_product_id_service_area_id_pk" PRIMARY KEY("product_id","service_area_id")
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"category" "product_category" NOT NULL,
	"unit_description" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "provider_statement_imports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"filename" text NOT NULL,
	"sha256" text NOT NULL,
	"row_count" integer NOT NULL,
	"covers_from" date,
	"covers_to" date,
	"uploaded_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "provider_statement_rows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"import_id" uuid NOT NULL,
	"provider_tx_ref" text NOT NULL,
	"amount_tzs" integer NOT NULL,
	"payee_account" text,
	"occurred_on" date
);
--> statement-breakpoint
CREATE TABLE "provider_transactions" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"source" text NOT NULL,
	"source_ip" text,
	"payload" jsonb NOT NULL,
	"payload_sha256" text NOT NULL,
	"prev_hash" text NOT NULL,
	"chain_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "provider_transactions_chain_hash_unique" UNIQUE("chain_hash")
);
--> statement-breakpoint
CREATE TABLE "provider_tx_dedupe" (
	"provider" text NOT NULL,
	"provider_tx_ref" text NOT NULL,
	"outcome" text NOT NULL,
	"payment_intent_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "provider_tx_dedupe_provider_provider_tx_ref_pk" PRIMARY KEY("provider","provider_tx_ref")
);
--> statement-breakpoint
CREATE TABLE "rate_limits" (
	"key" text PRIMARY KEY NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"count" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"receipt_no" text NOT NULL,
	"content" jsonb NOT NULL,
	"content_sha256" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "receipts_order_id_unique" UNIQUE("order_id"),
	CONSTRAINT "receipts_receipt_no_unique" UNIQUE("receipt_no")
);
--> statement-breakpoint
CREATE TABLE "reconciliation_flags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid,
	"order_id" uuid,
	"batch_id" uuid,
	"kind" text NOT NULL,
	"details" jsonb NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolved_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reconciliation_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_date" date NOT NULL,
	"checked" integer NOT NULL,
	"matched" integer NOT NULL,
	"mismatched" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "refund_cases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ref" text NOT NULL,
	"order_id" uuid NOT NULL,
	"opened_by" uuid NOT NULL,
	"reason" text NOT NULL,
	"status" text DEFAULT 'OPEN' NOT NULL,
	"outcome_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	CONSTRAINT "refund_cases_ref_unique" UNIQUE("ref")
);
--> statement-breakpoint
CREATE TABLE "security_event_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"severity" text NOT NULL,
	"user_id" uuid,
	"subject_index" text,
	"ip_hash" text,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "service_areas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"region" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "service_areas_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"mfa_verified_at" timestamp with time zone,
	"device_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sms_outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"to_index" text NOT NULL,
	"to_enc" text NOT NULL,
	"purpose" text NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "suppliers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_name" text NOT NULL,
	"service_area_id" uuid,
	"active" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "training_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"module" text NOT NULL,
	"agreement_accepted" boolean DEFAULT false NOT NULL,
	"recorded_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"role" "role" NOT NULL,
	"status" "user_status" DEFAULT 'INVITED' NOT NULL,
	"display_name" text NOT NULL,
	"phone_enc" text NOT NULL,
	"phone_index" text NOT NULL,
	"service_area_id" uuid,
	"hub_id" uuid,
	"supplier_id" uuid,
	"payout_provider" text,
	"payee_account" text,
	"pin_hash" text,
	"pin_pepper_version" integer,
	"passphrase_hash" text,
	"totp_secret_enc" text,
	"totp_last_step" bigint,
	"failed_pin_count" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"lock_reason" text,
	"preferred_locale" "locale" DEFAULT 'sw' NOT NULL,
	"enrolled_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hub_manager_has_hub" CHECK ("users"."role" <> 'HUB_MANAGER' OR "users"."hub_id" IS NOT NULL),
	CONSTRAINT "supplier_has_supplier" CHECK ("users"."role" <> 'SUPPLIER' OR "users"."supplier_id" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "verification_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider_transaction_id" bigint,
	"payment_intent_id" uuid,
	"provider" text NOT NULL,
	"provider_tx_ref" text,
	"status" "job_status" DEFAULT 'QUEUED' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_run_at" timestamp with time zone DEFAULT now() NOT NULL,
	"outcome" text,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webauthn_challenges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" text NOT NULL,
	"challenge" text NOT NULL,
	"kind" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webauthn_credentials" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"public_key" "bytea" NOT NULL,
	"counter" bigint DEFAULT 0 NOT NULL,
	"transports" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "approval_decisions" ADD CONSTRAINT "approval_decisions_request_id_approval_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."approval_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_decisions" ADD CONSTRAINT "approval_decisions_admin_id_users_id_fk" FOREIGN KEY ("admin_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_evidence" ADD CONSTRAINT "approval_evidence_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batches" ADD CONSTRAINT "batches_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batches" ADD CONSTRAINT "batches_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batches" ADD CONSTRAINT "batches_service_area_id_service_areas_id_fk" FOREIGN KEY ("service_area_id") REFERENCES "public"."service_areas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batches" ADD CONSTRAINT "batches_custodian_user_id_users_id_fk" FOREIGN KEY ("custodian_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batches" ADD CONSTRAINT "batches_hub_id_hubs_id_fk" FOREIGN KEY ("hub_id") REFERENCES "public"."hubs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batches" ADD CONSTRAINT "batches_parent_batch_id_batches_id_fk" FOREIGN KEY ("parent_batch_id") REFERENCES "public"."batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consent_records" ADD CONSTRAINT "consent_records_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consent_records" ADD CONSTRAINT "consent_records_recorded_by_users_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custody_events" ADD CONSTRAINT "custody_events_batch_id_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_champion_id_users_id_fk" FOREIGN KEY ("champion_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_service_area_id_service_areas_id_fk" FOREIGN KEY ("service_area_id") REFERENCES "public"."service_areas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_requests" ADD CONSTRAINT "data_requests_handled_by_users_id_fk" FOREIGN KEY ("handled_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_requests" ADD CONSTRAINT "data_requests_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "donor_fundings" ADD CONSTRAINT "donor_fundings_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "education_content_approvals" ADD CONSTRAINT "education_content_approvals_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrollment_tokens" ADD CONSTRAINT "enrollment_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrollment_tokens" ADD CONSTRAINT "enrollment_tokens_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exceptions" ADD CONSTRAINT "exceptions_batch_id_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exceptions" ADD CONSTRAINT "exceptions_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exceptions" ADD CONSTRAINT "exceptions_payment_intent_id_payment_intents_id_fk" FOREIGN KEY ("payment_intent_id") REFERENCES "public"."payment_intents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exceptions" ADD CONSTRAINT "exceptions_reported_by_users_id_fk" FOREIGN KEY ("reported_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hubs" ADD CONSTRAINT "hubs_service_area_id_service_areas_id_fk" FOREIGN KEY ("service_area_id") REFERENCES "public"."service_areas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_anchor_members" ADD CONSTRAINT "ledger_anchor_members_event_id_ledger_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."ledger_events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_anchor_members" ADD CONSTRAINT "ledger_anchor_members_anchor_id_ledger_anchors_id_fk" FOREIGN KEY ("anchor_id") REFERENCES "public"."ledger_anchors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_anchors" ADD CONSTRAINT "ledger_anchors_contract_deployment_id_contract_deployments_id_fk" FOREIGN KEY ("contract_deployment_id") REFERENCES "public"."contract_deployments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offline_notes" ADD CONSTRAINT "offline_notes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_batch_id_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_seller_user_id_users_id_fk" FOREIGN KEY ("seller_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_buyer_user_id_users_id_fk" FOREIGN KEY ("buyer_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_hub_id_hubs_id_fk" FOREIGN KEY ("hub_id") REFERENCES "public"."hubs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_price_list_item_id_price_list_items_id_fk" FOREIGN KEY ("price_list_item_id") REFERENCES "public"."price_list_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_intents" ADD CONSTRAINT "payment_intents_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_intents" ADD CONSTRAINT "payment_intents_payer_user_id_users_id_fk" FOREIGN KEY ("payer_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_intents" ADD CONSTRAINT "payment_intents_payer_customer_id_customers_id_fk" FOREIGN KEY ("payer_customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_intents" ADD CONSTRAINT "payment_intents_payee_user_id_users_id_fk" FOREIGN KEY ("payee_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_intents" ADD CONSTRAINT "payment_intents_provider_provider_tx_ref_provider_tx_dedupe_provider_provider_tx_ref_fk" FOREIGN KEY ("provider","provider_tx_ref") REFERENCES "public"."provider_tx_dedupe"("provider","provider_tx_ref") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_list_items" ADD CONSTRAINT "price_list_items_price_list_id_price_lists_id_fk" FOREIGN KEY ("price_list_id") REFERENCES "public"."price_lists"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_list_items" ADD CONSTRAINT "price_list_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_lists" ADD CONSTRAINT "price_lists_service_area_id_service_areas_id_fk" FOREIGN KEY ("service_area_id") REFERENCES "public"."service_areas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_lists" ADD CONSTRAINT "price_lists_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_lists" ADD CONSTRAINT "price_lists_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_area_availability" ADD CONSTRAINT "product_area_availability_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_area_availability" ADD CONSTRAINT "product_area_availability_service_area_id_service_areas_id_fk" FOREIGN KEY ("service_area_id") REFERENCES "public"."service_areas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_statement_imports" ADD CONSTRAINT "provider_statement_imports_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_statement_rows" ADD CONSTRAINT "provider_statement_rows_import_id_provider_statement_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."provider_statement_imports"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconciliation_flags" ADD CONSTRAINT "reconciliation_flags_run_id_reconciliation_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."reconciliation_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconciliation_flags" ADD CONSTRAINT "reconciliation_flags_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconciliation_flags" ADD CONSTRAINT "reconciliation_flags_batch_id_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconciliation_flags" ADD CONSTRAINT "reconciliation_flags_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refund_cases" ADD CONSTRAINT "refund_cases_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refund_cases" ADD CONSTRAINT "refund_cases_opened_by_users_id_fk" FOREIGN KEY ("opened_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_service_area_id_service_areas_id_fk" FOREIGN KEY ("service_area_id") REFERENCES "public"."service_areas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_records" ADD CONSTRAINT "training_records_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_records" ADD CONSTRAINT "training_records_recorded_by_users_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_service_area_id_service_areas_id_fk" FOREIGN KEY ("service_area_id") REFERENCES "public"."service_areas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_hub_id_hubs_id_fk" FOREIGN KEY ("hub_id") REFERENCES "public"."hubs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verification_jobs" ADD CONSTRAINT "verification_jobs_provider_transaction_id_provider_transactions_id_fk" FOREIGN KEY ("provider_transaction_id") REFERENCES "public"."provider_transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verification_jobs" ADD CONSTRAINT "verification_jobs_payment_intent_id_payment_intents_id_fk" FOREIGN KEY ("payment_intent_id") REFERENCES "public"."payment_intents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webauthn_credentials" ADD CONSTRAINT "webauthn_credentials_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "approval_decisions_uq" ON "approval_decisions" USING btree ("request_id","admin_id");--> statement-breakpoint
CREATE INDEX "approval_status_idx" ON "approval_requests" USING btree ("status");--> statement-breakpoint
CREATE INDEX "batches_custodian_idx" ON "batches" USING btree ("custodian_user_id","custody_state");--> statement-breakpoint
CREATE INDEX "custody_events_batch_idx" ON "custody_events" USING btree ("batch_id");--> statement-breakpoint
CREATE UNIQUE INDEX "customers_phone_index_uq" ON "customers" USING btree ("phone_index");--> statement-breakpoint
CREATE INDEX "customers_champion_idx" ON "customers" USING btree ("champion_id");--> statement-breakpoint
CREATE INDEX "exceptions_status_idx" ON "exceptions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "anchor_members_anchor_idx" ON "ledger_anchor_members" USING btree ("anchor_id");--> statement-breakpoint
CREATE INDEX "ledger_events_order_idx" ON "ledger_events" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "ledger_events_batch_idx" ON "ledger_events" USING btree ("batch_id");--> statement-breakpoint
CREATE UNIQUE INDEX "offline_notes_client_uq" ON "offline_notes" USING btree ("user_id","client_id");--> statement-breakpoint
CREATE INDEX "orders_seller_idx" ON "orders" USING btree ("seller_user_id","state");--> statement-breakpoint
CREATE INDEX "orders_buyer_idx" ON "orders" USING btree ("buyer_user_id","state");--> statement-breakpoint
CREATE INDEX "orders_customer_idx" ON "orders" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "otp_phone_idx" ON "otp_challenges" USING btree ("phone_index","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_intents_provider_tx_uq" ON "payment_intents" USING btree ("provider","provider_tx_ref");--> statement-breakpoint
CREATE INDEX "payment_intents_order_idx" ON "payment_intents" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "payment_intents_status_idx" ON "payment_intents" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "price_list_items_uq" ON "price_list_items" USING btree ("price_list_id","product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "price_lists_version_uq" ON "price_lists" USING btree ("service_area_id","supplier_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "price_lists_one_active_uq" ON "price_lists" USING btree ("service_area_id","supplier_id") WHERE "price_lists"."status" = 'ACTIVE';--> statement-breakpoint
CREATE INDEX "recon_flags_order_idx" ON "reconciliation_flags" USING btree ("order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "recon_flags_open_uq" ON "reconciliation_flags" USING btree ("order_id","kind") WHERE "reconciliation_flags"."resolved_at" IS NULL;--> statement-breakpoint
CREATE INDEX "security_events_type_idx" ON "security_event_log" USING btree ("type","created_at");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_phone_index_uq" ON "users" USING btree ("phone_index");--> statement-breakpoint
CREATE UNIQUE INDEX "users_payee_account_uq" ON "users" USING btree ("payee_account");--> statement-breakpoint
CREATE INDEX "verification_jobs_due_idx" ON "verification_jobs" USING btree ("status","next_run_at");