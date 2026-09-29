# Dandelion

Pilot app for a zero-cash menstrual-health product supply chain in Tanzania
(supplier → boss rider → hub → field champion → customer), specified in
`docs/handbook-v3.1.pdf` and built to `docs/BUILD_PROMPT.md`. Decisions and
handbook deviations are in `docs/DECISIONS.md`; go-live gate status in
`docs/GO_LIVE.md`; the final review in `docs/REVIEW.md`.

**Everything in this repository runs on mocks and testnet.** Real money,
real SMS and mainnet anchoring are gated by the founders' sign-offs in
`docs/GO_LIVE.md`.

## What it is

One Next.js app, three surfaces:

| Surface | Path | Who |
| --- | --- | --- |
| Role app (mobile-first PWA, Swahili default) | `/home`, `/orders/…`, `/problem`, `/customers`, `/notes`, `/education` (champions) | supplier, boss rider, hub manager, field champion |
| Admin dashboard | `/admin/…` | the two/three super-admins (passkey or TOTP second factor) |
| Public site | `/`, `/safety`, `/privacy`, `/verify/[ref]` | anyone |

Payments are mobile-money payments between stakeholders; the app only
**verifies** them: a callback (or the poller) names a provider transaction,
the verification job queries the provider directly, dedupes the reference
permanently, matches amount and payee to the `PaymentIntent`, and only then
sets `PAYMENT_CONFIRMED`. Nothing else can — no button, screenshot, SMS, code,
admin, or AI.

## Architecture

```mermaid
flowchart LR
  subgraph clients [Clients]
    F[Field PWA<br/>SW/EN]
    A[Admin dashboard<br/>passkey/TOTP]
    P[Public site<br/>/verify/ref]
  end
  subgraph app [Next.js on Vercel]
    SA[Server actions<br/>policy module]
    SVC[Services<br/>lib/services]
    DOM[Pure state machines<br/>lib/domain]
    CB[/api/payments/callback/provider/token/]
    VJ[Verification job<br/>lib/payments/verification]
    CRON[Crons: verify · anchor · reconcile · retention]
    AI[lib/ai (read-only, AI_ENABLED=false)]
  end
  subgraph data [Data]
    DB[(Neon Postgres<br/>pooled, triggers as guards)]
  end
  subgraph ext [External]
    MM[Mobile-money provider<br/>MockProvider by default]
    SMS[SMS gateway<br/>mock outbox by default]
    CELO[Celo LedgerAnchor<br/>testnet, Merkle roots]
  end
  F --> SA
  A --> SA
  P --> SVC
  SA --> SVC
  SVC --> DOM
  SVC --> DB
  MM -- callback --> CB
  CB --> DB
  CB -. waitUntil .-> VJ
  CRON --> VJ
  VJ -- status query --> MM
  VJ --> DB
  SVC --> SMS
  CRON -- anchor root --> CELO
  AI -. drafts only .-> A
```

Key modules:

- `lib/domain/` — table-driven state machines for custody, orders, payments; dual-approval evaluation; the One Screen decision tables. Pure functions, 100% transition coverage in `tests/unit/domain-machines.test.ts`.
- `lib/policy/` — the single place role-scoped access is decided; per-role tests.
- `lib/services/` — all writes; each state change and its `LedgerEvent` are written in one transaction.
- `lib/payments/` — `PaymentProvider` interface, `MockProvider`, provider stubs, callback ingestion, the verification job and poller, the dev simulator core.
- `lib/ledger/` — salted Merkle leaves, tree/proofs, `Signer` (env for testnet, KMS stub), anchoring cron logic, contract ABI.
- `lib/ai/` — assistive features only; ESLint boundary forbids importing the DB, services, payments or auth.
- `drizzle/` — forward-only migrations; `0001_guards.sql` installs the defence-in-depth triggers.
- `contracts/` — Foundry project for `LedgerAnchor.sol`.

## Setup (local)

Requirements: Node 22, Postgres 16, Foundry (optional, for the contract).

```bash
npm ci
cp .env.example .env.local
createdb dandelion_dev
createdb dandelion_test
createdb dandelion_e2e
npm run db:migrate
npm run db:seed
npm run dev
```

Then open http://localhost:3000. `db:migrate` applies the forward-only Drizzle migrations; `db:seed` creates the fake area, supplier, hub, riders, champions, customers and price list.

The dev default connects as user `postgres` with password `postgres`. On macOS (Homebrew or Postgres.app) the superuser is usually your own login name with no password, so set this in `.env.local` before migrating:

```
DATABASE_URL=postgres://YOUR_MAC_USERNAME@localhost:5432/dandelion_dev
TEST_DATABASE_URL=postgres://YOUR_MAC_USERNAME@localhost:5432/dandelion_test
```

Seed logins (all fake): admins `+255700000001` / `+255700000002`, field users
`+2557000000{10,21,22,30,41,42,43}`. **In development** the passphrases are
`test-admin-passphrase-alpha` / `-bravo`, the TOTP secrets are the fixed ones in
`scripts/seed.ts` and the field PIN is `2580`. **Everywhere else** (preview,
production) the seed refuses to create people unless the environment sets
`SEED_ADMIN_PASSPHRASE_A/B`, `SEED_ADMIN_TOTP_A/B` and `SEED_FIELD_PIN` — the
repository is public, so no deployed environment may use the repo's values
(ADR-026). Generate them with:

```bash
python3 -c "import base64,os,secrets,string;a=string.ascii_letters+string.digits;print('SEED_ADMIN_PASSPHRASE_A='+''.join(secrets.choice(a) for _ in range(32)));print('SEED_ADMIN_PASSPHRASE_B='+''.join(secrets.choice(a) for _ in range(32)));print('SEED_ADMIN_TOTP_A='+base64.b32encode(os.urandom(20)).decode().rstrip('='));print('SEED_ADMIN_TOTP_B='+base64.b32encode(os.urandom(20)).decode().rstrip('='));print('SEED_FIELD_PIN='+str(secrets.randbelow(9000)+1000))"
```

(Python is used because macOS has no `base32` command.)

```bash
# equivalent, Linux with coreutils:
echo "SEED_ADMIN_PASSPHRASE_A=$(openssl rand -base64 24 | tr -d '=+/')"; echo "SEED_ADMIN_PASSPHRASE_B=$(openssl rand -base64 24 | tr -d '=+/')"; echo "SEED_ADMIN_TOTP_A=$(openssl rand 20 | base32 | tr -d '=')"; echo "SEED_ADMIN_TOTP_B=$(openssl rand 20 | base32 | tr -d '=')"; echo "SEED_FIELD_PIN=$(( RANDOM % 9000 + 1000 ))"
```

The seed also refuses any database that already holds a user or customer
without `(TEST)` in the name, and `npm run build` runs the same check before
migrating on non-production builds (`scripts/guard-db.ts`). The dev simulator
lives at `/dev/simulator` (admin session; `SIMULATOR_ENABLED=true`). Mock SMS
(activation links, OTPs, receipts) appear in the simulator's outbox.

### Tests

```bash
npm run typecheck && npm run lint && npm run i18n:check
npm run test:unit        # domain machines, policy, crypto, ledger, i18n parity, AI boundary, env guards,
                         # and the AI evals in lib/ai/evals (FakeLlm — no network, no API key)
npm run test:int         # full service-layer flow on Postgres (+ anvil anchoring when Foundry is installed)
npm run test:demo        # generates the living demo dataset on dandelion_demo and checks its coverage (~15 s)
npm run contracts:test   # forge test
npm run e2e              # Playwright: handbook Day 8 dry run through the UI (starts its own server)
npm audit --audit-level=high
```

CI (`.github/workflows/ci.yml`) runs all of the above on every PR, plus `npm run test:demo` (below). Dependabot is enabled.

## Demo data (living dataset)

`SEED_PROFILE=demo` generates weeks of realistic, mutually consistent activity **through the same services the UI uses** — no state is written directly, so every invariant holds for the generated data too. It needs an **empty database**, `SIMULATOR_ENABLED=true` (payments go through the mock provider) and valid seed credentials.

```bash
createdb dandelion_demo
DATABASE_URL=postgres://postgres:postgres@localhost:5432/dandelion_demo npm run db:migrate
DATABASE_URL=postgres://postgres:postgres@localhost:5432/dandelion_demo SIMULATOR_ENABLED=true SEED_PROFILE=demo DEMO_SCALE=small npm run db:seed
```

- `DEMO_SCALE=small` (default; ~10 s locally): 1 area, 2 hubs, 2 riders, 6 champions, ~40 customers, 3 weeks of history. `full`: 2 areas, 3 hubs, 3 riders, 12 champions, 150 customers, 6 weeks.
- `DEMO_SEED` (default `dandelion-2026`) makes the run reproducible; the sequence of service calls is identical for the same seed.
- Time is simulated with `lib/clock-override.ts` (scripts and tests only — see ADR-024): history is laid down day by day in East Africa Time, quiet at night and on Sundays, with a nightly reconciliation run.
- Everything deliberate that a reviewer would flag — payments in review, reversals, locked lots, statement differences, pending enrollments, a locked user — is listed with ids in `settings.demoManifest`, and `tests/demo/demo-profile.test.ts` proves that every open reconciliation flag is explained there, that every reachable order, custody and payment state appears, and that no scenario was skipped.
- Every person is fictional and carries `(TEST)`; phones come from `+255 700 00x xxx` only (ADR-025); no health data anywhere.
- Preview deployments: set `SEED_PROFILE=demo` (with `SEED_ON_BUILD=true`) on a fresh Neon branch; the build seeds it. The demo profile refuses a non-empty database.

The generator is in `scripts/demo/` (scenario modules `supply.ts`, `admin.ts`; orchestrator `run.ts`). Three things it found in the app are recorded in `docs/REVIEW.md` (a reversal bug, fixed; two exception types no service raises).

## Environment variables

See `.env.example` for the full list with comments. Rules:

- `VERCEL_ENV` selects `production | preview | development`; detection fails closed, so a production build (`NODE_ENV=production`) without `VERCEL_ENV` is production (ADR-023). Outside production the payment provider, SMS provider and chain are **forced** to mock / mock / testnet.
- Time is read only through `lib/clock.ts`; the override for seeds and tests (`lib/clock-override.ts`) cannot be imported by the app, and `npm run build` fails if it leaks into the bundle (ADR-024).
- Secrets have deterministic dev defaults only in development; preview and production must set them.
- Production refuses `ANCHOR_SIGNER_KEY` (env private key) and, unless `ALLOW_ENV_DATA_KEY=true`, a non-KMS data key.
- `SIMULATOR_ENABLED=true` is needed for `/dev/simulator`; it is always 404 in production.
- `AI_ENABLED=false` by default; `AI_MODEL` defaults to `claude-sonnet-5-5`; `ANTHROPIC_API_KEY` is required only when AI is on. `AI_PRICE_IN_MICRO_USD_PER_1K` / `AI_PRICE_OUT_MICRO_USD_PER_1K` feed the monthly budget check (defaults are placeholders — verify against current Anthropic pricing before enabling).

## Deploy (Vercel + Neon)

Dashboard steps that need the founders' Vercel account (see `docs/GO_LIVE.md`). Setting names and the variables the Neon integration creates should be checked against current Vercel and Neon docs — they were not reachable from the build environment.

### A demo preview with no terminal

A demo must be a **preview** deployment: in production the simulator is 404, the mock provider can confirm nothing and the seed refuses to run (ADR-016, ADR-022). The build itself runs the migrations and, when asked, the demo seed.

1. vercel.com → Add New → Project → import `peteraly/dandelion`. Let the first deployment run: it deploys the repository's default branch as *production* and will complain about missing secrets — expected, harmless.
2. Project → Settings → Git → **Production Branch** → `main`. From now on the build branch deploys as a preview.
3. Project → Storage → Create Database → **Neon** (Marketplace; a free plan exists) → connect it to the project with **preview branches** enabled, so each git branch gets its own database. The integration sets `DATABASE_URL` (pooled) and an unpooled variant in every environment.
4. Project → Settings → Environment Variables → environment **Preview** → add:

   ```
   SIMULATOR_ENABLED=true
   SEED_ON_BUILD=true
   PIN_PEPPER=<random>
   OTP_HMAC_KEY=<random>
   BLIND_INDEX_KEY=<random>
   MOCK_PROVIDER_SIGNING_KEY=<random>
   CALLBACK_TOKEN_MOCK=<random, letters and digits only — it is part of a URL>
   CRON_SECRET=<random>
   DATA_KEK=<exactly 32 random bytes, base64>
   ```

   One command prints the whole block with fresh values:

   ```bash
   for k in PIN_PEPPER OTP_HMAC_KEY BLIND_INDEX_KEY MOCK_PROVIDER_SIGNING_KEY CALLBACK_TOKEN_MOCK CRON_SECRET; do echo "$k=$(openssl rand -hex 32)"; done; echo "DATA_KEK=$(openssl rand -base64 32)"
   ```

5. Settings → Deployment Protection: keep previews behind Vercel login (recommended) or open them for the demo — the data is fake either way.
6. Trigger a build of the branch (push a commit, or create a deployment for the branch from the Deployments tab). The build migrates and seeds its Neon branch; the preview URL is listed under Deployments. Log in at `/admin/login` with the seed logins from Setup; `/dev/simulator` fakes payments and shows the SMS outbox.

### Production

1. Record the team plan in `docs/DECISIONS.md` ADR-019 — cron frequency, static IPs and function limits depend on it. Use the **pooled** (`-pooler`) Neon string as `DATABASE_URL` for functions; migrations use the unpooled one automatically. Record region and at-rest encryption status (verify) in ADR-019.
2. Add the env vars from `.env.example` for Production: real secrets, `PRODUCTION_DB_HOST`, `CRON_SECRET`; never `SEED_ON_BUILD` or `SIMULATOR_ENABLED` (both are ignored in production anyway).
3. Migrations run in the build (`scripts/predeploy.ts`); a failed migration fails the deploy. Rollback = restore a Neon point-in-time branch (below), never a down-migration.
4. Crons are declared in `vercel.json` and run in UTC. The committed file is sized for Vercel's free plan (two daily jobs: reconciliation at 17:00 UTC = 20:00 Dar es Salaam, retention at 22:30 UTC); Vercel rejected deployments outright with the fuller schedule. On a paid plan restore the payment poller and anchoring — verify the plan's allowed frequencies first:

   ```json
   "crons": [
     { "path": "/api/cron/verify", "schedule": "*/5 * * * *" },
     { "path": "/api/cron/anchor", "schedule": "0 * * * *" },
     { "path": "/api/cron/reconcile", "schedule": "0 17 * * *" },
     { "path": "/api/cron/retention", "schedule": "30 22 * * *" }
   ]
   ```

   Until then, callbacks still trigger verification immediately (`after()`), and the poller and anchoring can be run from `/dev/simulator` (non-production) or the admin Ledger page. Vercel calls crons with `Authorization: Bearer $CRON_SECRET`.
5. Uptime: point an external monitor (e.g. Better Stack, UptimeRobot — founders' choice) at `GET /api/health` every 5 minutes; it returns 503 when the DB is unreachable, the poller/anchor/reconciliation heartbeat is older than 2× its interval, or the anchor wallet is below the alert threshold.
6. Run the e2e suite against a preview before promoting: `E2E_BASE_URL=https://<preview> DATABASE_URL=<preview pooled url> E2E_SEED_REMOTE=1 CRON_SECRET=<preview secret> npm run e2e`.

Contract (testnet only until G4): verify the current Celo testnet on docs.celo.org, set `CHAIN_ID`/`CHAIN_RPC_URL`/`CHAIN_EXPLORER_URL`, then
`cd contracts && ADMIN=<safe> WRITER=<writer address> forge script script/Deploy.s.sol --rpc-url $CHAIN_RPC_URL --broadcast --private-key $DEPLOYER_KEY`
and `npm run ledger:record -- <address> <txHash>`. Fund the writer address with testnet CELO.

## Daily routine (handbook §15) — runbook

**Morning (John):** open `/admin` → Today's priorities. Work top to bottom: payments needing review (`/admin/exceptions`), deliveries awaiting inspection (`/admin/orders`), low-stock hubs (`/admin/inventory`), approvals waiting for the second admin (`/admin/approvals`), unresolved exceptions, reconciliation flags. `/admin/brief` lists the same items with stop-and-fix triggers. Message anyone stuck in a pending status (support numbers come from `HELP_PHONE`/`HELP_WHATSAPP`).

**Morning (hub manager / champion):** open the app; the home screen shows the one next action.

**End of day (both founders):** `/admin/reconciliation` → Run now (the cron also runs nightly at 20:00 Dar es Salaam). Every completed transfer must have a matching confirmed payment and custody event; anything else is a flag. Review complaints (`/admin/exceptions`), check tomorrow's stock and staff.

**Monthly (USA co-founder):** download the provider's merchant statement CSV, import it at `/admin/statements`, and clear the diff (confirmed-but-missing, missing-but-in-statement, amount differs). This is the independent check anchoring cannot give (ADR-005). Also run the restore drill below.

## Incident runbook

**Pause anchoring.** From the admin Safe call `pause()` on `LedgerAnchor`. The anchor cron then skips ("contract paused") and events accumulate in the DB; payments are unaffected. `unpause()` resumes; the next run anchors the backlog.

**Lock accounts.** A user: `/admin/stakeholders/<id>` → Lock (revokes all sessions). All field users: `update users set status='LOCKED', lock_reason='incident' where role <> 'SUPER_ADMIN'` and `update sessions set revoked_at=now()`. An admin can only be locked by another admin.

**Compromised admin device.** Another admin: re-enroll the affected admin (clears passphrase, TOTP and passkeys, revokes sessions) and hand over the new link in person.

**Rotate secrets.**
- PIN pepper: set `PIN_PEPPER_PREVIOUS` = old value, `PIN_PEPPER` = new value, increment `PIN_PEPPER_VERSION`. Existing hashes verify with the previous pepper by version; users are re-hashed on their next successful login (todo: background re-hash) — or re-enroll them.
- OTP HMAC key (`OTP_HMAC_KEY`): rotate at a quiet moment; outstanding OTP/handover codes (≤ 30 min) become invalid and are simply resent.
- Blind-index key (`BLIND_INDEX_KEY`): requires re-indexing every `users.phone_index` and `customers.phone_index` (decrypt → recompute) in one maintenance window; do it with a script, then swap the key.
- Callback tokens (`CALLBACK_TOKEN_<PROVIDER>`): register the new URL with the provider first, then remove the old value.
- Data KEK: with KMS, rotate the key version in KMS (old versions keep decrypting); with `DATA_KEK` re-encrypt every ciphertext.
- Anchor writer key: generate the new KMS key, call `setWriter(new)` from the Safe, then switch `ANCHOR_KMS_KEY_ID`.

**Restore the database.** Neon → project → Branches → create a branch from a point in time (or restore). For a drill (monthly): create branch `drill-YYYY-MM` from yesterday, point a local `DATABASE_URL` at its pooled string, run `npm run typecheck && npm run test:int`-style read checks (`select count(*) from orders`, spot-check a receipt against `/verify`), record the result in `docs/GO_LIVE.md` (G5), delete the branch. For a real rollback: restore production to the point in time, then redeploy the last known-good commit; migrations are forward-only, so never run a newer schema against an older restore.

**Provider outage.** Payments stay `PAYMENT_PENDING`; the poller retries with backoff (`RETRY`/`DEAD` after 8 attempts). Tell stakeholders not to release stock; when the provider is back, `/dev/simulator` (non-prod) or the poller cron picks up the still-pending intents.

## AI features (assistive only, off by default)

Everything AI lives in `lib/ai/` and is reached through one gateway, `lib/services/ai-gateway.ts`. The gateway is the only place that checks `AI_ENABLED`, rate-limits callers (per user, per minute), enforces the `aiMonthlyBudgetCents` setting (dual-approved), scrubs input, logs every call to `ai_interaction_log` (prompt version, scrubbed input, raw output, tokens, accepted/rejected reason, human decision), and never writes anything else. ESLint forbids `lib/ai/**` from importing the database, services or payments (`tests/unit/ai-boundary.test.ts`).

| Feature | Where | What it can do | What it cannot do |
| --- | --- | --- | --- |
| Problem intake | `/problem` (field) | Propose an exception category + one-line note from a free-text report | Create the exception — the user picks the category; the proposal is just prefilled |
| Morning brief | `/admin/brief` | Explain today's deterministic priority list | Reorder or add items; any item it invents is dropped |
| Weekly review | `/admin/brief` | Draft a 5-line review from aggregate counts | See names or phone numbers |
| Message drafts | `/admin/messages` | Adapt a handbook §18 template for one recipient | Send — the admin approves every message; the recipient's name never reaches the model |
| Anomaly explainer | `/admin/reconciliation?explain=` | Explain a reconciliation flag | Suggest a status change (guard rejects the draft) |
| Education helper | `/education` (champions) | Answer product-use questions **only** from `content/education/pack.json`, citing a section | Give health guidance — symptom questions never reach the model and show the referral card; the pack is DRAFT until an admin approves it in Settings **and** a qualified health advisor reviews it |

Guards are deterministic and blunt on purpose (`lib/ai/guards.ts`): medical language, state-change language ("mark as paid"), pressure/debt language, a Swahili sanity score, phone numbers in output, empty output. Prompts are versioned in `lib/ai/prompts/`; every version change is a code change. Evals run in CI with `FakeLlm` (`lib/ai/evals/ai.eval.test.ts`): PII never leaves, refusals hold, injection stays data.

To enable on a preview: set `AI_ENABLED=true` and `ANTHROPIC_API_KEY`, then have two admins approve the `aiMonthlyBudgetCents` setting. Turning AI off removes every AI control from the UI; nothing else changes.

## What is mocked

`MockProvider` (payments), the mock SMS outbox, the KMS clients (`KmsSignClient`, `KmsEncryptClient` throw), the model behind the AI features (`FakeLlm` in tests; the real `AnthropicLlm` runs only with `AI_ENABLED=true` and a key). The chain is a real testnet when `ANCHOR_SIGNER_KEY` and a recorded deployment exist; otherwise anchoring is skipped and events accumulate.

## Status

Pilot build complete on mocks and testnet. Preview deployments follow the Deploy section above; go-live gates are tracked in `docs/GO_LIVE.md`.
