/**
 * Database schema (Drizzle). Rules enforced here and by tests:
 *  - money columns are integer TZS (`*_tzs`), never float/numeric (§3.7);
 *  - no columns for menstrual-cycle, diagnosis, pregnancy, sexual history,
 *    or precise location (§3.9);
 *  - phone numbers are envelope-encrypted with an HMAC blind index (§4.12);
 *  - append-only tables are protected by triggers in the custom migration.
 */
import { now } from "@/lib/clock";
import { sql } from "drizzle-orm";
import {
  bigint,
  bigserial,
  boolean,
  check,
  customType,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import {
  APPROVAL_TYPES,
  CUSTODY_STATES,
  EXCEPTION_TYPES,
  LEDGER_EVENT_TYPES,
  LOGIN_ROLES,
  ORDER_KINDS,
  ORDER_STATES,
  PAYMENT_PURPOSES,
  PAYMENT_STATUSES,
  PRODUCT_CATEGORIES,
  ORGANISATION_KINDS,
  ROAD_TYPES,
  type OrderKind,
} from "@/lib/domain/types";

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return "bytea";
  },
});

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
// Insert-time defaults come from the application clock (ADR-024) so seeded history is backdated
// consistently; the SQL default stays for raw inserts.
const createdAt = () => ts("created_at").notNull().defaultNow().$defaultFn(() => now());
const updatedAt = () => ts("updated_at").notNull().defaultNow().$defaultFn(() => now());

// ---------- enums ----------
export const roleEnum = pgEnum("role", LOGIN_ROLES);
export const userStatusEnum = pgEnum("user_status", ["INVITED", "ACTIVE", "SUSPENDED", "LOCKED", "REMOVED"]);
export const custodyStateEnum = pgEnum("custody_state", CUSTODY_STATES);
export const paymentStatusEnum = pgEnum("payment_status", PAYMENT_STATUSES);
export const orderKindEnum = pgEnum("order_kind", ORDER_KINDS);
export const organisationKindEnum = pgEnum("organisation_kind", ORGANISATION_KINDS);
export const orderStateEnum = pgEnum("order_state", ORDER_STATES);
export const paymentPurposeEnum = pgEnum("payment_purpose", PAYMENT_PURPOSES);
export const exceptionTypeEnum = pgEnum("exception_type", EXCEPTION_TYPES);
export const exceptionStatusEnum = pgEnum("exception_status", ["OPEN", "RESOLUTION_PENDING", "RESOLVED"]);
export const approvalTypeEnum = pgEnum("approval_type", APPROVAL_TYPES);
export const approvalStatusEnum = pgEnum("approval_status", ["PENDING", "APPROVED", "REJECTED", "EXECUTED", "FAILED", "CANCELLED"]);
export const productCategoryEnum = pgEnum("product_category", PRODUCT_CATEGORIES);
export const priceListStatusEnum = pgEnum("price_list_status", ["DRAFT", "PENDING_APPROVAL", "ACTIVE", "SUPERSEDED", "REJECTED"]);
export const ledgerEventTypeEnum = pgEnum("ledger_event_type", LEDGER_EVENT_TYPES);
export const anchorStatusEnum = pgEnum("anchor_status", ["BUILT", "SUBMITTED", "CONFIRMED", "FAILED"]);
export const jobStatusEnum = pgEnum("job_status", ["QUEUED", "RUNNING", "DONE", "RETRY", "DEAD"]);
export const localeEnum = pgEnum("locale", ["sw", "en"]);
export const roadTypeEnum = pgEnum("road_type", ROAD_TYPES);

// ---------- reference data ----------
export const serviceAreas = pgTable("service_areas", {
  id: uuid("id").primaryKey().defaultRandom(),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  region: text("region").notNull(),
  active: boolean("active").notNull().default(true),
  /**
   * Sale paths beyond the handbook ladder that this area allows (prompt §8.8.2).
   * Changed only through the AREA_SALES_CHANGE dual approval. The ladder is always allowed.
   */
  allowedSales: jsonb("allowed_sales").$type<OrderKind[]>().notNull().default(sql`'[]'::jsonb`),
  /** Months (1–12) when the rains slow the roads here (Prompt I §2.1); restock plans for longer trips then. */
  rainyMonths: jsonb("rainy_months").$type<number[]>().notNull().default(sql`'[]'::jsonb`),
  createdAt: createdAt(),
});

/**
 * A supplier organisation (handbook §8A "Supplier / Factory"): the company
 * that manufactures or sells the products. Several SUPPLIER users may belong
 * to it; activation is dual-approved (STAKEHOLDER_ACTIVATE, ADR-029). The
 * only person-linked field is an optional business contact, encrypted like
 * every phone number.
 */
export const suppliers = pgTable("suppliers", {
  id: uuid("id").primaryKey().defaultRandom(),
  businessName: text("business_name").notNull(),
  serviceAreaId: uuid("service_area_id").references(() => serviceAreas.id),
  active: boolean("active").notNull().default(false),
  contactName: text("contact_name"),
  contactPhoneEnc: text("contact_phone_enc"),
  contactPhoneIndex: text("contact_phone_index"),
  /** Days from "pickup assigned" to "batch ready" the supplier commits to; older open pickups need attention. */
  leadTimeDays: integer("lead_time_days").notNull().default(2),
  /** Display only — e.g. "paid on pickup, mobile money"; never a contract. */
  paymentTermsNote: text("payment_terms_note"),
  notes: text("notes"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/**
 * A buyer organisation — NGO, non-profit, school, community group (prompt
 * §8.8.4). A record, not a login: it pays by mobile money and gets the same
 * SMS receipt and verify link a customer gets. Nothing about the people it
 * serves is recorded. Activation is the STAKEHOLDER_ACTIVATE dual approval.
 */
export const organisations = pgTable("organisations", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  kind: organisationKindEnum("kind").notNull(),
  serviceAreaId: uuid("service_area_id").references(() => serviceAreas.id),
  active: boolean("active").notNull().default(false),
  contactName: text("contact_name"),
  contactPhoneEnc: text("contact_phone_enc"),
  contactPhoneIndex: text("contact_phone_index"),
  notes: text("notes"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/** Which products a supplier supplies; a pickup can only be assigned for one of them. */
export const supplierProducts = pgTable(
  "supplier_products",
  {
    supplierId: uuid("supplier_id").notNull().references(() => suppliers.id),
    productId: uuid("product_id").notNull().references(() => products.id),
    supplierSku: text("supplier_sku"),
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.supplierId, t.productId] })],
);

export const hubs = pgTable(
  "hubs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    serviceAreaId: uuid("service_area_id").notNull().references(() => serviceAreas.id),
    minStockUnits: integer("min_stock_units").notNull().default(10),
    active: boolean("active").notNull().default(false),
    /**
     * The road to the hub (Prompt I §2.1): kilometres from the district town and the worst stretch on the way,
     * and whether the rains slow it. Planning data for restocking, never a location; null = not yet recorded.
     */
    distanceKm: integer("distance_km"),
    road: roadTypeEnum("road"),
    slowInRains: boolean("slow_in_rains").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [check("hub_distance_range", sql`${t.distanceKm} IS NULL OR (${t.distanceKm} >= 0 AND ${t.distanceKm} <= 2000)`)],
);

export const products = pgTable("products", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  category: productCategoryEnum("category").notNull(),
  unitDescription: text("unit_description").notNull(),
  active: boolean("active").notNull().default(true),
  createdAt: createdAt(),
});

/** WASH-driven product availability per area (handbook §11). Changes need dual approval. */
export const productAreaAvailability = pgTable(
  "product_area_availability",
  {
    productId: uuid("product_id").notNull().references(() => products.id),
    serviceAreaId: uuid("service_area_id").notNull().references(() => serviceAreas.id),
    available: boolean("available").notNull(),
    washConditionsConfirmed: boolean("wash_conditions_confirmed").notNull().default(false),
    approvalRequestId: uuid("approval_request_id"),
    updatedAt: updatedAt(),
  },
  (t) => [primaryKey({ columns: [t.productId, t.serviceAreaId] })],
);

// ---------- users & auth ----------
export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    role: roleEnum("role").notNull(),
    status: userStatusEnum("status").notNull().default("INVITED"),
    displayName: text("display_name").notNull(),
    phoneEnc: text("phone_enc").notNull(),
    phoneIndex: text("phone_index").notNull(),
    serviceAreaId: uuid("service_area_id").references(() => serviceAreas.id),
    hubId: uuid("hub_id").references(() => hubs.id),
    supplierId: uuid("supplier_id").references(() => suppliers.id),
    /** Mobile-money provider name for this stakeholder's payout route. */
    payoutProvider: text("payout_provider"),
    /** Merchant till / account the stakeholder is paid into (payee identifier). */
    payeeAccount: text("payee_account"),
    pinHash: text("pin_hash"),
    pinPepperVersion: integer("pin_pepper_version"),
    passphraseHash: text("passphrase_hash"),
    totpSecretEnc: text("totp_secret_enc"),
    totpLastStep: bigint("totp_last_step", { mode: "number" }),
    failedPinCount: integer("failed_pin_count").notNull().default(0),
    lockedUntil: ts("locked_until"),
    lockReason: text("lock_reason"),
    preferredLocale: localeEnum("preferred_locale").notNull().default("sw"),
    enrolledAt: ts("enrolled_at"),
    createdBy: uuid("created_by"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("users_phone_index_uq").on(t.phoneIndex),
    uniqueIndex("users_payee_account_uq").on(t.payeeAccount),
    check("hub_manager_has_hub", sql`${t.role} <> 'HUB_MANAGER' OR ${t.hubId} IS NOT NULL`),
    check("supplier_has_supplier", sql`${t.role} <> 'SUPPLIER' OR ${t.supplierId} IS NOT NULL`),
  ],
);

export const sessions = pgTable(
  "sessions",
  {
    id: text("id").primaryKey(), // sha256 of the cookie token
    userId: uuid("user_id").notNull().references(() => users.id),
    kind: text("kind", { enum: ["FIELD", "ADMIN"] }).notNull(),
    mfaVerifiedAt: ts("mfa_verified_at"),
    deviceId: text("device_id"),
    /** How the session began: a real sign-in, or the open demo's one-click entry (Prompt E; never in production). */
    via: text("via", { enum: ["LOGIN", "OPEN_DEMO"] }).notNull().default("LOGIN"),
    createdAt: createdAt(),
    lastSeenAt: ts("last_seen_at").notNull().defaultNow().$defaultFn(() => now()),
    expiresAt: ts("expires_at").notNull(),
    revokedAt: ts("revoked_at"),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

export const enrollmentTokens = pgTable("enrollment_tokens", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id),
  tokenHash: text("token_hash").notNull().unique(),
  purpose: text("purpose", { enum: ["ENROLL", "REENROLL"] }).notNull(),
  createdBy: uuid("created_by").notNull().references(() => users.id),
  expiresAt: ts("expires_at").notNull(),
  usedAt: ts("used_at"),
  createdAt: createdAt(),
});

export const otpChallenges = pgTable(
  "otp_challenges",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    purpose: text("purpose", { enum: ["ENROLL", "CUSTOMER_VERIFY", "HANDOVER"] }).notNull(),
    phoneIndex: text("phone_index").notNull(),
    subjectId: uuid("subject_id"), // enrollment token / customer / order id
    codeHash: text("code_hash").notNull(),
    attempts: integer("attempts").notNull().default(0),
    deviceId: text("device_id"),
    expiresAt: ts("expires_at").notNull(),
    consumedAt: ts("consumed_at"),
    createdAt: createdAt(),
  },
  (t) => [index("otp_phone_idx").on(t.phoneIndex, t.createdAt)],
);

export const webauthnCredentials = pgTable("webauthn_credentials", {
  id: text("id").primaryKey(), // credential ID, base64url
  userId: uuid("user_id").notNull().references(() => users.id),
  publicKey: bytea("public_key").notNull(),
  counter: bigint("counter", { mode: "number" }).notNull().default(0),
  transports: jsonb("transports").$type<string[]>(),
  createdAt: createdAt(),
  lastUsedAt: ts("last_used_at"),
});

export const webauthnChallenges = pgTable("webauthn_challenges", {
  id: uuid("id").primaryKey().defaultRandom(),
  sessionId: text("session_id").notNull(),
  challenge: text("challenge").notNull(),
  kind: text("kind", { enum: ["REGISTER", "AUTHENTICATE"] }).notNull(),
  expiresAt: ts("expires_at").notNull(),
  createdAt: createdAt(),
});

export const trainingRecords = pgTable("training_records", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id),
  module: text("module").notNull(),
  agreementAccepted: boolean("agreement_accepted").notNull().default(false),
  recordedBy: uuid("recorded_by").notNull().references(() => users.id),
  completedAt: createdAt(),
});

// ---------- customers ----------
export const customers = pgTable(
  "customers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** The stakeholder who enrolled and serves this customer: a champion on the ladder, a rider or supplier user on a direct path (prompt §8.8). */
    championId: uuid("champion_id").notNull().references(() => users.id),
    displayName: text("display_name").notNull(), // name or preferred name only
    phoneEnc: text("phone_enc").notNull(),
    phoneIndex: text("phone_index").notNull(),
    /** Optional broad service area (never a precise location). */
    serviceAreaId: uuid("service_area_id").references(() => serviceAreas.id),
    phoneVerifiedAt: ts("phone_verified_at"),
    status: text("status", { enum: ["ACTIVE", "DELETED"] }).notNull().default("ACTIVE"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("customers_phone_index_uq").on(t.phoneIndex), index("customers_champion_idx").on(t.championId)],
);

export const consentRecords = pgTable("consent_records", {
  id: uuid("id").primaryKey().defaultRandom(),
  customerId: uuid("customer_id").notNull().references(() => customers.id),
  kind: text("kind", { enum: ["TRANSACTION_MESSAGES", "REMINDERS"] }).notNull(),
  granted: boolean("granted").notNull(),
  noticeVersion: text("notice_version").notNull(),
  recordedBy: uuid("recorded_by").notNull().references(() => users.id),
  createdAt: createdAt(),
});

// ---------- prices ----------
export const priceLists = pgTable(
  "price_lists",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    version: integer("version").notNull(),
    serviceAreaId: uuid("service_area_id").notNull().references(() => serviceAreas.id),
    supplierId: uuid("supplier_id").notNull().references(() => suppliers.id),
    effectiveFrom: date("effective_from", { mode: "string" }).notNull(),
    status: priceListStatusEnum("status").notNull().default("DRAFT"),
    createdBy: uuid("created_by").notNull().references(() => users.id),
    approvalRequestId: uuid("approval_request_id"),
    activatedAt: ts("activated_at"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("price_lists_version_uq").on(t.serviceAreaId, t.supplierId, t.version),
    uniqueIndex("price_lists_one_active_uq").on(t.serviceAreaId, t.supplierId).where(sql`${t.status} = 'ACTIVE'`),
  ],
);

export const priceListItems = pgTable(
  "price_list_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    priceListId: uuid("price_list_id").notNull().references(() => priceLists.id),
    productId: uuid("product_id").notNull().references(() => products.id),
    supplierPriceTzs: integer("supplier_price_tzs").notNull(),
    hubPriceTzs: integer("hub_price_tzs").notNull(),
    championPriceTzs: integer("champion_price_tzs").notNull(),
    customerPriceTzs: integer("customer_price_tzs").notNull(),
    /** What an organisation pays per unit when it buys from this supplier's chain; null = not offered to organisations. */
    organisationPriceTzs: integer("organisation_price_tzs"),
  },
  (t) => [
    uniqueIndex("price_list_items_uq").on(t.priceListId, t.productId),
    check(
      "price_ladder_nonnegative_margins",
      sql`${t.supplierPriceTzs} > 0 AND ${t.hubPriceTzs} >= ${t.supplierPriceTzs} AND ${t.championPriceTzs} >= ${t.hubPriceTzs} AND ${t.customerPriceTzs} >= ${t.championPriceTzs}`,
    ),
  ],
);

// ---------- inventory ----------
export const batches = pgTable(
  "batches",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    code: text("code").notNull().unique(),
    verifyRef: text("verify_ref").notNull().unique(),
    parentBatchId: uuid("parent_batch_id"),
    supplierId: uuid("supplier_id").notNull().references(() => suppliers.id),
    productId: uuid("product_id").notNull().references(() => products.id),
    serviceAreaId: uuid("service_area_id").notNull().references(() => serviceAreas.id),
    quantity: integer("quantity").notNull(),
    sealId: text("seal_id"),
    preparedOn: date("prepared_on", { mode: "string" }),
    custodyState: custodyStateEnum("custody_state").notNull(),
    /** Custody state at the moment the batch was locked (for dual-approved resume). */
    lockedFromState: custodyStateEnum("locked_from_state"),
    custodianUserId: uuid("custodian_user_id").references(() => users.id),
    hubId: uuid("hub_id").references(() => hubs.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    foreignKey({ columns: [t.parentBatchId], foreignColumns: [t.id] }),
    check("batch_quantity_nonnegative", sql`${t.quantity} >= 0`),
    index("batches_custodian_idx").on(t.custodianUserId, t.custodyState),
    index("batches_hub_state_idx").on(t.hubId, t.custodyState),
  ],
);

export const custodyEvents = pgTable(
  "custody_events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    batchId: uuid("batch_id").notNull().references(() => batches.id),
    event: text("event").notNull(),
    fromState: custodyStateEnum("from_state"),
    toState: custodyStateEnum("to_state").notNull(),
    actorUserId: uuid("actor_user_id"),
    actorKind: text("actor_kind").notNull(),
    fromCustodianId: uuid("from_custodian_id"),
    toCustodianId: uuid("to_custodian_id"),
    orderId: uuid("order_id"),
    quantity: integer("quantity").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("custody_events_batch_idx").on(t.batchId)],
);

/**
 * What each hub held of each product at the end of each day (Prompt I §2.3), written by the nightly job.
 * A day with nothing on the shelf is a day the hub could not sell, so restock planning does not read it
 * as a day nobody wanted to buy.
 */
export const hubStockDays = pgTable(
  "hub_stock_days",
  {
    hubId: uuid("hub_id").notNull().references(() => hubs.id),
    productId: uuid("product_id").notNull().references(() => products.id),
    day: date("day", { mode: "string" }).notNull(),
    onHand: integer("on_hand").notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.hubId, t.productId, t.day] }), check("hub_stock_days_nonnegative", sql`${t.onHand} >= 0`)],
);

// ---------- orders & payments ----------
export const orders = pgTable(
  "orders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ref: text("ref").notNull().unique(), // human-readable reference
    verifyRef: text("verify_ref").notNull().unique(), // 128-bit public ref
    /** Account reference the payer uses with mobile money. */
    paymentRef: text("payment_ref").notNull().unique(),
    kind: orderKindEnum("kind").notNull(),
    state: orderStateEnum("state").notNull(),
    batchId: uuid("batch_id").references(() => batches.id),
    parentOrderId: uuid("parent_order_id"),
    sellerUserId: uuid("seller_user_id").notNull().references(() => users.id),
    buyerUserId: uuid("buyer_user_id").references(() => users.id),
    customerId: uuid("customer_id").references(() => customers.id),
    supplierId: uuid("supplier_id").references(() => suppliers.id),
    hubId: uuid("hub_id").references(() => hubs.id),
    /** Buyer organisation for the *_TO_ORG kinds (prompt §8.8). */
    organisationId: uuid("organisation_id").references(() => organisations.id),
    productId: uuid("product_id").notNull().references(() => products.id),
    priceListItemId: uuid("price_list_item_id").notNull().references(() => priceListItems.id),
    quantity: integer("quantity").notNull(),
    unitPriceTzs: integer("unit_price_tzs").notNull(),
    totalTzs: integer("total_tzs").notNull(),
    /** What the seller paid per unit (for margin display). */
    unitCostTzs: integer("unit_cost_tzs").notNull(),
    pickupDate: date("pickup_date", { mode: "string" }),
    deliveryCodeHash: text("delivery_code_hash"),
    deliveryCodeEnc: text("delivery_code_enc"),
    handoverCodeHash: text("handover_code_hash"),
    handoverCodeExpiresAt: ts("handover_code_expires_at"),
    receiptTokenHash: text("receipt_token_hash"),
    inspectionPassedAt: ts("inspection_passed_at"),
    senderConfirmedAt: ts("sender_confirmed_at"),
    receiverConfirmedAt: ts("receiver_confirmed_at"),
    educationConfirmedAt: ts("education_confirmed_at"),
    createdBy: uuid("created_by").notNull().references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    completedAt: ts("completed_at"),
  },
  (t) => [
    check("order_amounts", sql`${t.quantity} > 0 AND ${t.unitPriceTzs} >= 0 AND ${t.totalTzs} = ${t.unitPriceTzs} * ${t.quantity} AND ${t.unitCostTzs} >= 0`),
    // Every order has exactly one kind of buyer: a stakeholder, a customer or an organisation (the services pick which per kind).
    check("order_has_buyer", sql`(${t.buyerUserId} IS NOT NULL)::int + (${t.customerId} IS NOT NULL)::int + (${t.organisationId} IS NOT NULL)::int = 1`),
    index("orders_seller_idx").on(t.sellerUserId, t.state),
    index("orders_buyer_idx").on(t.buyerUserId, t.state),
    index("orders_customer_idx").on(t.customerId),
    // Ecosystem snapshot: orders in flight by kind/state and by hub (Prompt B §3.2).
    index("orders_kind_state_idx").on(t.kind, t.state),
    index("orders_hub_state_idx").on(t.hubId, t.state),
  ],
);

/** Permanent dedupe of provider transaction references (§3.1). Never deleted. */
export const providerTxDedupe = pgTable(
  "provider_tx_dedupe",
  {
    provider: text("provider").notNull(),
    providerTxRef: text("provider_tx_ref").notNull(),
    outcome: text("outcome").notNull(),
    paymentIntentId: uuid("payment_intent_id"),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.provider, t.providerTxRef] })],
);

export const paymentIntents = pgTable(
  "payment_intents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderId: uuid("order_id").notNull().references(() => orders.id),
    purpose: paymentPurposeEnum("purpose").notNull(),
    provider: text("provider").notNull(),
    payerUserId: uuid("payer_user_id").references(() => users.id),
    payerCustomerId: uuid("payer_customer_id").references(() => customers.id),
    payeeUserId: uuid("payee_user_id").notNull().references(() => users.id),
    payeeAccount: text("payee_account").notNull(),
    /** Expected amount (B2B: exact; installments: upper bound at creation). */
    amountTzs: integer("amount_tzs").notNull(),
    amountRule: text("amount_rule", { enum: ["EXACT_REMAINING", "UP_TO_REMAINING"] }).notNull(),
    status: paymentStatusEnum("status").notNull().default("PAYMENT_PENDING"),
    confirmedAmountTzs: integer("confirmed_amount_tzs"),
    providerTxRef: text("provider_tx_ref"),
    reviewReason: text("review_reason"),
    payerClaimedAt: ts("payer_claimed_at"),
    confirmedAt: ts("confirmed_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("payment_intents_status_confirmed_idx").on(t.status, t.confirmedAt),
    check("intent_amount_positive", sql`${t.amountTzs} > 0 AND (${t.confirmedAmountTzs} IS NULL OR ${t.confirmedAmountTzs} > 0)`),
    check(
      "confirmed_needs_provider_ref",
      sql`${t.status} <> 'PAYMENT_CONFIRMED' OR (${t.providerTxRef} IS NOT NULL AND ${t.confirmedAmountTzs} IS NOT NULL AND ${t.confirmedAt} IS NOT NULL)`,
    ),
    uniqueIndex("payment_intents_provider_tx_uq").on(t.provider, t.providerTxRef),
    foreignKey({ columns: [t.provider, t.providerTxRef], foreignColumns: [providerTxDedupe.provider, providerTxDedupe.providerTxRef] }),
    index("payment_intents_order_idx").on(t.orderId),
    index("payment_intents_status_idx").on(t.status),
  ],
);

/** Raw callback / poll payloads: append-only, hash-chained (§5). */
export const providerTransactions = pgTable("provider_transactions", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  provider: text("provider").notNull(),
  source: text("source", { enum: ["CALLBACK", "POLL"] }).notNull(),
  sourceIp: text("source_ip"),
  payload: jsonb("payload").notNull(),
  payloadSha256: text("payload_sha256").notNull(),
  prevHash: text("prev_hash").notNull(),
  chainHash: text("chain_hash").notNull().unique(),
  receivedAt: createdAt(),
});

export const verificationJobs = pgTable(
  "verification_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    providerTransactionId: bigint("provider_transaction_id", { mode: "number" }).references(() => providerTransactions.id),
    paymentIntentId: uuid("payment_intent_id").references(() => paymentIntents.id),
    provider: text("provider").notNull(),
    providerTxRef: text("provider_tx_ref"),
    status: jobStatusEnum("status").notNull().default("QUEUED"),
    attempts: integer("attempts").notNull().default(0),
    nextRunAt: ts("next_run_at").notNull().defaultNow().$defaultFn(() => now()),
    outcome: text("outcome"),
    lastError: text("last_error"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("verification_jobs_due_idx").on(t.status, t.nextRunAt)],
);

/** MockProvider's own "remote" ledger — stands in for the telco's records. */
export const mockProviderLedger = pgTable("mock_provider_ledger", {
  providerTxRef: text("provider_tx_ref").primaryKey(),
  accountReference: text("account_reference").notNull(),
  payeeAccount: text("payee_account").notNull(),
  payerMsisdn: text("payer_msisdn").notNull(),
  amountTzs: integer("amount_tzs").notNull(),
  status: text("status", { enum: ["SUCCESS", "FAILED", "PENDING", "REVERSED"] }).notNull(),
  occurredAt: createdAt(),
});

export const donorFundings = pgTable(
  "donor_fundings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderId: uuid("order_id").notNull().references(() => orders.id),
    donorRef: text("donor_ref").notNull(),
    amountTzs: integer("amount_tzs").notNull(),
    approvalRequestId: uuid("approval_request_id").notNull().unique(),
    evidenceSha256: text("evidence_sha256").notNull(),
    approvedAt: createdAt(),
  },
  (t) => [check("donor_amount_positive", sql`${t.amountTzs} > 0`)],
);

export const receipts = pgTable("receipts", {
  id: uuid("id").primaryKey().defaultRandom(),
  orderId: uuid("order_id").notNull().unique().references(() => orders.id),
  receiptNo: text("receipt_no").notNull().unique(),
  content: jsonb("content").notNull(),
  contentSha256: text("content_sha256").notNull(),
  createdAt: createdAt(),
});

// ---------- exceptions, approvals, cases ----------
export const exceptions = pgTable(
  "exceptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ref: text("ref").notNull().unique(),
    type: exceptionTypeEnum("type").notNull(),
    status: exceptionStatusEnum("status").notNull().default("OPEN"),
    batchId: uuid("batch_id").references(() => batches.id),
    orderId: uuid("order_id").references(() => orders.id),
    paymentIntentId: uuid("payment_intent_id").references(() => paymentIntents.id),
    reportedBy: uuid("reported_by").references(() => users.id),
    reportedBySystem: boolean("reported_by_system").notNull().default(false),
    note: text("note"),
    lockedBatch: boolean("locked_batch").notNull().default(false),
    resolution: text("resolution"),
    resolvedAt: ts("resolved_at"),
    createdAt: createdAt(),
  },
  (t) => [index("exceptions_status_idx").on(t.status)],
);

export const approvalRequests = pgTable(
  "approval_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    type: approvalTypeEnum("type").notNull(),
    status: approvalStatusEnum("status").notNull().default("PENDING"),
    payload: jsonb("payload").notNull(),
    summary: text("summary").notNull(),
    requestedBy: uuid("requested_by").notNull().references(() => users.id),
    threshold: integer("threshold").notNull(),
    highlighted: boolean("highlighted").notNull().default(false),
    decidedAt: ts("decided_at"),
    executedAt: ts("executed_at"),
    executionError: text("execution_error"),
    createdAt: createdAt(),
  },
  (t) => [check("threshold_at_least_two", sql`${t.threshold} >= 2`), index("approval_status_idx").on(t.status)],
);

export const approvalDecisions = pgTable(
  "approval_decisions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    requestId: uuid("request_id").notNull().references(() => approvalRequests.id),
    adminId: uuid("admin_id").notNull().references(() => users.id),
    decision: text("decision", { enum: ["APPROVE", "REJECT"] }).notNull(),
    comment: text("comment"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("approval_decisions_uq").on(t.requestId, t.adminId)],
);

/** Append-only. Bound to a request through the request's payload.evidenceId. */
export const approvalEvidence = pgTable("approval_evidence", {
  id: uuid("id").primaryKey().defaultRandom(),
  filename: text("filename").notNull(),
  contentType: text("content_type").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  sha256: text("sha256").notNull(),
  data: bytea("data").notNull(),
  uploadedBy: uuid("uploaded_by").notNull().references(() => users.id),
  createdAt: createdAt(),
});

export const refundCases = pgTable("refund_cases", {
  id: uuid("id").primaryKey().defaultRandom(),
  ref: text("ref").notNull().unique(),
  orderId: uuid("order_id").notNull().references(() => orders.id),
  openedBy: uuid("opened_by").notNull().references(() => users.id),
  reason: text("reason").notNull(),
  status: text("status", { enum: ["OPEN", "UNDER_REVIEW", "CLOSED"] }).notNull().default("OPEN"),
  outcomeNote: text("outcome_note"),
  createdAt: createdAt(),
  closedAt: ts("closed_at"),
});

export const dataRequests = pgTable("data_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  kind: text("kind", { enum: ["CORRECTION", "DELETION"] }).notNull(),
  subjectType: text("subject_type", { enum: ["USER", "CUSTOMER"] }).notNull(),
  subjectId: uuid("subject_id").notNull(),
  details: text("details").notNull(),
  status: text("status", { enum: ["OPEN", "DONE", "DECLINED"] }).notNull().default("OPEN"),
  handledBy: uuid("handled_by").references(() => users.id),
  createdBy: uuid("created_by").notNull().references(() => users.id),
  createdAt: createdAt(),
  closedAt: ts("closed_at"),
});

export const offlineNotes = pgTable(
  "offline_notes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id),
    clientId: uuid("client_id").notNull(),
    category: text("category", { enum: ["GENERAL", "STOCK", "CUSTOMER_VISIT", "PROBLEM"] }).notNull(),
    body: text("body").notNull(),
    writtenAt: ts("written_at").notNull(),
    syncedAt: createdAt(),
  },
  (t) => [uniqueIndex("offline_notes_client_uq").on(t.userId, t.clientId)],
);

// ---------- ledger ----------
export const ledgerEvents = pgTable(
  "ledger_events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    type: ledgerEventTypeEnum("type").notNull(),
    /** orderRef or batch code — the public-facing subject. */
    subjectRef: text("subject_ref").notNull(),
    orderId: uuid("order_id"),
    batchId: uuid("batch_id"),
    canonical: text("canonical").notNull(),
    salt: text("salt").notNull(),
    leafHash: text("leaf_hash").notNull().unique(),
    eventDate: date("event_date", { mode: "string" }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("ledger_events_order_idx").on(t.orderId), index("ledger_events_batch_idx").on(t.batchId), index("ledger_events_created_idx").on(t.createdAt)],
);

export const contractDeployments = pgTable("contract_deployments", {
  id: uuid("id").primaryKey().defaultRandom(),
  chainId: integer("chain_id").notNull(),
  network: text("network").notNull(),
  contractAddress: text("contract_address").notNull(),
  deployTxHash: text("deploy_tx_hash"),
  active: boolean("active").notNull().default(true),
  notes: text("notes"),
  deployedAt: createdAt(),
});

export const ledgerAnchors = pgTable("ledger_anchors", {
  id: uuid("id").primaryKey().defaultRandom(),
  root: text("root").notNull(),
  fromEventId: bigint("from_event_id", { mode: "number" }).notNull(),
  toEventId: bigint("to_event_id", { mode: "number" }).notNull(),
  eventCount: integer("event_count").notNull(),
  status: anchorStatusEnum("status").notNull().default("BUILT"),
  contractDeploymentId: uuid("contract_deployment_id").references(() => contractDeployments.id),
  chainId: integer("chain_id"),
  txHash: text("tx_hash"),
  error: text("error"),
  submittedAt: ts("submitted_at"),
  confirmedAt: ts("confirmed_at"),
  createdAt: createdAt(),
});

export const ledgerAnchorMembers = pgTable(
  "ledger_anchor_members",
  {
    eventId: bigint("event_id", { mode: "number" }).primaryKey().references(() => ledgerEvents.id),
    anchorId: uuid("anchor_id").notNull().references(() => ledgerAnchors.id),
    leafIndex: integer("leaf_index").notNull(),
  },
  (t) => [index("anchor_members_anchor_idx").on(t.anchorId)],
);

// ---------- reconciliation & statements ----------
export const reconciliationRuns = pgTable("reconciliation_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  runDate: date("run_date", { mode: "string" }).notNull(),
  checked: integer("checked").notNull(),
  matched: integer("matched").notNull(),
  mismatched: integer("mismatched").notNull(),
  createdAt: createdAt(),
});

export const reconciliationFlags = pgTable(
  "reconciliation_flags",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runId: uuid("run_id").references(() => reconciliationRuns.id),
    orderId: uuid("order_id").references(() => orders.id),
    batchId: uuid("batch_id").references(() => batches.id),
    kind: text("kind").notNull(),
    details: jsonb("details").notNull(),
    resolvedAt: ts("resolved_at"),
    resolvedBy: uuid("resolved_by").references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [
    index("recon_flags_order_idx").on(t.orderId),
    uniqueIndex("recon_flags_open_uq").on(t.orderId, t.kind).where(sql`${t.resolvedAt} IS NULL`),
  ],
);

export const providerStatementImports = pgTable("provider_statement_imports", {
  id: uuid("id").primaryKey().defaultRandom(),
  provider: text("provider").notNull(),
  filename: text("filename").notNull(),
  sha256: text("sha256").notNull(),
  rowCount: integer("row_count").notNull(),
  coversFrom: date("covers_from", { mode: "string" }),
  coversTo: date("covers_to", { mode: "string" }),
  uploadedBy: uuid("uploaded_by").notNull().references(() => users.id),
  createdAt: createdAt(),
});

export const providerStatementRows = pgTable("provider_statement_rows", {
  id: uuid("id").primaryKey().defaultRandom(),
  importId: uuid("import_id").notNull().references(() => providerStatementImports.id),
  providerTxRef: text("provider_tx_ref").notNull(),
  amountTzs: integer("amount_tzs").notNull(),
  payeeAccount: text("payee_account"),
  occurredOn: date("occurred_on", { mode: "string" }),
});

// ---------- logs ----------
export const adminActionLog = pgTable(
  "admin_action_log",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    adminId: uuid("admin_id"),
    action: text("action").notNull(),
    targetType: text("target_type"),
    targetId: text("target_id"),
    details: jsonb("details").notNull().default({}),
    highlighted: boolean("highlighted").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [index("admin_action_log_created_idx").on(t.createdAt), index("admin_action_log_admin_action_idx").on(t.adminId, t.action, t.createdAt)],
);

export const securityEventLog = pgTable(
  "security_event_log",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    type: text("type").notNull(),
    severity: text("severity", { enum: ["INFO", "WARN", "ALERT"] }).notNull(),
    userId: uuid("user_id"),
    subjectIndex: text("subject_index"),
    ipHash: text("ip_hash"),
    details: jsonb("details").notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [index("security_events_type_idx").on(t.type, t.createdAt), index("security_events_created_idx").on(t.createdAt)],
);

export const aiInteractionLog = pgTable("ai_interaction_log", {
  id: uuid("id").primaryKey().defaultRandom(),
  feature: text("feature").notNull(),
  promptVersion: text("prompt_version").notNull(),
  model: text("model").notNull(),
  userId: uuid("user_id"),
  scrubbedInput: text("scrubbed_input").notNull(),
  output: text("output").notNull(),
  inputTokens: integer("input_tokens"),
  outputTokens: integer("output_tokens"),
  costMicroUsd: integer("cost_micro_usd"),
  accepted: boolean("accepted"),
  decidedAt: ts("decided_at"),
  createdAt: createdAt(),
});

// ---------- plumbing ----------
export const idempotencyKeys = pgTable("idempotency_keys", {
  key: text("key").primaryKey(), // `${userId}:${clientKey}`
  userId: uuid("user_id"),
  action: text("action").notNull(),
  response: jsonb("response"),
  createdAt: createdAt(),
});

export const rateLimits = pgTable("rate_limits", {
  key: text("key").primaryKey(),
  windowStart: ts("window_start").notNull(),
  count: integer("count").notNull(),
});

export const jobHeartbeats = pgTable("job_heartbeats", {
  name: text("name").primaryKey(),
  lastRunAt: ts("last_run_at").notNull(),
  lastStatus: text("last_status").notNull(),
  details: jsonb("details").notNull().default({}),
});

export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedBy: uuid("updated_by"),
  updatedAt: updatedAt(),
});

export const smsOutbox = pgTable("sms_outbox", {
  id: uuid("id").primaryKey().defaultRandom(),
  toIndex: text("to_index").notNull(),
  toEnc: text("to_enc").notNull(),
  purpose: text("purpose").notNull(),
  body: text("body").notNull(),
  createdAt: createdAt(),
});

export const educationContent = pgTable("education_content_approvals", {
  id: uuid("id").primaryKey().defaultRandom(),
  packSha256: text("pack_sha256").notNull(),
  approvedBy: uuid("approved_by").notNull().references(() => users.id),
  approvedAt: createdAt(),
});
