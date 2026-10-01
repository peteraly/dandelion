# Decisions (ADR log)

Format: context → decision → status → owner. Status is one of `accepted`, `proposed`, `open question`.
"Founders" means John (Tanzania) and the USA co-founder. Where the build prompt and the handbook
conflict, the prompt wins and the conflict is recorded here (prompt §0).

Anything marked **verify against current docs** is a fact the app does not depend on yet; it is
behind an interface with a mock and must be checked before go-live.

---

## ADR-001 — Payment routing is undecided; the app is provider-neutral (gate G1)

- **Context.** Handbook §2/§8 assumes telco webhooks confirm person-to-person payments (rider → supplier, customer → champion) and that "margins are sent via mobile money". Telco collection APIs and callbacks exist for merchant/API collections, not P2P transfers, and a platform that collects and pays out holds funds — contradicting "the platform never holds money" (handbook §1). Tanzania's M-Pesa API is Vodacom's M-Pesa Open API; the handbook's "Daraja" is Safaricom Kenya.
- **Decision.** Build a `PaymentIntent` and a `PaymentProvider` interface (`lib/payments/provider.ts`). Ship `MockProvider` (default, forced outside production) and non-functional stubs `VodacomMpesaProvider` and `AggregatorProvider`. Every seller (supplier, rider, hub, champion) has a `payeeAccount`; the app expects each seller to have a collection account the buyer pays into. The founders choose one of: (a) a merchant till per seller under API access; (b) a licensed aggregator with collection and split/disbursement; (c) a platform collection account plus disbursement, which needs a legal opinion on holding funds.
- **Status.** open question — founders. Adapter implementation and sandbox pass follow the decision.
- **Owner.** Founders (decision), engineering (adapter).

## ADR-002 — Margins are computed and displayed; there is no disbursement feature

- **Context.** Handbook §5/§8 "margin sent via mobile money" and `MarginDistributed` on-chain.
- **Decision.** Margin = sale price − purchase price, computed from the dual-approved price list and shown on the role home / order page and in the margin SMS "for your records". No money is moved by the app. A disbursement feature exists only if G1 selects route (b) or (c).
- **Status.** accepted.
- **Owner.** Engineering.

## ADR-003 — Installments: amount ≤ remaining balance; overpayment goes to review

- **Context.** Handbook §8D allows voluntary installments; it does not say what happens when a payment exceeds the balance.
- **Decision.** Customer intents use rule `UP_TO_REMAINING`; B2B intents use `EXACT_REMAINING`. Anything else becomes `PAYMENT_FAILED_OR_REVIEW` with an exception (`WRONG_AMOUNT` / `OVERPAYMENT`) and is never counted toward the price. "Request refund review" opens a `RefundCase`; no money moves. The payee for customer payments (champion till vs. platform), small-payment fees, and the refund mechanism depend on ADR-001.
- **Status.** accepted (matching rule); open question (payee, fees, refunds) — founders after G1.
- **Owner.** Engineering / founders.

## ADR-004 — Ledger: anchored Merkle roots, not per-event public writes

- **Context.** Handbook §19 specifies two stateful contracts (`AuditTrail`, `CustodyChain`) writing every event on-chain with phone hashes, and claims on-chain enforcement of "no release without payment".
- **Decision.** Depart from §19. Each event is canonical JSON (type, orderRef/batch code, integer amount, role, day-granularity date) hashed with a per-event 32-byte random salt into a Merkle tree; an hourly cron anchors the root to `LedgerAnchor` (one tiny non-upgradeable contract: `anchor`, `pause`, `unpause`, `setWriter`). Reasons: (1) privacy — per-event writes with phone hashes in a small village are re-identifiable; salted leaves and roots are not; (2) audit burden — one 90-line contract instead of two stateful ones; (3) truthfulness — with a single backend writer, on-chain "enforcement" would be theatre. Gas is paid by the platform wallet; stakeholders never pay. A `LedgerWriter`-style seam (`lib/ledger/anchor.ts`, `Signer`) allows other modes later.
- **Status.** accepted.
- **Owner.** Engineering.

## ADR-005 — What the ledger proves, stated honestly

- **Context.** Handbook copy says transactions are "guaranteed" / "publicly verifiable" on-chain.
- **Decision.** Anchoring proves a record has not changed since it was anchored. It does not prove the underlying event was true: a compromised backend could anchor false events. Correctness comes from the backend state machines and DB constraints, and from independent monthly reconciliation against the provider's merchant statement (CSV import + diff in the admin dashboard, `lib/services/statements.ts`). Public copy (`messages/*.json` → `public.ledgerHonest`, `verify.honest`) states this; the phrase "guaranteed by blockchain" is forbidden by a unit test.
- **Status.** accepted.
- **Owner.** Engineering (copy), USA co-founder (monthly reconciliation).

## ADR-006 — No SocialConnect, no user wallets; users never sign anything

- **Context.** Handbook §3.3/§6 onboard users by mapping phone numbers to Celo wallets via SocialConnect.
- **Decision.** Users have no wallets or keys. Onboarding: admin creates the user → SMS link (admin-issued token, 72 h) → phone must match the registered number → SMS OTP → 4-digit PIN. Under a minute of user steps, as the handbook promised; the mechanism changes. Only the platform's anchoring key touches the chain.
- **Status.** accepted.
- **Owner.** Engineering.

## ADR-007 — Dual approval threshold is configurable; recommend 2-of-3 with a recovery signer

- **Context.** Handbook §7/§13 says 2-of-2 (John + USA co-founder). With two admins, one lost device blocks everything.
- **Decision.** `approvalThreshold` setting (minimum 2, DB-enforced). The requester counts as one signature and can never decide on their own request (§3.14). Recommend three admin accounts (2-of-3) in the app and a 2-of-3 Safe for the contract's admin role.
- **Status.** accepted (mechanism); proposed (2-of-3) — founders.
- **Owner.** Founders.

## ADR-008 — Keys: env signer for testnet only; KMS in production; production refuses env keys

- **Context.** Handbook §7 requires the backend key in an HSM/secure enclave, "never in environment variables".
- **Decision.** `Signer` interface with `EnvKeySigner` (throws in production) and `KmsSigner` (secp256k1 in a cloud KMS; client not implemented — cloud not chosen). Phone numbers use envelope encryption with a KEK from `DATA_KEK` (dev/preview) or `KMS_DATA_KEY_ID` (production; `ALLOW_ENV_DATA_KEY=true` is a documented pre-launch escape hatch that G5 forbids). Rotation runbooks for the PIN pepper (`PIN_PEPPER_VERSION` + `PIN_PEPPER_PREVIOUS`), OTP HMAC key, blind-index key (requires re-indexing), and callback tokens are in the README.
- **Status.** accepted; **open question**: which KMS (AWS KMS and GCP KMS both offer secp256k1 signing — verify against current docs).
- **Owner.** Engineering / founders.

## ADR-009 — Telco egress IPs (gate G2)

- **Context.** Provider APIs often require whitelisted source IPs; Vercel functions use dynamic egress IPs by default.
- **Decision.** Options to verify against current docs: Vercel Static IPs (plan-dependent), a small egress proxy, or an aggregator (route b) that removes the need. Inbound callbacks are protected by a per-environment secret URL token (`CALLBACK_TOKEN_<PROVIDER>`) plus an optional CIDR allowlist (`CALLBACK_IP_ALLOWLIST_<PROVIDER>`), a 10/min per-payer rate limit, and mandatory direct status queries — so the allowlist is defence in depth, not the only control.
- **Status.** open question — verify against current Vercel and provider docs.
- **Owner.** Engineering / founders.

## ADR-010 — Copy adapted from handbook §18

- **Context.** Templates mention on-chain guarantees and margin payouts.
- **Decision.** Templates in `messages/*.json → sms.*` keep the plain tone, drop "verified on the blockchain" / "margin sent to your wallet", and say what actually happens (record link, margin "for your records"). Swahili is machine-translated and flagged `needs_native_review: true` (gate G6).
- **Status.** accepted.
- **Owner.** Engineering; native reviewer (G6).

## ADR-011 — Cross-border data (gate G3) and AI off by default

- **Context.** Vercel, Neon, the SMS gateway and the Anthropic API may process Tanzanian personal data abroad. Handbook §14 notes the USA co-founder's access must be assessed.
- **Decision.** Ship with `AI_ENABLED=false`. Minimise what leaves the DB: AI receives IDs, roles, counts and PII-scrubbed free text only. PDPC registration and a transfer impact assessment are required before go-live; the privacy notice says data may be processed outside Tanzania and is marked DRAFT for counsel.
- **Status.** accepted (defaults); open question — legal.
- **Owner.** Founders / counsel.

## ADR-012 — Data protection: envelope encryption, blind index, retention, correction/deletion

- **Decision.** Phone numbers are encrypted per value with a random DEK wrapped by the KEK; lookups use an HMAC blind index. Retention periods are settings (`retention*Days`) applied by a daily cron; the security log purge is the only permitted delete on an append-only log table (trigger-gated). Admins handle correction/deletion requests; deletion pseudonymises the subject (name → `[deleted]`, phone ciphertext/index → random tombstone) while financial rows remain consistent. Ledger leaves never contained personal data. Neon point-in-time recovery is enabled per plan (**verify**) and a monthly restore drill to a scratch branch is documented in the README.
- **Status.** accepted; verify Neon PITR retention for the team's plan.
- **Owner.** Engineering.

## ADR-013 — PIN lockout: reading of "maximum 5 attempts, 30-minute lockout after 3 failures"

- **Context.** Handbook §7 gives both numbers without saying how they combine.
- **Decision.** After 3 consecutive failures the account is temporarily locked for 30 minutes; after 5 consecutive failures it is hard-locked (`LOCKED`) and only an admin re-enrollment restores it (§3.15). A lost-phone "Lock my account" is available from any device with phone + PIN, and inside the app with the session alone.
- **Status.** accepted.

## ADR-014 — Database triggers as defence in depth, not as the enforcement layer

- **Decision.** The application enforces every invariant first (pure state machines + services). Triggers make application bugs fail loudly: append-only logs, payment status changes only under `app.verifier=on`, locked batches immutable except under `app.approvals=on`, price lists frozen once submitted, order terms immutable, no TRUNCATE of financial tables. They do not protect against a database owner who disables triggers; that is what monthly statement reconciliation and restore drills are for.
- **Status.** accepted.

## ADR-015 — Idempotency and transactional ledger writes

- **Decision.** Every mutating form carries a per-render idempotency key; keys are kept 7 days (`idempotency_keys`, purged by the retention cron). The verification job records a permanent `(provider, providerTxRef)` row before applying any effect, so a duplicate or replayed callback can never confirm twice. A state change and its `LedgerEvent` are written in the same transaction.
- **Status.** accepted.

## ADR-016 — Environment detection and forced mocks

- **Decision.** `VERCEL_ENV` decides the environment (`development` when unset). Outside production the payment provider, SMS provider and chain are forced to `mock` / `mock` / `testnet` regardless of configuration. The dev simulator returns 404 unless non-production **and** `SIMULATOR_ENABLED=true`. In production with the mock provider still selected (pre-G1), no payment can ever be confirmed because nothing can write to the mock ledger.
- **Status.** accepted.

## ADR-017 — Celo testnet identity: verify against docs.celo.org

- **Context.** Celo's testnet has changed name (Alfajores → Sepolia-based) and IDs over time.
- **Decision.** Chain id, RPC and explorer come from env (`CHAIN_ID`, `CHAIN_RPC_URL`, `CHAIN_EXPLORER_URL`) with placeholder defaults; contract deployments are recorded per chain in `contract_deployments`. Nothing anchors until a deployment is recorded and a signer configured. **Verify the current testnet against current docs before deploying** (gate G4 for mainnet).
- **Status.** open question — verify.

## ADR-018 — Reusable products only where WASH conditions are confirmed

- **Decision.** `product_area_availability` carries `available` and `washConditionsConfirmed`; a reusable product cannot start a customer plan unless both are true for the area. Changes are dual-approved (`PRODUCT_AVAILABILITY`). A `WASH_CONCERN` problem report feeds the admin brief. Education content is shown only as handbook §8E/§11 checklist items and is marked DRAFT for a health advisor (gate G6).
- **Status.** accepted.

## ADR-019 — Vercel plan, region, Neon region/encryption: to record

- **Context.** Cron frequency, static IPs and function limits depend on the Vercel plan; Neon region and at-rest encryption are per project.
- **Decision.** `vercel.json` is sized for Vercel's free (Hobby) plan: no region pin and two daily crons (reconciliation 17:00 UTC, retention 22:30 UTC). The first Git deployments (2026-09-29) were rejected by Vercel within seconds while the file declared four crons at 5-minute/hourly frequency and `regions: ["fra1"]`; the plan's cron limits are the most likely cause (verify against current Vercel docs). The payment poller and anchoring crons are documented in README → Deploy → Production and must be restored on a paid plan. Record the team's plan, the chosen regions, and Neon's at-rest encryption status here once the project is set up (dashboard steps; see docs/GO_LIVE.md and README).
- **Recorded 2026-09-29.** Vercel project `dandelion` on the free plan (team `peteraly`); production branch `main`. Neon on the free plan in Washington D.C. (`iad1`), resource `neon-charcoal-elephant`, connected through the Vercel Marketplace with env-var prefix `DATABASE`. Region choice was pragmatic for the demo; revisit (Frankfurt is closer to Tanzania) together with at-rest encryption status before launch.
- **Status.** partially recorded — plan and regions above; encryption status and the paid-plan decision (crons, static IPs) remain open.

## ADR-020 — Foundry solc download

- **Context.** In the build environment `binaries.soliditylang.org` was blocked; solc 0.8.26 was fetched from GitHub releases and pinned via `FOUNDRY_SOLC`. CI uses `foundry-rs/foundry-toolchain`, which downloads normally.
- **Decision.** `forge-std` is vendored (src only) under `contracts/lib/` so the contract tests need no network.
- **Status.** accepted.

## ADR-021 — AI: one gateway, FakeLlm evals, placeholder token prices

- **Context.** Build prompt §7 requires AI to be assistive only, off by default, with PII scrubbing, versioned prompts and evals. The build had no API key, and evals that depend on a live model are non-deterministic.
- **Decision.** All model calls go through `lib/services/ai-gateway.ts`, the only module allowed to import both `lib/ai/**` and the database; `lib/ai/**` itself may not import the database, services or payments (ESLint + unit test). Evals use `FakeLlm` and prove the deterministic layer only (scrubbing, guards, schema checks, injection stays data). The monthly budget check converts tokens to cost with `AI_PRICE_IN_MICRO_USD_PER_1K` / `AI_PRICE_OUT_MICRO_USD_PER_1K`, whose defaults (3000 / 15000) are **placeholders**; verify against current Anthropic pricing before enabling AI on a preview. Guards are deliberately blunt regexes and reject negated pressure words ("no debt") too; templates are worded around them.
- **Status.** accepted; token prices are an open question — verify.

## ADR-022 — Migrations and demo seed run at build time

- **Context.** The founders want to see the pilot on a URL without a terminal. Migrations and the demo seed were manual commands; a Vercel preview would come up empty.
- **Decision.** `npm run build` runs `scripts/predeploy.ts` first: forward-only migrations whenever a database is configured (preferring the unpooled Neon URL for DDL — variable names set by the Neon integration must be verified against current Neon docs), then the idempotent demo seed only when `SEED_ON_BUILD=true` **and** `VERCEL_ENV !== "production"`; the seed script's own `refuseIfProduction` remains as a second guard and `SEED_RESET` is never forwarded. A failed migration fails the deploy, which is the intended behaviour (rollback is a Neon point-in-time branch, never a down-migration). `SKIP_PREDEPLOY=1` builds without a database.
- **Consequence.** A demo needs a *preview* deployment: in production the simulator is 404, the mock provider cannot confirm anything and the seed refuses to run. The repository's default branch is currently the build branch, so Vercel would treat it as production until the project's Production Branch is changed (dashboard setting; verify the current location in Vercel docs).
- **Status.** accepted.

## ADR-023 — Environment detection fails closed

- **Context.** ADR-016 made `VERCEL_ENV` the only signal and treated "unset" as development, which unlocks dev-default secrets, the simulator and (from Prompt B) the clock override. An external review pointed out that a production process started without Vercel's marker would therefore run wide open.
- **Decision.** `appEnv()` returns `production` when `VERCEL_ENV=production`, **or** when `VERCEL_ENV` is unset/empty and `NODE_ENV=production` (a production build running anywhere). `preview` only when `VERCEL_ENV=preview`. Everything else is development. Dangerous controls additionally require their own positive flag (`SIMULATOR_ENABLED=true`, `SEED_PROFILE=demo`); absence of production is never sufficient on its own. `scripts/predeploy.ts` uses the same function.
- **Consequences.** Local `next build && next start` without `VERCEL_ENV` now behaves as production (secrets required) — set `VERCEL_ENV=preview` locally to test a preview-like build. CI, tests and `next dev` are unaffected (NODE_ENV is `test`/`development`).
- **Status.** accepted; amends ADR-016.

## ADR-024 — One clock, and an override the app cannot import

- **Context.** Prompt B needs backdated history generated through the real services. Services stamped time with `new Date()` in ~100 places, including OTP expiry, session idle timeout, lockouts and rate limits, so a settable clock is a security surface.
- **Decision.** `lib/clock.ts` exposes `now()`/`nowMs()` and reads an override stored under a global symbol; it has no setter. `lib/clock-override.ts` owns the setter and may be imported only from `scripts/**` and `tests/**` — enforced three ways: ESLint `no-restricted-imports` on `app/`, `lib/`, `components/`, `i18n/`, `proxy.ts`; a unit test that scans the source for the import and for the symbol string; and `scripts/check-bundle.ts`, which fails the build if any string unique to the override module appears in `.next/`. The setter also refuses at call time in production and when `NEXT_RUNTIME` is set. Dependency injection through every call site was judged unnecessary once the set path is provably absent from the bundle.
- **Status.** accepted. Any security review scoped before this change must be re-scoped (GO_LIVE G5 note).

## ADR-025 — The demo phone range is not verified as reserved

- **Context.** Fake stakeholders use `+255 700 00[0-9] [0-9]{3}`. Nothing in the build verified that this block is unallocated in Tanzania's numbering plan; it was chosen as obviously test-shaped.
- **Decision.** Keep the range, because SMS is forced to the mock provider outside production (`lib/env.ts`) and the seed refuses production, so no message can reach a real subscriber from a non-production environment. **To close:** check the block against the current TCRA national numbering plan (or ask the SMS aggregator) and either confirm it is unallocated or move the demo data to a confirmed test block; record the result here.
- **Status.** open question — verify before any non-mock SMS provider is configured anywhere.

## ADR-026 — Seed credentials from the environment; content guard; clock-consistent defaults

- **Context.** The repository is public and the seed admins' passphrases and TOTP secrets were in it; a preview deployment protected only by obscurity would have been open to anyone reading the code (Prompt B review, C4). Separately, backdated history through the real services needs every timestamp to follow the application clock, and a misconfigured preview must not be able to migrate or seed a real database (C2).
- **Decision.**
  - `scripts/seed.ts` builds its identities from `SEED_ADMIN_PASSPHRASE_A/B`, `SEED_ADMIN_TOTP_A/B` and `SEED_FIELD_PIN`; development keeps fixed defaults, any other environment gets no default and the seed refuses to create people without valid values. The repository therefore contains no credential usable on a deployed environment.
  - `assertSafeTargetDatabase()` refuses any database holding a user or customer without `(TEST)` in the name, on top of the production-host checks. `scripts/guard-db.ts` runs it before migrations on every non-production build (`scripts/predeploy.ts`). The demo profile also requires an empty database.
  - Insert-time defaults for `created_at`, `updated_at`, `last_seen_at` and `next_run_at` are computed by Drizzle from `now()` (`$defaultFn`), with the SQL `default now()` kept for raw inserts; the four SQL expressions that used the database's own `now()` (active-price date, pending-payment age, verification-job claims, rate-limit windows) now take the application time as a parameter. No migration was needed.
  - `settings.seedProfile` records which seed populated a database; the simulated-data banner keys off it.
  - On a non-production build, `scripts/predeploy.ts` skips the seed with a loud log line when the `SEED_*` variables are missing instead of failing the deployment: the site stays up (nobody to log in as yet) and the log names what to set. The seed itself still refuses, as a backstop.
- **Status.** accepted.

## ADR-027 — What a reversed payment undoes

- **Context.** The demo generator (Prompt B) reversed a confirmed final installment through the mock provider and found the plan stuck in `FULLY_PAID` while the payment totals said otherwise; the handover was correctly refused, but nothing reopened the plan and the customer's next payment had no intent to land on.
- **Decision.** A reversal undoes only what the money had unlocked and never a custody transfer that already happened. `PAYMENT_REVERSED` is a verifier-only order event guarded by "the order is no longer covered": `FULLY_PAID` or `HANDOVER_PENDING` customer plans go back to `PLAN_ACTIVE` with a fresh intent (a unit reserved for the handover returns to the champion's lot; the handover code is cancelled; the customer gets the updated plan SMS); B2B orders in `PAID` go back to `AWAITING_PAYMENT`, and a supplier batch `READY_FOR_PICKUP` back to `RESERVED_FOR_RIDER`. `COMPLETED` orders do not move: the `PAYMENT_REVERSED` exception and the `COMPLETED_WITHOUT_FULL_PAYMENT` reconciliation flag are the refund case (§4.3), handled by people.
- **Status.** accepted.

## ADR-028 — Simulated time in a live demo runs on the real clock; a reset is a wipe and a rebuild

- **Context.** A live demo needs to keep moving between clicks (Prompt B §2.5), and a spoiled demo needs a way back. The clock override that lays down backdated history is seed-only (ADR-024) and the app cannot import it; previews have no crons (ADR-019) so nothing verifies payments or reconciles unless something runs it.
- **Decision.** "Simulate one hour / one day" generates the next slice of activity **at the real time** through the same services and scenario modules as the seed (`lib/demo/day.ts`; the world is rebuilt from the database, not kept in memory), then runs the poller, reconciliation and anchoring in-process and stamps their heartbeats `ok (manual)` so the health page cannot mistake a click for a cron. It is available only when the database carries the demo profile, the simulator flag is on and the environment is not production; 6 per 10 minutes; every tick is an admin-log entry. "Reset to the demo dataset" does not try to rebuild history in the app: it logs a security `ALERT`, wipes the database and calls a Vercel Deploy Hook so the **build** re-seeds it (predeploy, ADR-022/026). The typed word `demo` is required; nothing happens without it. Every session ends with the wipe, by design.
- **Consequences.** Ticks make the dataset drift from its seed ("as of" the seed plus N ticks; the count is in `settings.demoTicks`); a reset restores it exactly. Without a Deploy Hook the page says the rebuild must be started by hand. The clock-boundary rule is unchanged: nothing in the app moves time.
- **Status.** accepted.

## ADR-029 — The supplier is an organisation; STAKEHOLDER_ACTIVATE activates it

- **Context.** The handbook's "Supplier / Factory" (§8A) was a thin record with one login. A pilot needs to know what each supplier supplies, how long it takes, who works there, what it was paid and what came back — and the founders asked for the supplier to be as visible as hubs and champions (Prompt B §8). `STAKEHOLDER_ACTIVATE` existed as an approval type with no service behind it.
- **Decision.** `suppliers` carries the organisation's reference data (lead time, an optional encrypted business contact, display-only payment terms, notes) and `supplier_products` says what it supplies; a pickup can only be assigned for an offered product. Policy scopes supplier users by **organisation**: any active user of the organisation sees and acts on its pickups (`isOrderParty` no longer requires the user named on the order), so a colleague can prepare or release a batch. `STAKEHOLDER_ACTIVATE` means "activate or deactivate a supplier organisation": payload `{ supplierId, active }`, two distinct admins, one open request per supplier, a `STAKEHOLDER_ACTIVATED` ledger event on activation, and an admin-log and security-log entry either way. Money flows to suppliers, so who is one is a two-admin decision. Money shown to or about a supplier is only what the provider confirmed.
- **Consequences.** Existing databases get `supplier_products` backfilled from their price lists by the migration. Deactivation does not cancel open pickups; admins do that case by case. Organisations that *buy* (NGOs, schools) are a different record and a later step (prompt §8.8 / step 3c).
- **Status.** accepted.

## ADR-030 — The ecosystem view is one server-rendered snapshot, refreshed only while watched

- **Context.** The founders want a live bird's-eye view (Prompt B §3) on a free-tier stack: Neon meters compute hours and suspends idle databases; Vercel functions are short-lived; the admin UI is server components without a client data layer.
- **Decision.** One typed snapshot service (`ecosystemSnapshot`) aggregates in SQL and is the page's only data path; the page is `force-dynamic` and never cached. Refresh is a client component calling `router.refresh()` every 30 s **only while the tab is visible**, 60 s after ten minutes, paused after an hour without interaction; no Server-Sent Events, no polling while hidden. The feed renders from typed label tables: `logSecurityEvent` and `logAdminAction` now take union types (`lib/domain/events.ts`), and a unit test proves every ledger event type, security event type and admin action has a label in both languages — the database's free text never reaches the page. Customers are counts per hub, stakeholders appear by display name, phones never; an integration test scans the serialised snapshot for phone numbers and customer names. Viewing is logged once per admin session per day. Indexes were added for the snapshot's hot paths (orders by kind/state and hub/state, batches by hub/state, payment intents by status/confirmed_at, the three logs by created_at) after measuring the feed and edge queries on the demo dataset.
- **Consequences.** A tab left open costs one request per 30–60 s while looked at and nothing otherwise. The p95 budget (800 ms on the `full` dataset) is enforced locally and warned about in CI. Organisation buyers and direct sale paths (prompt §8.8, step 3c) will add node and edge kinds to the same snapshot.
- **Status.** accepted.

## ADR-031 — Sales follow one allowed-paths table; anything beyond the ladder is a per-area dual approval

- **Context.** Founder clarification (prompt §8.8, 2026-09-29): the supplier sells mainly to riders, who deliver to hubs or straight to customers and villages; NGOs, non-profits, schools and community groups buy in bulk; anyone near the factory may buy there. The handbook's ladder was hard-coded in four order kinds and one custody chain, and the policy module named roles rather than parties.
- **Decision.** One table (`ALLOWED_SALES`, `lib/domain/sales.ts`) lists every (seller, buyer) pair the system accepts, the order kind it becomes and its shape — an installment plan for customers, an exact-payment sale for stakeholders and organisations. Ladder rows are always allowed; every other row is switched on per service area by an `AREA_SALES_CHANGE` dual approval (`service_areas.allowed_sales`, default none). New order kinds: `RIDER_TO_CUSTOMER`, `SUPPLIER_TO_CUSTOMER`, `SUPPLIER_TO_HUB`, `SUPPLIER_TO_CHAMPION`, `SUPPLIER_TO_ORG`, `HUB_TO_ORG`, `RIDER_TO_ORG`. New custody states: `WITH_RIDER` (a pickup with no hub behind it is the rider's own stock) and `DELIVERED_TO_ORG` (terminal, no custodian). An order has exactly one buyer column (`order_has_buyer`). Organisations are records like suppliers (`organisations`; ADR-029's activation approval reused); they pay the organisation price of the area's price list, in full, before delivery, and get details, confirmation and receipt by SMS. A supplier that sells directly registers the batch at the sale. Earnings on the field home are provider-confirmed receipts minus payments to own sellers, week and month. Policy decides who is party to an order through `saleFor(kind)`. A deletion request is refused while the subject has open orders (`subject_has_open_orders`): the tombstoned phone would break codes and receipts still owed.
- **Consequences.** Real areas stay ladder-only until the founders record §8.8.6 — which paths the first real area allows, what an organisation pays (today: the price list's organisation column; the demo sets it to the champion price), and whether a rider who sells directly keeps the whole customer margin (default yes; it is what the money flow does). The demo enables every path so the ecosystem view shows them. Adding a path later is one row in the table plus a machine choice, not a new flow. Found while testing: the generator's simulated clock drifted into the future on busy days; waits are now clamped to the day (`World.dayEnd`), and the demo test asserts no timestamp is in the future.
- **Status.** accepted; §8.8.6 decisions open (GO_LIVE item 9).

## ADR-032 — The bird's-eye view is a schematic district map computed by a pure function

- **Context.** Founder direction (prompt §9, 2026-09-29): "a clean simple SimCity visual — simple is better, data rich". The column graph of step 5 showed flows but not the district; a real map is out of the question (no coordinates are collected, Permissions-Policy denies geolocation, §3.5 privacy).
- **Decision.** `layoutDistrict` (`lib/ecosystem/district.ts`) turns the ecosystem snapshot into tiles, bands, edges and markers with no I/O and no React: one band per service area, left to right the factory, the riders' stand, the hubs as depots on one road with their champions' kiosks and their customers' block underneath, and the organisations and directly served customers on the right; edges only between tiles that exist; one motorbike marker per open order on a road leg, its position a function of the snapshot time so it creeps forward on each refresh; attention flags derived from the same data the attention strip counts. The component only draws: server-rendered inline SVG with a `<symbol>` sprite of flat pictograms, two neutrals plus the four payment-state accents already in use, every number printed inside its tile, icon and text for every state, a padlock for locked lots, a dashed outline plus triangle for attention. The only motion is a CSS transition on the markers, disabled under `prefers-reduced-motion`; no canvas, no WebGL, no charting library, no client JavaScript, CSP unchanged. The table twin of step 5 stays under the map and replaces it on phones and for screen readers. On a demo dataset the map header carries the simulator's hour/day controls through the existing rate-limited, logged action, which now returns to the map when asked (a `redirectTo` limited to `/admin/ecosystem`).
- **Consequences.** The layout is unit-tested as geometry (one tile per node, no overlaps, bands in order, edges only between placed tiles, markers per open order, attention mapping) and checked on the demo dataset. Wide districts widen the SVG and scroll horizontally rather than shrinking text. Customers stay dots and counts. Adding a tile kind means one glyph in the sprite and one branch in the layout.
- **Status.** accepted.

## ADR-033 — An open demo: one click per role, only on fictional data outside production

- **Context.** The founders need to show the product to people without accounts, and sign-in (passphrase + authenticator for admins, PIN for field roles) got in the way of the demo itself (Prompt E Part 2).
- **Decision.** A public `/demo` page offers one button per role. It exists only when the environment is not production (fail-closed `appEnv`, ADR-023) **and** `DEMO_OPEN_ACCESS=true` **and** `settings.seedProfile` is `demo` or `minimal` (the database was filled by our seed: fictional people marked TEST, fake phones). Entry creates a normal session marked `via = OPEN_DEMO` (migration `0005_open_demo_sessions`); admin entries arrive with the second step complete. Open-demo sessions cannot wipe the dataset, export CSVs (403), or register passkeys, and every phone number they submit must be in the fake range (`assertOpenDemoPhone` in the customer, user, supplier and organisation services) — so no visitor can put a real person's number into the system. Each entry is rate-limited (40 per 10 minutes per address) and logged as `OPEN_DEMO_ENTRY`. Field actions now read only the field session and admin actions only the admin session (the old "whoever is signed in" lookup preferred an admin session and refused field forms in a browser holding both).
- **Consequences.** Anyone with the preview link can act inside the demo district, including dual approvals (two founder roles). The reset remains a real-admin action, so a spoiled demo is one reset away. Real areas and production are unaffected; turning the demo off is removing the variable and redeploying. Before a preview ever holds real data (it must not), the variable must be gone — GO_LIVE item 10.
- **Status.** accepted for the pre-launch demo; revisit before launch.

## ADR-034 — People-facing role names differ from role codes; the demo district runs while watched

- **Context.** Founder feedback (Prompt G, 2026-09-30): "Boss rider", "Hub manager" and "Field champion" are not intuitive; the admin is not technical; the demo should look like a district running now, with data on every page and no play button.
- **Decision.** Names people read change, codes do not: *Delivery partner* (`BOSS_RIDER`), *Hub keeper* (`HUB_MANAGER`), *Local seller* (`FIELD_CHAMPION`); Swahili *Msafirishaji*, *Mtunza kituo*, *Muuzaji wa mtaani* (pending native review). Only `messages/*.json` carry the names; the database, policy, logs and ledger keep the codes. Admin labels use plain words (Money that does not match, Stock on hold, Public record…) and every admin page opens with a one-line guide. A preview with the simulator on defaults to the `demo` profile at `full` scale; a database our seed filled with the `minimal` profile is wiped (existing guards: never production, never a database that looks real) and rebuilt as the demo district; a demo database is left alone on later builds. The seed ends with six live hours on the real clock. While an admin page of the demo dataset is open and watched, `components/live-district.tsx` asks the server for one live hour a minute (`autoTickAction` → `simulateTick(hour, auto)`): at most one step per minute across all viewers (`settings.demoLastLiveAt`), its own rate limit (12 per 10 minutes), logged; orders the live engine started (`lib/demo/live.ts`, `settings.demoLiveOrders`) move one step per hour, the history's deliberate anomalies are never advanced. No button; pauses when hidden or after an hour away.
- **Consequences.** The customer SMS says "local seller". Tests and screenshots use the new labels. The demo keeps a database awake while watched. Production and Preview still share one database (Prompt F, E1), so production shows the demo district until F0.1 separates them. Scenario circulation beyond deliveries and organisation orders, the field apps' heartbeat and a no-viewer schedule are Prompt G, G1–G4.
- **Status.** accepted; names pending the founders' confirmation (Prompt G §3.1).

## ADR-035 — Buyers pull sales; hubs are stocked ahead of demand; one product price per area

- **Context.** Founder questions (Prompt H, 2026-09-30): are deliveries made only when a buyer asks, with everything calculated downstream, as with DoorDash and Uber? Should prices vary with distance?
- **Decision.** Sales to customers, schools and organisations are made only on the buyer's request (plans, organisation orders, a local seller's restock request). Hubs are replenished ahead of demand, because the factory is days away and trips pay only for batches: `lib/domain/replenishment.ts` turns each hub's last 14 days of sales, stock on hand, stock on the way and the supplier's lead time into a reorder point and a suggested pickup (packs of 10); a person assigns it. The product price stays one per area and is fixed for a plan at its start; demand-based pricing and pricing from a person's data are refused. Distance, where it matters, is to be shown openly as a zone charge for far organisation deliveries (not built; founders' decision). The demo's guided walkthrough (`lib/demo/journey.ts`) runs one sale through every stakeholder with real service calls and shows each person's texts and app status; its orders are held from the live engine. The customer receipt text no longer names the product.
- **Consequences.** Restock numbers (window, safety days, days of cover, pack size) are founders' parameters. Zone charges, stalled-plan rules and the payment route (G1) are open (Prompt H §3).
- **Status.** accepted for the demo; parameters and zone charges pending.

## ADR-036 — Restocking reads the road, the rains and the empty shelf; trip pay waits for the founders

- **Context.** Founder red team (Prompt I, 2026-10-01): in town the roads are fine, in the countryside they are bumpy and the rains close them; the app assumed one day on the road everywhere, read an empty shelf as low demand, and paid delivery partners the same per unit for near and far hubs.
- **Decision.** Each hub records its km from the district town, the worst stretch of road and whether the rains slow it; each area its rainy months (`hubs.distance_km/road/slow_in_rains`, `service_areas.rainy_months`). Restocking's lead time is the supplier's days plus road days from that record (`lib/domain/routes.ts`), or the 80th percentile of real trips (pickup assigned → on the shelf, ≥ 3 in 90 days), whichever is slower: a fast record never shortens a careful plan. A nightly stock record (`hub_stock_days`) keeps days with an empty shelf out of the demand rate; seller requests still waiting count as owed; a locked delivery is not "on the way". Road data is planning-only, so one admin records it, logged before/after. Distance is not a location; no coordinates are stored (§3.9). The demo restocks by the suggestions.
- **Consequences.** Trip pay by road and season (I4), village routes (I5), platform collection (I6, gate G1 with a legal opinion), stock on trust (I7) and offline hand-over (I8) are next; once trip pay reads the road data, its changes move under the two-admin rule. The road-day constants (paved/gravel 1, dirt 2, far > 80 km +1, rains ×2) and the 80th percentile are founders' parameters.
- **Status.** accepted for the demo and the pilot's planning; trip pay pending decisions §3.1–3.2.

## ADR-037 — Problem first: measure before building more; a non-profit with a small operating fee

- **Context.** Founder question (Prompt J, 2026-10-01): is the model sustainable in Tanzania, are incentives aligned, and is the build solving a real problem rather than looking for one?
- **Decision.** Work backward from the outcome (`docs/PROMPT_J_PROBLEM_FIRST_STAKEHOLDERS.md` §1.2–1.4); every feature must serve a named condition, and features without one are parked (the public-chain anchor: no further investment until a funder asks). Impact is reported as girl-months covered, not packs distributed. Founders' decisions (2026-10-01, Prompt J Part 3): Dandelion is a **non-profit** that collects a **small operating fee** (mechanics proposed in Prompt J §4.1, not built); **no vouchers**; local sellers earn the same wholesale-to-retail margin on reusables as on anything else; the catalogue is eco-friendly pads, normal pads and reusable menstrual cups; a direct-to-consumer marketplace with pharmacies and women-owned businesses as verified bulk buyers; education and training partnerships run alongside the marketplace.
- **Consequences.** Open: the fee's amount and payer, the feature freeze, the thresholds (proposed in Prompt J §4.2), whether eco-friendly pads are washable or biodegradable, the two named safeguarding leads, and a second admin for every local seller. Attendance is not used as the headline claim (Known: trials in Nepal and Kenya); dignity, health, comfort, cost and reliability are.
- **Status.** accepted (founders, 2026-10-01); open items above.

## ADR-038 — Safeguarding: customers belong to local sellers alone; business buyers with a confirmed women-owned status

- **Context.** Founders (2026-10-01, Prompt J §3.5): riders must not sell directly to customers wherever girls under 18 are served; hand-overs to girls go through women sellers or schools. The app deliberately stores no ages (§3.9), so it cannot tell where girls are served.
- **Decision.** The rule applies everywhere. `CLOSED_KINDS` (`RIDER_TO_CUSTOMER`, `SUPPLIER_TO_CUSTOMER`) are refused by `saleAllowed` whatever an area's switches or record say, and are not offered as switches; `customer.create`, `customer.view` and `order.start_plan` are for local sellers only, and the field customer pages answer "not found" to anyone else. Orders of the closed kinds made before the rule can finish. Riders sell their own stock to organisations (`RIDER_TO_ORG`). Organisations gain the types `PHARMACY` and `BUSINESS` and a `women_owned` status (migration `0007_business_buyers`), named in the activation request the second admin approves and locked while the organisation is active.
- **Consequences.** The demo has no village drops or factory-gate customers; its unconfirmed-handover anomaly is now a local seller's. Open: two named safeguarding leads and the confidential reporting channel (Prompt J J2, with Prompt C §5.3); a second admin confirming every local seller (recommended).
- **Status.** **superseded in part** (founders, 2026-10-01, later the same day): the safeguarding line had been quoted back from Prompt J's questions, not decided. Customers buy from delivery partners (ADR-039); `RIDER_TO_CUSTOMER` and `SUPPLIER_TO_CUSTOMER` are switchable again and riders and suppliers may hold customers. The business buyers (pharmacy, business, women-owned) stand.

## ADR-039 — Dandelion collects every payment; members withdraw; two admins send

- **Context.** Founders (2026-10-01, Prompt L): suppliers (manufacturers, NGOs, organisations) sell to Dandelion or to delivery partners, who sell to customers; ideally no operating fee, perhaps 50 TZS per sale from supplier to delivery partner and from delivery partner to customer, kept to fund the operation; only admins move money; delivery partners and suppliers watch their money and choose when to withdraw.
- **Decision.** Setting `paymentRoute` (default `PLATFORM`): every payment intent's payee is Dandelion's collection account (`platformPayeeAccount`; production refuses payments until two admins set it) and is flagged `collected_by_platform`, credited to the seller (`payee_user_id`). Balances are computed, never stored (`lib/domain/wallet.ts`): on hold until the order completes, then available, minus the order's fixed fee (`platformFeeTzs`, 50 TZS, only on `SUPPLIER_TO_RIDER` and `RIDER_TO_CUSTOMER`, never more than the order) and minus withdrawals waiting or sent. Members request withdrawals (minimum, one at a time, to their registered payout number); one admin approves, a different admin records the provider reference of the money they sent; the member is texted; `PAYOUT_SENT` goes to the ledger. Database guards keep fees, collection flags and withdrawal terms immutable, states forward-only, approver ≠ sender. `DIRECT` remains available through two admins.
- **Consequences.** Payment instructions name Dandelion's account. Reconciliation should compare the provider statement for the collection account with collected − paid out. Payouts are recorded, not executed through an API (the admin sends with the provider's tools). The route needs the G1 legal opinion before real money.
- **Status.** accepted (founders, 2026-10-01); legal opinion pending.

## ADR-040 — A shop customers join themselves; women local sellers and delivery partners take the orders

- **Context.** Founders (2026-10-01, Prompt L): customers join "like DoorDash or Uber" to buy from delivery drivers; earlier the same day, hand-overs to girls through women sellers; "4 ok" (safeguarding leads, a second admin for local sellers). Then: make the marketplace's incentives work like the best marketplaces.
- **Decision.** Customers self-register (`customers.self_registered`, `champion_id` null) with phone + SMS code (`CUSTOMER_LOGIN`), enumeration-safe; shop sessions are separate from staff sessions and never an Actor. Orders are `customer_requests` to admin-named public `meeting_points` (optional usual time). Women local sellers (ladder, always) and delivery partners (where the area allows `RIDER_TO_CUSTOMER`) in the area who hold the product accept; acceptance creates the plan through `createPlanInTx`. A customer may restrict an order to women local sellers (`women_only`, part of the guarded terms). Sellers holding the product are texted (`shopAlertSellers`). Customers report problems privately (`SAFETY_CONCERN` and others), first on the admin home. Requests lapse after 48 h; the database never deletes them and lets them leave OPEN once.
- **Consequences.** Liquidity, unmet demand and repeat use are measured per area (`/admin/shop`); `/impact` shows district totals with small numbers hidden. A shop sale costs about 11–14 SMS parts against a 50 TZS fee: the fee does not cover running costs at pilot volume (Prompt L §1.4, decision §3.1). Not adopted from the founders' review: vouchers (decided against), surge pricing, algorithmic pay floors, automatic payouts by smart contract (breaks "only admins move money", needs G1, the sample leaked phone numbers on chain), per-box tokens and zero-knowledge vouchers (the anchored ledger already proves history without personal data), offline code checks on the seller's phone (brute-forceable).
- **Status.** accepted (founders' direction, 2026-10-01); safeguarding leads to be named.

## ADR-041 — Fee per pack, fewer texts, monthly reminders, safeguarding leads texted

- **Context.** Founders (2026-10-01) accepted Prompt L Part 3: the fee per pack on supplier → delivery partner sales, two customer texts cut, no handling fees or cross-subsidy yet, a hard-to-reach bonus later, monthly reminders, safeguarding leads and helplines.
- **Decision.** `platformFeeFor` charges `platformFeeTzs` per pack when `platformFeeBasis = PACK` (default; `ORDER` restores once per order), never more than the order; the fee is still fixed on each order when it is made. A shop order's acceptance sends one SMS (`sms.shopPlan`: who, where, price, how to pay, no-debt terms); `sms.customerPaid` fits one part. `sendRestockReminders` runs with the nightly reconciliation: latest REMINDERS consent granted, last completed order ≥ 25 days ago, nothing open, once per pack and not within 30 days (`customers.last_reminder_at`, marked before sending); the customer toggles reminders in the shop (a new consent record each time). `safeguardingLeadPhones` (≤ 2 Tanzanian numbers, normalised by the approval) are texted on every `SAFETY_CONCERN` from the shop with the report reference, area, meeting point, the customer's first name and phone; `helplineText` shows on `/safety` and in the shop. Settings now carry plain names and hints; technical keys are folded away; a setting's value is parsed by its own type.
- **Consequences.** Dandelion's income per pack roughly doubles; suppliers carry 50 TZS per pack (≈ 1.7 % of a 3,000 TZS wholesale price). SMS per shop sale falls by about 3 parts. The leads receive a customer's phone number by SMS, within the purpose she reported for. The bonus and any money paid to non-members wait for data and the G1 legal opinion.
- **Status.** accepted (founders, 2026-10-01); leads and helplines to be set by two admins.

## ADR-042 — The admin list counts each issue once, and closing a problem closes its payment

- **Context.** Founders (2026-10-01, Prompt M): the admin home showed 9 payments to check, 14 problems, 10 money mismatches and 3 deliveries; build so that such items do not pile up, with people for edge cases. Measured on a full demo district: 8 of 9 payments to check belonged to problems already closed; all 9 open money-mismatch flags were the same payments; deliveries listed were normal traffic, while two held deliveries had waited weeks after their problem was closed.
- **Decision.** A payment in review stays in review for the record but carries `review_closed_at`, set when the last problem about it is closed by two admins (set once, only while in review — database guard; earlier ones backfilled). The lists have one definition each: money problems (`PAYMENT_PROBLEM_TYPES`, status OPEN) are "payments to check"; other OPEN problems are "problems reported"; a problem awaiting a second admin's signature counts only under approvals; reconciliation no longer flags payments in review; only stuck deliveries are listed (3 days on the road, 1 day at inspection). When two admins let a held delivery continue, the hub keepers are texted. The live map, the brief and the admin home share the definitions.
- **Consequences.** Demo district: 34 items → 11. The next steps (Prompt M Part 2: payment claims that heal, field settlements, owners and due times, a demo that tidies up, abuse caps) aim at about 5 items that need a person by design.
- **Status.** accepted (founders' direction, 2026-10-01).

## ADR-043 — Prevent, then clear by itself: packing and rain checks, lapsing claims, SMS cap, a demo that tidies up

- **Context.** Founders (2026-10-01): nothing done by hand if possible, everything in the tool with no improvising, everyone in the system; items should not be damaged in the first place; payments should settle instantly with no ambiguity; settlement limit 100,000 TZS; shop code SMS capped at 100 an hour with an alarm at 50.
- **Decision.** A batch cannot be marked ready unless the maker confirms sealed waterproof packing (`batches.packed_waterproof_at`); in an area's rainy months a pickup cannot be accepted without a rain cover (`orders.rain_cover_at`). A payment claim with no money after `paymentClaimLapseHours` (24) lapses by itself with one SMS, before the nightly reconciliation; the request stays open so late money still confirms. Shop sign-in codes are capped per hour across the district (`shopCodeSmsPerHour` 100) with one `SHOP_CODE_SURGE` alarm per hour at `shopCodeSmsAlarm` (50); the cap counts every request, revealing nothing about who joined. Unconfirmed shop numbers are erased after 7 days by the retention job. In the demo, simulated admins close ordinary problems after a day (never safety, theft, reversals, unwell customers) and stuck inspections are finished by the live engine.
- **Consequences.** A fresh full demo district opens with 7 items on the four lists instead of 34. Instant payments in and out (payment requests confirmed with a PIN; payout API) and automatic reassignment of late shop orders are designed (Prompt M §3.1–3.2) and wait for the provider contract, G1, and the founders' agreement that a customer's payment may follow her order to a new seller.
- **Status.** accepted (founders, 2026-10-01).

## ADR-044 — A late shop order passes to the next seller, and her payment follows it

- **Context.** Founders (2026-10-01): the goal is for the customer to receive her pack as soon as possible; nothing done by hand; payments without ambiguity. When asked whether her payment may move to the new seller's order inside Dandelion's account without an admin, they answered "Ok".
- **Decision.** A shop order paid in full must be handed over within `shopHandoverHours` (24; two admins; 0 = off). Half-way the seller gets one SMS. At the deadline the system cancels his order (`REASSIGN`, actor SYSTEM; a pack set aside returns to his stock) and reopens hers to the other sellers in her area, excluding him (`customer_requests.excluded_seller_id`, `carried_tzs`, `carried_from_order_id`, all immutable). When the next seller accepts, the money she paid into Dandelion's account moves to the new order as one permanent `order_transfers` row (database guard: no update, delete or truncate) and an `ORDER_REASSIGNED` ledger entry; the new plan starts fully paid with no payment request. Paid totals, balances and reconciliation all count transfers; a cancelled order's money never counts in a seller's balance. Sellers are ranked by how few orders passed on from them in 90 days, then stock. A reopened order nobody takes in 48 h lapses and the refund is opened for the admins automatically (money out stays with admins); likewise when she cancels. Only platform-held money follows; money paid straight to a seller opens a recovery case.
- **Consequences.** No admin step between a late seller and a customer receiving her pack. The late seller earns nothing from the order and is asked later in future; the seller who delivers is credited as for any sale. Refunds remain an admin action, by rule (two admins), for the rare order no seller can take. Real money still waits on G1.
- **Status.** accepted (founders, 2026-10-01).
