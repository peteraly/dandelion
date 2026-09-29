# Dandelion — Build Prompt (final v3)

Save this as `docs/BUILD_PROMPT.md` and the handbook as `docs/handbook-v3.1.pdf` in a local clone of https://github.com/peteraly/dandelion.
Then tell Claude Code: "Read docs/BUILD_PROMPT.md and docs/handbook-v3.1.pdf, then follow the prompt."

## 0. Your role and how to work

You are building a pilot app for a menstrual-health product supply chain in Tanzania, specified in `docs/handbook-v3.1.pdf` (v3.1). Read the whole handbook before writing code.

**Precedence.** Follow this prompt first, then the handbook. Where they conflict, follow this prompt and log the conflict in `docs/DECISIONS.md`. That file uses ADR style: context, decision, status, owner. The handbook remains the source for roles, workflows, statuses, and operating rules.

**Build vs. go-live.** This prompt separates two things:

- Building and testing runs entirely on mocks and testnet. Nothing blocks it.
- Going live with real money is gated by the decisions and sign-offs in §12. You never mark a go-live gate as passed yourself. You report its status.

**Honesty rules.**

- Do not invent facts about telco APIs, Celo, Vercel or Neon limits, or Tanzanian law. Plans and limits change. When you need one, write an open question in DECISIONS.md with "verify against current docs", and build behind an interface with a mock.
- Do not write health guidance. Education content comes only from the handbook (§8E, §11) and is marked `DRAFT — requires review by a qualified health advisor`.
- Swahili strings you generate are machine translations. Mark them `needs_native_review: true`.
- Seed data uses obviously fake names and numbers (for example `+255 700 000 0xx`).

**Stop conditions.** Stop and report, with exact commands or clicks, when:

- you need credentials you don't have (GitHub push, Vercel CLI, Neon, SMS, telco, KMS);
- a dashboard action is required;
- a §3 invariant can't be satisfied.

After reporting, continue with whatever isn't blocked.

**Milestones.** Work in §10 order and commit at the end of each milestone. Milestone 1, the working end-to-end slice, matters more than breadth. No AI features or public website until Milestone 1 passes its end-to-end tests.

## 1. Targets and environments

**Code.** GitHub `peteraly/dandelion`. Use feature branches and PRs if `gh` is authenticated; otherwise commit to `main` and say so.

**Hosting.** Vercel team `peteraly`. Run `vercel link --scope peteraly` and use the Git integration: PRs get previews, `main` goes to production.

- Confirm the team's plan early and record it. Cron frequency, static IPs, and function limits depend on it.
- Enable Vercel Deployment Protection on previews.

**Database.** Neon Postgres via the Vercel Marketplace (a dashboard step; stop and ask).

- Use the Neon branch-per-preview integration so previews never touch production data.
- Use Neon's serverless driver (`@neondatabase/serverless`) or the pooled (`-pooler`) connection string. Never use a direct connection from functions.
- Record the region and the at-rest encryption status as "verify".

**Environment detection.** Use `VERCEL_ENV` (`production` / `preview` / `development`), not `NODE_ENV`. Vercel previews run with `NODE_ENV=production`.

On any environment other than production (`VERCEL_ENV !== 'production'`):

- the payment provider is forced to `MockProvider`;
- the SMS provider is forced to mock;
- the chain is forced to testnet.

**Region and money.** Timezone is `Africa/Dar_es_Salaam` everywhere. Money is integer TZS only.

**One Next.js app, three surfaces:**

1. the role-based operating app (mobile-first PWA);
2. the admin dashboard;
3. a small public website.

## 2. Stack

- Next.js App Router, TypeScript strict, Tailwind.
- Drizzle ORM, with Zod at every input boundary.
- next-intl with `sw` and `en` (`sw` is the default for field roles).
- Vercel AI SDK with the Anthropic provider (`AI_MODEL`, default `claude-sonnet-5-5`).
- viem for chain access and Foundry for contracts.
- Vitest and Playwright for tests.
- Error monitoring via Sentry or Vercel logs.
- Keep dependencies few; a two-person team must maintain this.

**Security baseline:**

- Strict CSP with nonces, `frame-ancestors 'none'`, `X-Content-Type-Options: nosniff`, and `Referrer-Policy: same-origin`.
- A `Permissions-Policy` that denies camera and geolocation. Microphone is allowed only on the problem-report screen.
- A test asserts the headers.
- No permissive CORS anywhere. Payment callbacks are server-to-server and need no CORS.
- Server Actions keep Next.js's built-in origin checks.
- `npm audit` runs in CI, failing on high or critical severity. Dependabot is enabled.

**Migrations:**

- Drizzle migrations are forward-only and follow expand/contract (add first, backfill, remove later).
- They run in the deploy pipeline against the target Neon branch.
- Rollback means restoring a Neon point-in-time branch. Document the procedure.

## 3. Non-negotiable invariants (each has an automated test)

1. **Payment confirmation is server-only and verified.** Only the verification job can set `PAYMENT_CONFIRMED`, and only after all of the following:
   - a callback received on a per-environment secret-token URL, or found by the poller;
   - a mandatory direct status query to the provider;
   - a permanent unique-constraint dedupe on the provider transaction reference;
   - a match of amount and payee against the `PaymentIntent`.

   Signature checks apply where the provider supports them. Nothing else can confirm a payment: no client action, screenshot, SMS, typed code, admin button, or AI output.
2. **Three payment statuses only.** A payment is `PAYMENT_PENDING`, `PAYMENT_CONFIRMED`, or `PAYMENT_FAILED_OR_REVIEW`. "Awaiting payment" is an order state, not a payment status.
3. **No release without full payment.** There is no custody transfer or customer handover without confirmed payment of the full amount. Transfers need confirmation from both sender and receiver.
4. **Locked batches stay locked.** A batch in `INSPECTION_ISSUE` or `DAMAGED_OR_QUARANTINED` does not move until an exception is resolved by dual approval.
5. **Prices come only from the active dual-approved price list.** There is no free-text price field.
6. **No credit.**
   - No negative balances, auto-debit, late fees, or credit.
   - The single exception is `DONOR_FUNDED`, which requires all of the following:
     - dual approval;
     - an attached evidence file;
     - a reference to the donor, amount, and order;
     - a configurable monthly cap.
   - Donor-funded approvals are highlighted in the admin log. A test covers rejection without evidence and rejection over the cap.
7. **Integer money.** Use a `Tzs` branded type, integer columns, and Zod `.int().nonnegative()`. A test asserts that no float or numeric money column exists.
8. **No self-signup.** Only admins create users.
9. **Forbidden fields do not exist.** The schema has no columns for menstrual-cycle, diagnosis, pregnancy, sexual-history, or precise location. A test asserts this.
10. **Offline is for notes only.** Offline mode stores non-financial notes only.
11. **Access checks are server-side.** Role-scoped access is enforced in one policy module, with tests per role.
12. **Receipts are server-generated and cannot be edited.**
13. **AI has no write path.**
    - `lib/ai/**` cannot import DB write functions; an ESLint boundary enforces this.
    - AI output is a draft. A human confirms it, and deterministic code acts on it.
14. **Dual approval is two different admins.** A requester can never approve their own request. Admin actions go to an append-only log.
15. **PINs and resets.**
    - PINs are hashed with argon2id, never encrypted or stored in plain text.
    - A PIN reset or re-enrollment of a field user requires an admin action. An SMS OTP alone can never reset a PIN. This defends against SIM swap.
16. **Admin second factor.** Admin login requires a passkey (WebAuthn), with TOTP as the fallback. SMS is never an admin factor.

## 4. Review corrections to the handbook (each logged in DECISIONS.md)

1. **Payment routing is the #1 go-live decision (gate G1).** Telco callbacks exist for merchant/API collections, not person-to-person transfers. "Margins sent via mobile money" implies the platform collects and pays out, which contradicts "the platform never holds money".
   - The founders choose one of three routes:
     - (a) each seller gets a merchant till under API access;
     - (b) a licensed aggregator with collection and split/disbursement;
     - (c) a platform collection account plus disbursement, which requires a legal opinion on holding funds.
   - Build a provider-neutral `PaymentIntent { id, orderRef, payer, payee, amountTzs, purpose, provider, status }` and a `PaymentProvider` interface.
   - Ship `MockProvider` (the default) and stubs for `VodacomMpesaProvider` and a generic `AggregatorProvider`.
   - Note: Tanzania's M-Pesa API is Vodacom's M-Pesa Open API; the handbook's "Daraja" is Safaricom Kenya.
2. **Margins** are computed (sale price − purchase price) and displayed. There is no disbursement feature unless gate G1 selects route (b) or (c).
3. **Installments.**
   - The app records confirmed installments against an order.
   - Amount matching for installments is: amount ≤ remaining balance. Anything more goes to `PAYMENT_FAILED_OR_REVIEW`.
   - Payee, small-payment fees, and the refund mechanism are open.
   - "Request refund review" opens a case and moves no money.
4. **Ledger: anchored Merkle roots, not per-event public writes.** This deliberately departs from handbook §19, for three reasons:
   - privacy: small-village re-identification;
   - audit burden: one tiny contract instead of two stateful ones;
   - truthfulness: a single backend writer means on-chain "enforcement" would be theatre.

   How it works:
   - Each event is canonical JSON (event type, orderRef/batchId, amount, role, a day-granularity date), hashed with a per-event random salt into a Merkle tree.
   - A cron job anchors the root to `LedgerAnchor` on Celo.
   - The platform's Celo wallet pays gas from the platform budget; stakeholders never pay.
   - A low-balance alert fires on that wallet.
   - Keep a `LedgerWriter` interface for other modes later.
5. **What the ledger proves, stated honestly.** Anchoring proves a record hasn't changed since it was anchored. It does not prove the underlying event was true: a compromised backend could anchor false events.
   - Correctness comes from the backend state machine and DB constraints.
   - It also comes from independent reconciliation against provider statements: at least monthly, the USA co-founder compares confirmed payments against the telco or aggregator merchant statement. The dashboard supports this with a statement CSV import and a diff view.
   - Log this as a decision. Public copy must match it (§6).
6. **No SocialConnect, no user wallets.** Users never sign anything.
   - Onboarding: an admin creates the user, the user gets an SMS link, confirms by OTP, and sets a PIN, in under a minute.
   - The handbook's one-minute claim holds; the mechanism changes.
   - SIM-swap mitigations are in §3.15–16 and §8.
7. **The dual-approval threshold is configurable.** Recommend 2-of-3 with a recovery signer, both in the app and for the Safe that administers the contract.
8. **Keys.**
   - The `Signer` interface has two implementations: a dev env key (testnet only) and a cloud KMS signer (secp256k1).
   - Production refuses to start with an env key.
   - Document rotation for the pepper, OTP, and callback-token secrets.
9. **Telco egress IPs (gate G2).** Outbound provider calls often need whitelisted source IPs, and Vercel functions use dynamic IPs by default.
   - Options to verify:
     - Vercel Static IPs, if the plan allows it;
     - a small egress proxy;
     - an aggregator (route b) that removes the need.
   - Inbound callbacks are checked with the secret URL token plus a configurable source-IP allowlist.
10. **Adapt the copy.** Adapt the handbook §18 templates to these corrections, keeping the plain tone. Never say "guaranteed by blockchain".
11. **Cross-border data (gate G3).**
    - Vercel, Neon, the SMS gateway, and the Anthropic API may all mean transfers of Tanzanian personal data abroad.
    - PDPC registration and a transfer impact assessment are required before going live.
    - AI ships with `AI_ENABLED=false` by default.
12. **Data protection.**
    - Phone numbers are encrypted at the application level (envelope encryption with a KMS key), with an HMAC blind index for lookups.
    - Retention periods are configurable.
    - An admin flow handles correction and deletion requests.
    - Neon point-in-time recovery is enabled, with retention per plan (verify).
    - A documented restore drill is run monthly to a scratch branch.

## 5. Domain model

**Roles.** Login roles are `SUPER_ADMIN`, `SUPPLIER`, `BOSS_RIDER`, `HUB_MANAGER`, and `FIELD_CHAMPION`. `CUSTOMER` is a record with no login.

**Entities:**

- User, ServiceArea, Hub, Supplier, Product (reusable/disposable, with WASH availability per area).
- PriceList and PriceListItem (versioned, dual-approved, with an effective date).
- Batch and CustodyEvent.
- Order: supplier→rider, rider→hub, hub→champion, champion→customer.
- PaymentIntent.
- ProviderTransaction: raw payloads, append-only, hash-chained.
- VerificationJob and Exception.
- ApprovalRequest, which carries evidence attachments.
- LedgerEvent, LedgerAnchor, and ContractDeployment (the address history).
- AdminActionLog, SecurityEventLog, AiInteractionLog.
- OfflineNote, TrainingRecord, ConsentRecord, RefundCase, ProviderStatementImport.

**State machines.** Custody states (§10) and each role's workflow (§8 A–E) are table-driven state machines in `lib/domain/`:

- pure functions with guards that encode §3;
- 100% transition coverage;
- the UI renders state but never computes it.

**Idempotency:**

- Mutating endpoints take idempotency keys, retained for 7 days.
- Provider-reference dedupe is a permanent unique constraint.
- A state change and its LedgerEvent are written in one DB transaction.

## 6. Screens

**Role home (One Screen Rule, handbook §7).** Each role's home shows:

- role, current status, and ONE large next-action button;
- a short explanation;
- the reference number and a Verify link;
- the last-updated time;
- help (numbers come from config);
- the SW/EN toggle and logout;
- a large REPORT A PROBLEM button.

**Screen rules:**

- No hex, gas, or keys on screen.
- Never more than one primary action.
- The session times out after 15 minutes idle.
- PIN lockout follows §7.
- "Lock my account" is always available.
- Tap targets are at least 48px.
- Must work on a low-end Android over 3G.
- Server components are preferred.

**Admin dashboard (§13):**

- the Today's Priorities list;
- the approvals inbox;
- stakeholders, price lists, exceptions, and inventory by custodian;
- reconciliation and the provider-statement diff;
- ledger/anchor status and wallet balance;
- the admin and security logs;
- CSV export (large exports need dual approval).

**Public website:**

- the landing page and "how it works";
- WASH/product-safety guidance, clearly marked draft;
- the privacy notice in SW/EN (§14, adapted);
- aggregate stats, weekly only, with counts under 10 shown as "fewer than 10".

**`/verify/[ref]`.** Refs are 128-bit random and URL-safe. The endpoint is rate-limited to 20 requests/min per IP.

- The public view shows only:
  - event types;
  - day-granularity dates;
  - the Merkle proof;
  - the anchor transaction link;
  - "under review" if reconciliation flagged the order.
- The receipt SMS link also carries a secret receipt token. With the token, the page also shows the amount and product (the customer's own receipt).
- Never shown: payee, roles, or anything person-linked.
- Copy on the page: "This record was made on [date] and has not been changed since. It shows what the system recorded at that time."

## 7. AI features (assistive only; behind `AI_ENABLED`; everything works with AI off)

**Data rules:**

- Send IDs, roles, and counts only. Never send customer names.
- Free text first passes a PII scrubber that removes:
  - Tanzanian phone formats (`+255`/`255`/`0` followed by `6x`/`7x`, with or without spaces or dashes);
  - names from the users table.
- The scrubbed text is wrapped as untrusted data, never as instructions.
- Every call is logged with the prompt version, the output, and whether a human accepted it.
- Rate limits and a monthly spend cap apply.

**Features, in priority order:**

1. **Problem intake.** Typed Swahili or English text ("maboksi mawili yamelowa") becomes a proposed structured Exception, which the user confirms with one tap. Voice input is optional, used only where the browser supports it, with typing as the fallback.
2. **Admin morning brief and weekly review draft (§15–16).** Deterministic queries select the items; AI orders and explains them. Each item links to its record and shows which stop-and-fix triggers fired.
3. **Message drafting** from the §18 templates in the recipient's language. A human approves every message, and a tone check enforces no pressure and no debt language.
4. **Anomaly explanations.** Deterministic rules flag the anomalies; AI explains them for admins.
5. **Champion education assistant.** It stays disabled until an admin approves `content/education/`.
   - It answers from that pack only and cites the source.
   - It refuses to diagnose; "Customer feels unwell" routes to the referral card.
   - An output guard catches medical-advice patterns.

**Where it lives.** Prompts are versioned in `lib/ai/prompts/`, and evals go in `lib/ai/evals/`. The evals cover:

- refusal to diagnose;
- refusal to "mark as paid" or change state;
- prompt injection via report text;
- no PII in outbound prompts (Swahili names like Juma, Fatuma, and Neema, plus all phone formats);
- Swahili output sanity.

## 8. Payments, verification, ledger, security events

**Callback route:** `/api/payments/callback/[provider]/[token]`. It:

1. checks the token;
2. applies the optional source-IP allowlist and a rate limit (10/min per payer);
3. persists the raw payload (append-only, hash-chained);
4. enqueues a `VerificationJob`;
5. returns 200 immediately.

**Verification job.** It is triggered via `waitUntil` and also picked up by a cron poller, so a failed `waitUntil` is retried. The job:

1. queries the provider;
2. dedupes the transaction;
3. matches amount and payee;
4. transitions the payment;
5. writes the LedgerEvent.

The same poller also queries still-pending intents, so a missed callback doesn't leave a payment stuck.

**Dev simulator:** `/dev/simulator`.

- Hard guard: it returns 404 unless `VERCEL_ENV !== 'production'` AND `SIMULATOR_ENABLED=true`. A test covers this.
- It fires success, failure, duplicate, replay, spoofed, wrong-amount, overpayment, and delayed callbacks.

**Contract `contracts/LedgerAnchor.sol` (Foundry).** It is non-upgradeable and exposes:

- `anchor(bytes32 root, uint64 fromEventId, uint64 toEventId)`, callable by the writer role only;
- `pause`/`unpause`, callable by the admin Safe.

It emits events and has full tests.

- When paused, the anchoring cron skips and events accumulate in the DB.
- Replacing the contract means a new deployment recorded in `ContractDeployment`. Old anchors stay verifiable at their original address.
- Deploy to the current Celo testnet only; check docs.celo.org for the network.
- Mainnet waits for gate G4.

**Anchor cron.** It builds the tree from unanchored events, submits the root, and records the tx hash. The UI shows "Ledger: pending" or "Ledger: recorded". Payments never wait on the chain.

**Daily reconciliation.** It matches payments to custody events to handovers and flags mismatches. Flags feed the admin brief and the "under review" status on verify.

**Security event log.** It records:

- failed PINs and lockouts;
- OTP requests, with an alert on bursts or a new device;
- callback rejections and rate-limit hits;
- admin 2FA failures;
- donor-funded approvals;
- exports.

The dashboard alerts on thresholds.

**Health check.** `/api/health` checks DB reachability, that the anchor and poller last ran within 2× their interval, and the wallet balance. Use an external uptime monitor; document the choice.

## 9. Seed data and tests

**Seed data:**

- one area, one supplier, one hub, two riders, three champions, five customers;
- the standard kit at 7,500 / 8,000 / 9,000 / 11,400 TZS (§5).

The seed script refuses to run when `VERCEL_ENV === 'production'` or the DB host matches the production branch.

**Playwright tests** cover the handbook's Day 8 dry run (§17):

- activation;
- pickup, then a pending payment, then a confirmed payment;
- hub inspection and transfer;
- champion transfer;
- installments up to full payment, then an overpayment going to review;
- handover and receipt;
- the verify page, both public and with the receipt token, with a valid proof;
- a damaged-stock lock and its dual-approved resolution;
- a donor-funded order rejected without evidence;
- an offline note;
- the lost-phone lock;
- a PIN reset that requires an admin;
- spoofed, duplicate, replay, and wrong-amount callbacks rejected;
- a self-approval rejected;
- security headers present;
- the AI-off path.

## 10. Milestones

1. **Vertical slice.**
   - Scaffold, CI (typecheck, lint, audit, unit, e2e), i18n, and security headers.
   - Schema, state machines, and the policy module.
   - Auth: OTP enrollment with mock SMS, PINs, and admin passkey/TOTP.
   - Admin user management.
   - The full supplier→customer flow with MockProvider, the verification job, and the simulator.
   - Reconciliation, dual approvals, exceptions, and donor-funded orders.
   - Must pass e2e.
2. **Ledger.** LedgerEvent, Merkle anchoring, the testnet contract, `/verify`, the Signer, and the statement-import diff.
3. **Deploy to preview and production on mocks.**
   - Vercel link, Neon with branching and pooling, env vars, crons, deployment protection, and the health check.
   - Run e2e against the preview.
   - Production runs, but with no live money until §12.
4. **Public website.** Privacy notice, PWA with offline notes, and an accessibility and performance pass.
5. **AI features** in §7 order, with evals.
6. **Docs and report.**
   - `README.md`: setup, env vars, a Mermaid architecture diagram, the daily-routine runbook (§15), and the incident runbook (pause anchoring, lock accounts, rotate secrets, restore DB).
   - Final `docs/REVIEW.md` and `docs/DECISIONS.md`.
   - `docs/GO_LIVE.md` with the §12 gate status.

## 11. Definition of done (build)

- All §3 invariant tests and e2e pass on the Vercel preview.
- `npm audit` shows no high or critical issues.
- Security headers are present, and there are no secrets in the repo.
- Every string exists in SW and EN, with SW flagged for review.
- Final message:
  - what is mocked;
  - the status of each §12 gate;
  - the open founder decisions, payment routing first;
  - exact next steps.

## 12. Go-live gates (humans sign off; you only report status in `docs/GO_LIVE.md`)

- **G1** — Payment routing decided, with a legal opinion if the chosen route involves collecting or holding funds. The chosen provider adapter is implemented and passes against the provider's sandbox.
- **G2** — Egress IP strategy in place and whitelisted by the provider.
- **G3** — Legal: PDPC registration, the transfer impact assessment, the privacy notice approved by counsel, and SMS sender ID registration.
- **G4** — Contract: third-party audit of `LedgerAnchor`, the Safe configured, and the mainnet wallet funded, with a balance alert.
- **G5** — Security:
  - admin passkeys enrolled;
  - KMS signer and phone-number encryption live;
  - a restore drill passed;
  - a penetration test or independent review of the payment verification path.
- **G6** — Content: Swahili reviewed by a native speaker; education content approved by a health advisor.
- **G7** — Operations: the handbook's §20 launch checklist complete, and the first statement reconciliation done during the dry run.
