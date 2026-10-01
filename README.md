# Dandelion

Pilot app for a zero-cash menstrual-health product supply chain in Tanzania
(supplier → boss rider → hub → field champion → customer), specified in
`docs/handbook-v3.1.pdf` and built to `docs/BUILD_PROMPT.md`. Decisions and
handbook deviations are in `docs/DECISIONS.md`; go-live gate status in
`docs/GO_LIVE.md`; the final review in `docs/REVIEW.md`. The living demo and
the ecosystem view follow `docs/PROMPT_DEMO_AND_ECOSYSTEM.md`; what each
participant sees (and why it is not a DoorDash) is `docs/PROMPT_INTERFACES.md`;
the investor demo script, its polish pass and the rehearsal checklist are
`docs/PROMPT_DEMO_POLISH.md`; the blockchain in plain language, the open
demo and the interface clean-up are `docs/PROMPT_E_BLOCKCHAIN_OPEN_DEMO_UX.md`;
the red team of every scenario, the market design, AI with people in charge and
the DoorDash-easy experience plan are `docs/PROMPT_F_RED_TEAM_MARKET_EXPERIENCE.md`;
the always-live demo district, the plain admin and the new role names are
`docs/PROMPT_G_LIVE_DISTRICT_PLAIN_ADMIN.md`; the walkthrough of one sale
with everyone's phone, prices and distance, demand-driven restocking and the
phone-first pass are `docs/PROMPT_H_JOURNEY_PRICING_DEMAND_MOBILE.md`; the red
team for rural roads, the rains, trip pay "like Uber and DoorDash, but fair to
far villages" and generalising beyond pads are
`docs/PROMPT_I_ROADS_RAINS_TRIP_PAY.md`; whether the model is sustainable in
Tanzania, every stakeholder and their incentives, the problem worked backward
to the build, and the field test before more features are
`docs/PROMPT_J_PROBLEM_FIRST_STAKEHOLDERS.md`.

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

- `DEMO_SCALE=small` (default; ~10 s locally): 1 area, 2 suppliers, 2 hubs, 2 riders, 6 champions, ~40 customers, 3 weeks of history. `full`: 2 areas, 4 suppliers, 3 hubs, 3 riders, 12 champions, 150 customers, 6 weeks. Every area has a reliable primary supplier and an occasional one (longer lead time, activated by dual approval during the run) whose batches carry most inspection issues, one batch confirmed two days late, and one pickup left waiting past its lead time — all in the manifest. Every sale path of prompt §8.8 is switched on for the demo's areas by a dual-approved request: riders keep stock and do village drops, customers and champions buy at the factory gate, and two organisations per area buy in bulk (one order left unpaid on purpose).
- `DEMO_SEED` (default `dandelion-2026`) makes the run reproducible; the sequence of service calls is identical for the same seed.
- Time is simulated with `lib/clock-override.ts` (scripts and tests only — see ADR-024): history is laid down day by day in East Africa Time, quiet at night and on Sundays, with a nightly reconciliation run.
- Everything deliberate that a reviewer would flag — payments in review, reversals, locked lots, statement differences, pending enrollments, a locked user — is listed with ids in `settings.demoManifest`, and `tests/demo/demo-profile.test.ts` proves that every open reconciliation flag is explained there, that every reachable order, custody and payment state appears, and that no scenario was skipped.
- Every person is fictional and carries `(TEST)`; phones come from `+255 700 00x xxx` only (ADR-025); no health data anywhere.
- Preview deployments: with `SEED_ON_BUILD=true` and `SIMULATOR_ENABLED=true`, a preview seeds the **full** demo district by default (`SEED_PROFILE` and `DEMO_SCALE` override). A database our seed filled with the minimal profile is replaced by the demo district on the next build; a database that already holds the demo district is left alone. The seed ends with six live hours on the real clock, so deliveries are already under way (Prompt G, ADR-034).

- **Keep it moving.** On a demo database, `/dev/simulator` (admins; `SIMULATOR_ENABLED=true`) has *Simulate one hour* and *Simulate one day*: new activity on the **real** clock through the real services, then the payment poller — and for a day, reconciliation and anchoring — run in-process, because previews have no crons. Limited to 6 per 10 minutes; every tick is an admin-log entry (`demo.tick`). The seed-only clock override is not involved.
- **Reset to the demo dataset.** Same page; type `demo`. It logs a security `ALERT`, wipes the database and POSTs the Vercel Deploy Hook (`VERCEL_DEPLOY_HOOK_URL`) so the build re-seeds the demo profile; locally it prints the seed command instead. Never in production; outside development it also needs `SEED_PROFILE=demo` and `SEED_ON_BUILD=true` in the environment. Every session ends with the wipe — sign in again after the rebuild.
- **Honest labels.** While `settings.seedProfile` is `demo`, every admin and field page, `/verify` and every CSV export carry "SIMULATED DATA — generated for testing; no district is running." (keyed on the setting, never on names).

The generator lives in `lib/demo/` (scenario modules `supply.ts`, `admin.ts`; `day.ts` is shared by the seed and the simulate buttons); `scripts/demo/run.ts` is the seed-only orchestrator that lays down the backdated history. Three things it found in the app are recorded in `docs/REVIEW.md` (a reversal bug, fixed; two exception types no service raises).

## Suppliers (the organisations that make or sell the products)

A supplier is an organisation, not a login (Prompt B §8, ADR-029). `/admin/suppliers` is the directory — area, lead time, products supplied, users, last and open pickups, and a quality signal (share of its batches with a `STOCK_SHORT`, `SEAL_BROKEN` or `DAMAGED_OR_WET` exception in 30 days); each supplier's page adds price lists, pickups, **payments the provider confirmed** to the organisation's accounts (with statement matches), the quality issues traced to its batches and the activation history. Rules:

- A new supplier starts **inactive**; activation and deactivation are `STAKEHOLDER_ACTIVATE` dual approvals (the requester cannot approve; one open request per supplier). Activation writes a `STAKEHOLDER_ACTIVATED` ledger event.
- A pickup can be assigned only for a `(supplier, product)` pair in `supplier_products` (the pickup form offers only those pairs); prices still come from the area's active price list for that supplier.
- Several `SUPPLIER` users may belong to one organisation and all see the same organisation view: this week's pickups, confirmed money this week and this month, quality feedback on their batches. Any of them may confirm a batch ready or release it. Margins of hubs and champions are never shown to suppliers.
- The only person-linked field is an optional business contact, encrypted like every phone number; nothing about health.

## Sale paths, organisations and earnings (prompt §8.8)

The handbook's ladder — supplier → rider → hub → champion → customer — is always allowed. Every other way the products can move is a **sale path** in one table (`ALLOWED_SALES` in `lib/domain/sales.ts`): who sells, who buys, the order kind it becomes, and whether it is an installment plan (customers) or an exact-payment sale (stakeholders and organisations). A pair outside the table cannot be started at all; a path outside the ladder is off for a real area until two admins switch it on under `/admin/areas` (`AREA_SALES_CHANGE`, dual approval), because it decides who earns.

- **Village drops.** A pickup with no destination hub is the rider's own stock (custody `WITH_RIDER`); the rider enrols customers and sells like a champion (`RIDER_TO_CUSTOMER`) — same plan, same handover code, same receipt and verify link.
- **Factory gate.** Customers, hubs and champions near the factory can buy from the supplier directly (`SUPPLIER_TO_CUSTOMER`, `SUPPLIER_TO_HUB`, `SUPPLIER_TO_CHAMPION`); the supplier registers the batch at the sale.
- **Organisations.** NGOs, non-profits, schools and community groups are records, not logins (`/admin/organisations`; activation is the same dual approval as for suppliers). A supplier, hub or rider sells to them at the organisation price of the area's price list; the organisation pays the full amount by mobile money **before** delivery and gets payment details, confirmation and the receipt by SMS; the delivery ends the lot (`DELIVERED_TO_ORG`). Nothing about the people an organisation serves is recorded.
- **Earnings.** Every field home screen shows what the person earned — money the provider confirmed to them minus what they paid their own sellers — this week and this month (`lib/services/earnings.ts`). Pending payments count for nothing.
- **Deletion requests** are refused while the subject still has open orders (`subject_has_open_orders`): the phone is tombstoned on deletion and open orders still need it for codes, receipts and reminders. Decline the request or finish the orders first.
- The demo switches every path on for its fictional areas. Real areas stay ladder-only until the founders record their §8.8.6 decisions (`docs/GO_LIVE.md` item 9; ADR-031).

## Field interface (prompt C)

What each participant sees, and why it is not a DoorDash, is `docs/PROMPT_INTERFACES.md`. Two of its small changes are in:

- **My day** — under the one primary action, a field home lists the person's other open orders (at most eight) with the order kind, a state chip and one verb, taken from the same workflow rows that pick the primary action. Riders also see the units they keep for village drops. Never a second primary button.
- **What happened** — the field order page ends with the order's timeline: the ledger's own events (payments confirmed or sent to review, custody, handover, problems), each labelled by type and by the *role* that acted, never by name.
- The customer status keyword by SMS (§5.3) waits on the founders' decisions in §7 of that document.

The investor demo (`docs/PROMPT_DEMO_POLISH.md`) adds, on the demo profile only: a **demo guide** at `/admin/demo` (the seven-beat script with deep links, the accounts by phone, the *one hour / one day* controls, a warm-up button, the reset), a **presenter view** at `/admin/present` (the ecosystem view without the sidebar, map at full width), and `npm run demo:screens` (seeds a throwaway demo database and saves the seven beats as PNGs under `docs/demo-screens/`, git-ignored until the founders decide). Everywhere: fictional names keep their " (TEST)" suffix in the data and show it as a small *test* chip (`components/name.tsx`; screen readers still hear the suffix); the sidebar is grouped; the field earnings card shows received, paid out and net; the live feed shows a subject only when it is a reference a person would recognise; demo companies and organisations get names short enough for a map tile.

## Open demo — no sign-in (`/demo`)

For showing the fictional district to people without accounts (Prompt E, ADR-033). On a preview filled by our seed, set `DEMO_OPEN_ACCESS=true` (Preview only) and redeploy; the home page then offers **Try the demo — no sign-in**, and `/demo` has one button per role (founder, second founder, supplier, boss rider, hub manager, field champion). It is 404 in production, without the variable, or on a database our seed did not fill. Open-demo sessions cannot reset the dataset, export data or register passkeys, and accept only test phone numbers (+255 700 00x xxx). Everyone with the link shares one district; a real admin's reset restores it.

## Is it blockchain? (in one paragraph)

Yes, narrowly: about once an hour the app publishes one fingerprint of its new records to a public blockchain (Celo), so anyone with a receipt link can check that a record has not been changed since. Payments, people and phone numbers never go on-chain, users have no wallets, and money moves by ordinary mobile money. It proves records were not altered afterwards, not that they were true; the provider's confirmations, dual hand-over checks, two-admin approvals and statement reconciliation do that. The anchoring job is built and tested but switched off in the preview until a testnet key and contract are configured. Plain-language explanation and next steps: `docs/PROMPT_E_BLOCKCHAIN_OPEN_DEMO_UX.md`.

## Walkthrough: one sale, phone by phone (`/admin/demo/journey`)

On the demo dataset, the walkthrough follows one sale across every stakeholder in 20 steps — a local seller signs up a customer, she pays in instalments and gets her product with a one-time code, the seller restocks from her hub, the hub gets a factory pickup sized by its sales, the delivery partner collects, pays, rides, is inspected and paid. Five phones sit beside the steps (customer, local seller, hub keeper, delivery partner, supplier): each shows the texts that person received, newest sliding in, and, for people with the app, what their home screen says to do next. Every step is the real service call by the person who would take it (`lib/demo/journey.ts`); **▶ Play** takes a step every four seconds. The walkthrough's orders are held back from the live engine. A demo test runs all 20 steps.

## Restock suggestions (Stock page)

Buyers pull sales; hubs are stocked ahead of demand. For every hub and product, `lib/domain/replenishment.ts` turns the last 14 days' sales, stock on hand, stock on the way and the lead time into a reorder point and a suggested pickup (packs of 10). The Stock page lists them with **Assign pickup**, which opens the pickup form filled in; the demo's live engine orders by them. A person always decides.

Since Prompt I the suggestions also:

- **Read the road.** **Areas & sale paths → Roads and rains** records each hub's km from town, worst stretch of road and whether the rains slow it, plus each area's rainy months. The lead time is the supplier's days plus road days (dirt 2, far +1, doubled in the rains on a rain-slowed road), or what real trips took (4 in 5 within it, 90 days, at least 3 trips), whichever is slower (`lib/domain/routes.ts`).
- **Don't read an empty shelf as low demand.** A nightly record (`hub_stock_days`, written with the nightly reconciliation) excludes empty days from the demand rate.
- **Count what local sellers are waiting for** as already owed.
- **Ignore a locked delivery as "on the way".**

Road data changes stock advice only, never pay, so one admin records it and every change is logged.

## Names people read

The interface calls the roles **Supplier**, **Delivery partner** (code `BOSS_RIDER`), **Hub keeper** (`HUB_MANAGER`) and **Local seller** (`FIELD_CHAMPION`); in Swahili *Msambazaji*, *Msafirishaji*, *Mtunza kituo*, *Muuzaji wa mtaani*. The codes, the database, the logs and the handbook keep the original names (ADR-034, `docs/PROMPT_G_LIVE_DISTRICT_PLAIN_ADMIN.md`).

## Admin home (`/admin`) and finding your way

The admin home answers first, like the field apps: **Needs you now** (only what is above zero, most urgent first, each with one plain sentence and one button), **Happening right now** (on the road, waiting to leave, waiting for payment, paid in the last hour, plans, events — and the way into the live map), then **Everything else**: every admin page as a card with one line saying what it is for. The sidebar marks the page you are on, and every page opens with a one-line guide ("Day to day › Approvals — anything important needs two admins…"). The labels and hints live in `messages/*.json` under `admin.nav` and `admin.navHints`; the list itself in `components/admin-nav-groups.ts`.

## Ecosystem view (`/admin/ecosystem`)

One read-only screen for the founders (Prompt B §3): *where is the stock, where is the money, who is stuck, is the machine healthy?* Everything on it comes from one snapshot service (`lib/services/ecosystem.ts`, Zod-typed, aggregated in SQL; admin-only through `admin.ecosystem.view`).

- **At a glance** — four numbers first: units in the district, provider-confirmed payments in the window, active plans, needs attention. Filters are compact segmented controls; hubs, champions and open orders sit behind tabs that follow the selected chip; system health is one line with details folded; money lists only the paths that moved money; the feed shows 12 items with "show more".
- **Attention strip** — only checks with something to do are shown; the rest fold into "N checks all clear". One chip per stop-and-fix category (payments in review, pending too long, locked batches, approvals waiting, open problems, reconciliation flags, dead verification jobs, silent stakeholders, hubs below minimum, paid-but-not-handed-over, waiting on a supplier, supplier quality, organisation orders unpaid after three days). A chip filters the tables below.
- **District map** — one schematic per service area, laid out by a pure function (`lib/ecosystem/district.ts`), never a real map: the factory on the left, the riders' stand, the hubs as depots along one road with their champions' kiosks and their customers' block (dot density = customers) underneath, organisations and directly served customers on the right. Every tile prints its numbers (units, plans active/stalled, provider-confirmed money, earned in the window); a padlock marks a locked lot; the active attention chip outlines the tiles it points at. Edges only for orders in flight (thickness = units; grey pending, green confirmed, amber in review, red on hold; direct paths dashed). **Every open order is a marker** — a motorbike when a rider carries it, a parcel otherwise — ringed in its own payment colour with its units beside it, and placed by where the order really is (`orderStage`): at the sender's door (being prepared, ready, being paid for at the factory), on the road (only these move with the clock), or at the receiver's door (inspection, paid and handing over). Orders of one edge waiting at the same door are one marker with a count (their total units beside it, the most urgent payment colour on the ring) and clicking it opens that place's details; orders on the road ride one marker each, up to four per edge, then "+N", and clicking one opens the order. **A coin** on a tile's corner is money the provider confirmed to that place in the last hour. A green dot pulses on every place active in the last hour (motion stops under `prefers-reduced-motion`). **Click any place** (`?focus=`): a details panel opens (a bottom sheet on a phone) with what it holds, what is coming in and going out and at which step with each payment's state, the money that moved in the last hour, and a link to its full page; everyone it has no open order with goes faint. A "Moving now" line above the map counts the orders on the road, waiting to leave, waiting for payment, at inspection, ready to hand over and on hold, and the money confirmed in the last hour. A one-line key sits above the map; the long legend folds under "How to read the map". Server-rendered inline SVG with a `<symbol>` sprite; no canvas, no charting library. A table with the same nodes and edges sits under it for keyboards and screen readers and replaces the map on a phone. Customers appear as dots and counts, never as names. On a demo dataset the map header carries the simulator's *one hour / one day* controls (same admin-only, rate-limited, logged action as `/dev/simulator`). The district also runs by itself: while any admin page of the demo dataset is open and watched, one simulated hour happens every minute (no button; "Live — the demo district is moving" in the sidebar; `components/live-district.tsx`), at most one step a minute however many people watch, with its own rate limit. An hour moves each live delivery exactly one step — prepared, collected and paid for at the factory, on the road, inspected, paid for and handed over at the hub — and each organisation order from ordered to paid to delivered (`lib/demo/live.ts`), so the map always has something on the way; the dataset's deliberate anomalies are never advanced.
- **Live feed** — the last 50 events across the ledger, the security log and the admin log, rendered from typed label tables (`lib/domain/events.ts` + `messages/*.json`), never raw database text.
- **Money** — confirmed by the provider, per order kind, for the chosen window (24 h / 7 d / 30 d); pending and in-review counts; plans active / completed / stalled (no payment for 10 days).
- **System** — job heartbeats with age (marked *manual — preview* when a simulator tick ran them), anchoring status, SMS outbox depth, providers, AI on/off with this month's usage, environment, version, dataset.
- **Refresh model** — a small client component calls `router.refresh()` every 30 s **only while the tab is visible**, backs off to 60 s after ten minutes, and pauses after an hour without interaction ("click to resume"). Nothing polls while the tab is hidden, so an open tab does not keep the Neon database awake; Neon's free plan meters compute hours and auto-suspends idle databases (verify current limits at neon.com/docs). The tab title gets a dot when attention items grew while the page was not looked at.
- **Access** — one `ecosystem.view` admin-log entry per admin session per day; no exports, no AI, no customer names or phone numbers (an integration test scans the serialised snapshot).

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
7. For the living demo: add `SEED_PROFILE=demo` (Preview) and the seed credentials (`SEED_ADMIN_PASSPHRASE_A/B`, `SEED_ADMIN_TOTP_A/B`, `SEED_FIELD_PIN` — generated as in Setup, kept in the password manager), reset the Neon branch to empty, redeploy. To empty a branch that has no parent (the project's `main`), run in the Neon SQL Editor:

   ```sql
   drop schema public cascade;
   create schema public;
   drop schema if exists drizzle cascade;
   ```

   The last line removes Drizzle's record of applied migrations. If it is forgotten, the next build notices the journal without the tables and re-applies every migration anyway (`lib/db/migrate.ts`). Then Settings → Git → **Deploy Hooks** → create one for the build branch and add its URL as `VERCEL_DEPLOY_HOOK_URL` (Preview): that is what "Reset to the demo dataset" on `/dev/simulator` calls after wiping the database.

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
