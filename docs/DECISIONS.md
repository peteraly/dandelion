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
- **Status.** open question — needs credentials/dashboard access (stop condition reported).

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
