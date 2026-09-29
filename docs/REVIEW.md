# Review

Self-review of the build against `docs/BUILD_PROMPT.md`, written at the end of the work.
Status words: **done** (implemented and tested), **partial** (implemented, gaps named), **not done**.

## Invariants (§3) and how each is tested

| # | Invariant | Where enforced | Automated test |
| --- | --- | --- | --- |
| 1 | Payment confirmation is server-only and verified | `lib/domain/payments.ts` (only `SYSTEM_VERIFIER`, all guards), `lib/payments/verification.ts`, DB trigger `payment_intents_guard` | `tests/unit/domain-machines.test.ts` (every refusal reason), `tests/integration/flow.test.ts` (spoofed, bad token, bad signature, wrong amount, wrong payee, duplicate, replay; direct SQL update refused), e2e pickup test |
| 2 | Three payment statuses only | `PAYMENT_STATUSES` enum → Postgres enum | unit (machine states), schema |
| 3 | No release without full payment; dual confirmation | custody + order machines (`fullyPaid`, `sender`, `receiver` guards) | unit (§3.3 tests), integration (transfer needs both), e2e |
| 4 | Locked batches stay locked | custody machine (only `RESOLVE_*` by `SYSTEM_APPROVALS` with dual-approval proof), trigger `batches_guard` | unit (every event × every actor on locked states), integration (SQL update refused; resolution unlocks), e2e |
| 5 | Prices only from the active dual-approved list | `activePriceItem`, `price_lists_guard`, `price_list_items_guard`, `orders_terms_guard` | integration (prices from list; DB refuses activation/edits), schema test |
| 6 | No credit; `DONOR_FUNDED` needs dual approval + evidence + reference + cap | `lib/services/approvals.ts` (`validateDonorRequest`, `assertDonorCap*`), `donor_fundings` table, `subTzs` never negative | integration (no evidence → rejected; over cap → rejected; approved → highlighted log), e2e |
| 7 | Integer money | `Tzs` brand, `TzsSchema` `.int().nonnegative()`, integer columns | `tests/integration/schema-invariants.test.ts` (no float/numeric columns; all money columns integer) |
| 8 | No self-signup | only `createUser` (admin policy) inserts users; no public route | integration + e2e (`/enroll/<garbage>` invalid) |
| 9 | Forbidden fields do not exist | schema | schema invariants test (regex over `information_schema.columns`) |
| 10 | Offline is for notes only | `offline_notes` table (text only), service worker caches `/notes` only | e2e offline note test |
| 11 | Access checks are server-side, one policy module | `lib/policy/index.ts`, every service calls `authorize` | `tests/unit/policy.test.ts` per role; integration (cross-role calls throw `PolicyError`) |
| 12 | Receipts server-generated, immutable | `createReceipt` at handover; `receipts` append-only trigger | integration (SQL update refused), e2e receipt + verify |
| 13 | AI has no write path | ESLint `no-restricted-imports` on `lib/ai/**`; AI returns drafts only | `tests/unit/ai-boundary.test.ts`, lint |
| 14 | Dual approval = two different admins; append-only admin log | `lib/domain/approval.ts`, `admin_action_log` trigger | unit, integration (self-approval refused + security event), e2e |
| 15 | PINs argon2id; reset needs an admin | `lib/auth/secrets.ts`; `adminReenrollUser` is the only reset path | unit (hash format), integration (OTP alone can't reset; admin re-enroll works), e2e |
| 16 | Admin second factor = passkey, TOTP fallback, never SMS | `lib/auth/webauthn.ts`, `adminVerifyTotp`; admin login has no SMS path | integration (passphrase alone gives no rights; TOTP; replay refused), e2e (TOTP path; passkey UI present) |

## Milestones

| Milestone | Status | Notes |
| --- | --- | --- |
| 1 Vertical slice | **done** | 17 Playwright tests cover the Day 8 dry run (incl. statement import); 224 Vitest tests (152 unit incl. AI evals, 59 integration on Postgres, 13 demo-profile). |
| 2 Ledger | **done (testnet not yet deployed)** | Merkle leaves/proofs, `LedgerAnchor.sol` + 9 Foundry tests, anchoring cron, `/verify/[ref]` public + receipt token, `Signer` (env/KMS stub), statement import + diff. Real-chain anchoring is proven against Anvil in `tests/integration/anchor.test.ts`; Celo testnet deployment needs a funded key and the current network id (ADR-017). |
| 3 Deploy | **not done — blocked on credentials** | `vercel.json`, crons, health check, migration runner and deploy docs are ready. `vercel link`, Neon marketplace setup, deployment protection and env vars are dashboard/CLI steps for the founders (README → Deploy; GO_LIVE.md prerequisites). |
| 4 Public website & PWA | **done** | Landing, how it works, honest ledger copy, weekly stats (<10 suppressed), safety (DRAFT), privacy (DRAFT), manifest, service worker for offline notes. Accessibility: labelled controls, 48 px targets, server-rendered pages, minimal client JS. Performance: only the `problems` i18n namespace is shipped to the client. |
| 5 AI features | **done (off by default; not e2e-tested with a live model)** | Six assistive features behind `AI_ENABLED=false` through one gateway (`lib/services/ai-gateway.ts`): problem-intake proposal, brief explanations, weekly review draft, message drafts from §18 templates, anomaly explainer, education helper limited to `content/education/pack.json`. PII scrubber, deterministic guards, versioned prompts, `ai_interaction_log`, per-user rate limit and monthly budget. 27 evals with `FakeLlm` (no network). The real `AnthropicLlm` path has been type-checked but not exercised against the API (no key in the build). |
| 6 Docs | **done** | README (setup, env, Mermaid, daily and incident runbooks), DECISIONS.md, GO_LIVE.md, this file. |

## Prompt B (living demo dataset + ecosystem view) — status

| Step | Status | Notes |
| --- | --- | --- |
| 1 Fail-closed env, one clock, override boundary, bundle check | **done** | `appEnv()` treats a production build without `VERCEL_ENV` as production (ADR-023). `lib/clock.ts` is the only clock; `lib/clock-override.ts` is importable from `scripts/` and tests only — ESLint rule, `tests/unit/clock-boundary.test.ts`, and `scripts/check-bundle.ts` (fails `npm run build` and CI if the override reaches `.next/`; negative-tested). ADR-024, ADR-025. |
| 2a Seed guards, env-sourced seed credentials, clock-consistent defaults | **done** | `buildSeed`/`requireSeedCredentials` (dev defaults only), `assertSafeTargetDatabase` + `scripts/guard-db.ts` before migrations on non-production builds, `$defaultFn(() => now())` on timestamp defaults, SQL `now()` replaced in pricing/reconciliation/verification/rate limits (ADR-026). Tests: `tests/unit/seed-identities.test.ts`, `tests/integration/seed-guards.test.ts`. Preconditions on the founders before the demo profile goes on in the preview: Deployment Protection; `SEED_ADMIN_PASSPHRASE_A/B`, `SEED_ADMIN_TOTP_A/B`, `SEED_FIELD_PIN` in the preview environment. |
| 2b Demo scenario generator, manifest, profiles | **done** | `scripts/demo/` drives every scenario through the services with a simulated clock: supply chains, restocks, customer plans with installments, every mock-provider deviation, custody locks and dual-approved resolutions, every admin approval type, people lifecycle (invite, OTP enrolment, lost phone, lockout, suspension, re-enrolment), notes, data requests, daily reconciliation, a statement import with deliberate diffs, and a last day that leaves one order in every in-flight state. `small` scale: ~110 orders, ~140 intents, ~330 ledger events in ~10 s locally. Manifest in `settings.demoManifest`. `tests/demo/demo-profile.test.ts` (own vitest project, in CI) proves zero skipped scenarios, full state coverage, every exception type ≥ 2 (except three unreachable values, below), all approval types, flags ⊆ manifest, `(TEST)` on everyone. Not yet done from §2.6: an e2e run against the demo database (planned with the ecosystem view in step 5). |
| 3 Simulator time controls | **done** | `/dev/simulator` → "Living demo": *Simulate one hour* / *one day* (`lib/demo/tick.ts`) generate new activity on the real clock through the services (`lib/demo/day.ts`, shared with the seed; the world is rebuilt from the database by `lib/demo/load.ts`) and then run the poller, reconciliation and anchoring in-process — previews have no crons — with heartbeats marked `ok (manual)`. Demo profile only, simulator on, non-production, 6 per 10 minutes, admin-logged. *Reset to the demo dataset* (`lib/demo/reset.ts`): typed `demo`, security `ALERT`, wipe, Deploy Hook (`VERCEL_DEPLOY_HOOK_URL`) → the build re-seeds. Banner + CSV header keyed on `settings.seedProfile`. ADR-028. Tests: `tests/integration/demo-controls.test.ts`, `tests/demo/demo-profile.test.ts` (tick hour, tick day, reset). The founders' decision on the demo's purpose (prompt §4) is still open; the banner wording is the prompt's default until then. |
| 3b Supplier organisation (prompt §8) | **done** | Migration `0002_supplier_organisation`: `suppliers` gains contact (encrypted), lead time, payment-terms note, notes; `supplier_products` (backfilled from price lists). `STAKEHOLDER_ACTIVATE` now means "activate/deactivate a supplier organisation" (ADR-029; ledger `STAKEHOLDER_ACTIVATED`). Policy scopes suppliers by organisation: any user of the organisation sees and acts on its pickups (`isOrderParty`, `recentOrdersFor`). `adminCreatePickup` refuses products the supplier does not offer; the pickup form offers only `(supplier, product)` pairs. Supplier home: this week's pickups, provider-confirmed money (week/month), quality feedback. `/admin/suppliers` + `/admin/suppliers/[id]` (`lib/services/suppliers.ts`; pure metrics in `lib/domain/suppliers.ts`). Demo: two suppliers per area, activation by dual approval, quality story, late batch, pickup waiting past lead time, second supplier user enrolled by SMS link, statement difference on a supplier payment. Tests: `tests/unit/suppliers.test.ts`, policy org-scope cases, `tests/integration/suppliers.test.ts`, demo assertions, e2e (supplier cards + admin page after the rider pays). |
| 3c Sale paths, organisations (prompt §8.8) | not started | Founder clarification 2026-09-29: supplier → riders → customers/villages; organisations; factory-gate sales. Founders' decisions in §8.8.6 first. |
| 4–6 Ecosystem view, docs | not started | |

## Findings from the demo generator (Prompt B step 2)

Running every scenario through the real services surfaced three things about the app itself:

1. **Fixed — a reversed payment left the order claiming money it no longer had.** A customer plan reached `FULLY_PAID`, the provider reversed the last payment, the intent went to review — but the order stayed `FULLY_PAID` (the handover was still refused by the payment-totals check, so no product moved; the plan was simply stuck and the customer's next payment had no intent to attach to). Now `PAYMENT_REVERSED` is a transition: a `FULLY_PAID`/`HANDOVER_PENDING` plan reopens to `PLAN_ACTIVE` with a fresh intent (a reserved unit returns to the champion's lot); a `PAID` B2B order returns to `AWAITING_PAYMENT` (and a `READY_FOR_PICKUP` batch to `RESERVED_FOR_RIDER`); a `COMPLETED` order never moves backwards — the exception and reconciliation flag are the refund case. Verifier-only, guarded by "no longer covered". Tests: `tests/unit/payment-reversal.test.ts`, `tests/integration/reversal.test.ts`. ADR-027.
2. **Three exception types are defined but never raised by any service** (`STAKEHOLDER_ACTIVATE` was on this list too until step 3b gave it its meaning): `OVERPAYMENT` (the verifier leaves the intent in review and reconciliation flags it, without an exception row), `PHONE_LOST` (the lost-phone flow locks the account and logs a security event), `RECONCILIATION_MISMATCH` (reconciliation writes flags, never exceptions). Either raise them or drop the enum values; the demo test lists them as unreachable rather than faking them.
3. **Poll jobs report `DUPLICATE` for every already-confirmed transaction of a pending order.** Harmless (dedupe works) but noisy in `verification_jobs`; the poller could skip provider transactions it has already deduped before creating a job outcome.

## Known gaps and honest limitations

- **Real payment adapters are stubs.** `VodacomMpesaProvider` and `AggregatorProvider` throw. Nothing can be verified against a real provider until G1 decides the route.
- **KMS clients are stubs.** Production refuses env keys, so a production deploy today would run with anchoring disabled and (unless `ALLOW_ENV_DATA_KEY=true`) refuse to encrypt phone numbers — by design, until G5.
- **Passkeys are not e2e-tested** (WebAuthn needs a virtual authenticator); registration/login code paths are exercised by TypeScript and manual testing only. TOTP is e2e-tested.
- **PIN pepper rotation** verifies old hashes by version but does not yet re-hash on login; re-enroll users or add a background re-hash before rotating.
- **Rate limits** live in Postgres (fixed window). Fine for pilot scale; not a DDoS defence.
- **Swahili** is machine-translated (flag enforced in CI). **Education copy** is limited to handbook checklist items and marked DRAFT.
- **AI guards are regex-based** and will produce false positives (a draft that says "no debt" is rejected; the templates were worded around this). That is the intended failure direction: a rejected draft costs a retry, a missed one costs trust. The Swahili sanity score is a word-list heuristic, not a language model.
- **AI cost accounting** uses configurable per-1K-token prices with placeholder defaults (ADR-021); the budget check is only as accurate as those numbers.
- **Live-model behaviour is untested.** Evals prove the deterministic layer (scrubbing, guards, schema checks, injection handling) with `FakeLlm`; they cannot prove what the model will say. Enable on a preview first and read `ai_interaction_log`.
- **`x-invoke-path`** is not a stable Next.js header; the language toggle now returns to the referer instead.
- **Vercel-specific behaviour** (cron auth header, `waitUntil` lifetime, static IPs) must be verified against current docs during Milestone 3.

## What I would want a reviewer to look at first

1. `lib/payments/verification.ts` — the only path that confirms money.
2. `lib/domain/*.ts` — the guards are the specification.
3. `drizzle/0001_guards.sql` — what the database refuses even if the app is wrong.
4. `lib/policy/index.ts` — who may do what.
