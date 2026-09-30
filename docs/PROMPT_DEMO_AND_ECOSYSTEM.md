# Dandelion — Build Prompt B: living demo dataset + ecosystem view (v1.4)

v1.1 amends v1 after an external review; the review log is in §7. Changes:
fail-closed environment detection, a clock override that cannot be imported by
the app, backdating only into an empty database, seed safety guards, preview
protection and env-sourced seed credentials as preconditions, no crons on
previews, visibility-aware refresh, demo banner keyed on a setting, and a
founders' decision about what the demo is for. v1.2 (§8) makes the supplier
a full stakeholder. v1.3 (§8.8) records the founder's description of how the
products actually move — supplier → riders → customers and villages,
organisations as buyers, factory-gate sales — and adds step 3c for it.

This prompt extends `docs/BUILD_PROMPT.md`. Everything there still applies — the
§3 invariants, the honesty rules, the stop conditions, the "never mark a gate
passed" rule, one commit per milestone. Where this prompt and BUILD_PROMPT.md
conflict, BUILD_PROMPT.md wins and the conflict is recorded in
`docs/DECISIONS.md` as an ADR.

Read first: `docs/BUILD_PROMPT.md`, `docs/handbook-v3.1.pdf` (§8, §12, §15,
§18, §20), `docs/DECISIONS.md`, `docs/REVIEW.md`, `lib/domain/types.ts`,
`lib/env.ts`, `lib/services/*`, `scripts/seed.ts`, `app/dev/simulator/*`,
`app/admin/(dash)/page.tsx`.

## 0. Goal

Two deliverables that turn the pilot from "a working app with seven fake users"
into something the founders can use for the Day 8 dry run and, if they decide
so, show to partners as *a simulation of what a running district would look
like* — never as a running district:

- **A. A living demo dataset.** A deterministic generator that populates an
  empty non-production database with weeks of realistic, mutually consistent
  activity across every stakeholder, every order kind, every payment outcome,
  every exception type and every admin workflow — and can keep the ecosystem
  moving during a live demo ("simulate one more day").
- **B. An ecosystem view.** One admin screen, `/admin/ecosystem`, that shows the
  whole system live: every node (suppliers, riders, hubs, champions, customers),
  what stock sits where, which orders and payments are in flight between which
  nodes, what needs attention, and what the system itself is doing.

## 1. Ground rules for both deliverables

1. **No invariant is bypassed to make data.** The generator drives the same
   service functions, state machines and mock payment provider the UI uses. It
   never writes order states, payment statuses, custody states, receipts,
   approvals or ledger events with raw SQL. Reference data (areas, hubs,
   suppliers, products, price lists via the approval flow, people via
   `createUser` + enrollment) may be inserted through the existing seed helpers.
   If a scenario cannot be produced through the services, that is a finding
   about the services (or the scenario is impossible by design) — record it,
   do not fake it.
2. **Fake identities only.** Every person is fictional. Display names carry the
   `(TEST)` suffix. Phone numbers come only from the range
   `+255 700 00[0-9] [0-9][0-9][0-9]` (`+255700000000`–`+255700009999`); the
   generator refuses any other number. This range is **not verified as
   reserved** by the regulator (ADR); it is safe only because SMS is forced to
   the mock provider outside production (`lib/env.ts`), which stays that way.
   Place names for areas, hubs and streets are fictional but Tanzanian in
   shape, and marked fictional in the manifest. No real person, business, till
   number or address anywhere.
3. **No health data, ever.** Customers have no medical fields (the forbidden
   fields test stays green). Problem reports, notes and exception texts may
   describe stock and payments; they never describe a person's health.
4. **Dangerous controls need an explicit positive signal, and environment
   detection fails closed.** `appEnv()` returns `production` when
   `VERCEL_ENV=production` **or** when `VERCEL_ENV` is unset and
   `NODE_ENV=production`; `preview` only when `VERCEL_ENV=preview`;
   `development` only when neither says production. The demo seed, the
   simulator's time controls, the reset control and the clock override each
   require `appEnv() !== "production"` **and** their own explicit flag
   (`SEED_PROFILE=demo`, `SIMULATOR_ENABLED=true`); absence of production is
   never enough on its own. Production gets exactly what it has today.
5. **Deterministic.** A seeded PRNG (`DEMO_SEED`, default `dandelion-2026`)
   makes every run reproducible: the sequence of service calls for a given
   seed is identical (tested with a call spy). Generated ids and hashes differ
   between runs and are not compared.
6. **Honest labels.** Money is always "confirmed by the provider" (mock in the
   demo). Anchoring shows "not anchored" when no chain is configured. Swahili
   strings added here carry `needs_native_review: true`. A persistent
   **SIMULATED DATA — no district is running** banner appears on every admin
   page, on `/verify` pages of generated receipts and in every export while
   `settings.seedProfile = "demo"`; it does not depend on names.
7. **Read-only view.** `/admin/ecosystem` performs no writes except one
   admin-action log entry per admin session ("viewed ecosystem"). Its only
   server actions are filter changes.
8. Everything is tested, typed, linted and documented like the rest of the repo.
   No go-live gate changes status because of this work.

## 2. Deliverable A — living demo dataset

### 2.1 Profiles and scale

`scripts/seed.ts` gains `SEED_PROFILE` (`minimal` | `demo`) and `DEMO_SCALE`
(`small` | `full`, default `small`).

- `minimal` = today's seed, unchanged (CI and e2e depend on it).
- `demo` runs **only on an empty database** (no users, no ledger events). On a
  `minimal`-seeded database it refuses and says to reset (§2.5) or use a fresh
  Neon branch. It records `settings.seedProfile = "demo"`,
  `settings.demoScale`, `settings.demoSeed` and the manifest.
- Preview builds use `SEED_ON_BUILD=true SEED_PROFILE=demo` (scale `small`);
  a fresh Neon preview branch is empty, so this is the normal path.

Scale (`small` is the default for builds; `full` for local demos):

| Thing | small | full | Notes |
| --- | --- | --- | --- |
| Service areas | 1 | 2 | full: one urban, one peri-urban; different WASH availability |
| Suppliers | 1 | 2 | |
| Hubs | 2 | 3 | low-stock and healthy; full adds over-stocked |
| Boss riders | 2 | 3 | |
| Hub managers | 2 | 3 | |
| Field champions | 6 | 12 | one inactive 10+ days; one pending enrollment |
| Customers | 40 | 150 | uneven per champion; one champion with none |
| Products | 3 | 3 | 2 disposable, 1 reusable (only where WASH confirmed) |
| Simulated history | 3 weeks | 6 weeks | ending "yesterday" in Africa/Dar_es_Salaam |
| Admins | 2 | 2 | see §2.8 for credentials |

Budget: `small` completes in under 90 seconds on Neon's free tier from a
Vercel build; `full` under 5 minutes locally. Measure both; if `small` misses
the budget, reduce its counts and say so in the report (stop condition §4).

### 2.2 Simulated time

The services stamp times with `new Date()` in ~65 places. Backdated history
needs one clock, and the clock must not become a security hole:

- `lib/clock.ts` exports `now(): Date` and nothing else public. Every
  `new Date()` in `lib/services`, `lib/payments`, `lib/auth` and `lib/ledger`
  becomes `now()`. A unit test fails if `new Date()` reappears there.
- The override lives in **`lib/clock-override.ts`**, which may only be imported
  from `scripts/**` and `tests/**` — enforced by ESLint `no-restricted-imports`
  (same mechanism as the AI boundary), a unit test that greps `app/` and
  `lib/` for the import, **and** a post-build check (`scripts/check-bundle.ts`,
  run by `npm run build` and CI) that fails if any string unique to the
  override module appears in the compiled `.next/` output — an
  `eslint-disable` comment cannot defeat that. The app bundle therefore
  contains no set path.
- `lib/clock-override.ts` additionally refuses at call time when
  `appEnv() === "production"` and when `process.env.NEXT_RUNTIME` is set
  (i.e. it is somehow running inside the Next.js server). Both refusals log a
  security event.
- Every timestamp a service writes is passed explicitly from `now()` — never
  left to a database `default now()` — so backdating is complete. Audit the
  schema for `defaultNow()` columns written by services and fix the services.
  If a trigger in `drizzle/0001_guards.sql` stamps `now()` itself, stop and
  record an ADR before changing it.
- Backdating is used only by `scripts/seed.ts` on an empty database (§2.1).
  The live "simulate" controls (§2.5) always use the real clock.
- Sessions, OTPs, lockouts and rate limits use `now()` too, so the generated
  history includes realistic login and OTP events. Because the override cannot
  be imported by the app, their expiry logic in production is unaffected.
- `now()` is a UTC instant. All realism rules (§2.4) are in
  Africa/Dar_es_Salaam; the generator converts explicitly with the existing
  `lib/util/time` helpers, and tests cover a Sunday and the 23:00–06:00 quiet
  window across the UTC day boundary.

### 2.3 Scenario coverage (all required)

The generator is organised as scenario modules under `scripts/demo/`, each a
pure function of `(rng, clock, actors)` that calls services. The full profile
must produce **at least** the following (scaled down proportionally in
`small`, never below two of each), and a manifest
(`scripts/demo/manifest.ts` → stored in `settings.demoManifest`) lists every
deliberate anomaly with its ids so tests can prove that nothing unexplained
appears.

**Supply chain, happy paths (dozens of each in `full`)**
- Supplier → rider pickups: assigned → batch ready → accepted → paid (exact) →
  confirmed by verifier → both confirmations → in transit.
- Rider → hub: delivery code → inspection checklist → pass → paid → both
  confirm → stock at hub; margins visible.
- Hub → champion: stock request → hub prepares → paid → both confirm.
- Champion → customer: enrolment with OTP and consent; plans paid in full at
  once; plans paid in 2–5 voluntary installments (amounts rounded to 500/1000
  TZS, gaps of days to weeks); handover with code; receipt; `/verify` works.

**Payment outcomes through the mock provider (each at least twice)**
- Under-payment installments that later complete.
- Over-payment → review → refund case opened → one resolved, one open.
- Wrong payee → review; wrong amount → review.
- Duplicate callback (same provider reference) → deduped, no double credit.
- Replayed/bad-signature callback → rejected + security event.
- Reversed transaction after confirmation → `PAYMENT_REVERSED` exception.
- Callback never arrives → poller confirms on schedule.
- Pending too long → `PAYMENT_PENDING_TOO_LONG` exception; a verification job
  that ends `DEAD` after retries.

**Custody**
- Inspection issue → lock → dual-approved resolution (resume).
- Damaged/wet → quarantine → return to supplier.
- A split batch across two champions.
- One batch still locked today (shows in attention lists).

**Admin workflows (each with both admins acting; timestamps hours apart)**
- Price list drafted, approved, superseded by a later list; one rejected draft.
- A self-approval attempt (refused, security event logged).
- Product availability change with WASH confirmed; one without (reusable
  product therefore unavailable in that area).
- Donor-funded orders: approved with evidence; rejected without evidence; one
  over the cap.
- Setting change (dual approved); one large export approval.
- Data requests: one correction handled, one deletion handled, one open.

**People and security**
- Every field role represented in every user status: active, pending
  enrollment (unused link), locked (lost phone, remote lock), suspended,
  re-enrolled after PIN reset.
- PIN lockout events, an OTP burst, expired sessions.

**Exceptions and notes**
- Every value of `EXCEPTION_TYPES` at least twice: one open, one resolved
  (through the proposal + dual approval path).
- Problem reports in Swahili and English (Swahili flagged for review).
- Offline notes synced from at least two champions.

**Reconciliation, statements, ledger**
- A reconciliation run per simulated day; the last run's flags equal the
  manifest's deliberate anomalies (test).
- One provider statement import covering the last simulated week with rows
  that match, differ in amount, are missing in the statement and missing in
  the app — all deliberate and listed in the manifest.
- Ledger events accumulate for everything above. No anchoring is faked: with
  no chain configured, anchors are absent and `/verify` says so honestly.

**Inventory shape**
- Hub A below `minStockUnits` with a pending restock request; hub B healthy;
  (full) hub C over-stocked with an idle champion. Stock ages visible (oldest
  batch per node).

### 2.4 Realism rules

- Activity follows East Africa Time: mornings and early evenings busier;
  Sundays quiet; no activity 23:00–06:00 except the nightly reconciliation.
- ~15% of customer plans stall for 10+ days before resuming; ~5% of payments
  need review; ~3% of deliveries hit an inspection issue; ~2% of users get
  locked at some point. All rates are parameters with these defaults.
- Names: fictional Tanzanian-style first and family names with `(TEST)`;
  never a real public figure's name. Streets/villages fictional.
- Swahili free-text bodies live in the generator with a `needs_native_review`
  note in the manifest; any new UI strings go through `messages/` as usual.

### 2.5 Keep it moving: simulated time in a live demo

Add to `/dev/simulator` (requires `appEnv() !== "production"` **and**
`SIMULATOR_ENABLED=true` **and** `settings.seedProfile = "demo"`; admin
session; every action logged to `admin_action_log` and rate-limited):

- **Simulate one hour** and **Simulate one day**: run the scenario modules
  forward from the real `now()` (no backdating), producing a plausible amount
  of activity for that period including a small chance of each anomaly type.
  Each tick also runs the poller, reconciliation and anchoring jobs
  **in-process**, because Vercel runs crons only for production deployments
  (verify against current Vercel docs; note it in the README). Heartbeats
  written this way carry `lastStatus = "ok (manual)"` and the ecosystem view
  labels them "manual — preview".
- **Reset to demo dataset**: wipes and re-seeds. Requires typing the profile
  name (`demo`) into a confirmation field, is limited to once per 10 minutes,
  and logs who did it. Never available in production.
- `settings.demoTicks` counts ticks so it is visible that data was generated.

### 2.6 Verification for A

- Unit: scenario modules are deterministic (same seed → same sequence of
  service calls, recorded via a spy); the fake-range guard; the time-zone
  conversion (Sunday, quiet window, UTC boundary).
- Integration (Postgres): run `demo`/`small` on an empty DB; assert every
  `ORDER_STATE`, `CUSTODY_STATE`, `PAYMENT_STATUS`, `EXCEPTION_TYPE`,
  approval type and user status appears; `reconcileOrder` flags ⊆ manifest;
  the schema-invariants test still passes; no phone outside the fake range;
  no display name without `(TEST)`; `demo` refuses on a non-empty database;
  the run completes under budget (timing reported as a warning in CI, hard
  fail only locally, to keep Neon cold starts from making CI flaky).
- e2e: after the demo seed, the admin home shows non-zero priorities, a hub
  page shows the low-stock warning, `/verify/<ref>` of a generated receipt
  renders with the simulated-data banner, and one generated customer plan can
  be continued through the UI.
- The existing 17 Playwright tests keep passing on `minimal`.

### 2.7 Docs for A

README "Demo data" section (profiles, scales, env vars, simulator controls,
budgets, "no crons on preview"); `docs/DECISIONS.md` ADRs for fail-closed
`appEnv()`, the clock override boundary, the unverified fake number range and
env-sourced seed credentials; `docs/REVIEW.md` updated; `.env.example`
updated. Note in `docs/GO_LIVE.md` (G5) that the clock refactor changes ~65
time-stamping sites in auth and payments, so any security review quoted
before it must be re-scoped after step 1.

### 2.8 Seed safety guards (precondition for step 2)

- **Content guard.** `assertSafeTargetDatabase()` refuses when the target
  database contains any user or customer whose display name lacks `(TEST)`.
  Every real database has people in it and every seeded person carries the
  marker, so this single rule is sufficient; a "ledger events without a
  seed marker" rule was dropped because it only produced false positives on
  legacy test databases. This is on top of the existing `PRODUCTION_DB_HOST`
  and hostname checks. (A host allowlist was considered and rejected: Neon
  creates a branch with a new host per git branch.) The demo profile
  additionally requires an empty database (`assertEmptyDatabase()`).
  The same guard runs in `scripts/predeploy.ts` **before migrations** for every
  non-production build, so a preview whose `DATABASE_URL` points at a
  production database can neither migrate nor seed it.
- **Credentials from the environment.** The seed admins' passphrases and TOTP
  secrets, and the field users' PIN, come from `SEED_ADMIN_PASSPHRASE_A/B`,
  `SEED_ADMIN_TOTP_A/B` and `SEED_FIELD_PIN`. Development keeps today's
  fixed values as defaults; preview and production have **no defaults** and
  the seed refuses to run without them. The repository then holds no usable
  credential for any deployed environment. Update README, e2e helpers and
  `.env.example`; the existing Playwright suite reads them from env with the
  development defaults.
- **Preview protection.** Before step 2 lands, the founders enable Vercel's
  Deployment Protection for previews (Vercel Authentication at minimum; verify
  what the current plan offers). Until it is confirmed, the demo seed stays
  off in the preview environment (`SEED_PROFILE` unset).
- Re-issue the demo admins' authenticator secrets once credentials come from
  env; the ones shared during setup become invalid by design.

## 3. Deliverable B — the ecosystem view

### 3.1 Purpose

`/admin/ecosystem` answers, on one screen and without clicking: *where is the
stock, where is the money, who is stuck, and is the machine itself healthy?*
It is the founders' live view during the Day 8 dry run and every day after.

### 3.2 Data: one snapshot service

`lib/services/ecosystem.ts` exports
`ecosystemSnapshot(actor, { areaId?, hubId?, window: "24h" | "7d" | "30d" })`
returning one typed object (Zod schema exported for tests). It is the only
data path for the page. Contents:

- **Nodes.** Suppliers, riders, hubs, champions (customers as counts per
  champion, never listed individually here). Per node: display name, role,
  status (active/locked/suspended/pending), last activity time, area/hub,
  and — for stock-holding nodes — units by custody state, locked units, oldest
  batch age, and for hubs `minStockUnits` vs available.
- **Edges.** Orders not in a terminal state, grouped supplier→rider,
  rider→hub, hub→champion, champion→customer: count, units, TZS expected,
  TZS confirmed, oldest age, how many are in payment review, on hold, or
  awaiting the other party's confirmation.
- **Money.** Confirmed TZS per order kind for the window, plus counts of
  pending and in-review intents; installment plans active/completed/stalled
  (no payment ≥ 10 days). Label everything "confirmed by provider".
- **Attention.** Payment reviews; payments pending longer than the threshold
  setting; locked batches; approvals waiting for a second admin; open
  exceptions by type; reconciliation flags unresolved; verification jobs
  `DEAD`; nodes with no activity ≥ N days; hubs below minimum stock; customers
  whose handover is pending after full payment.
- **System.** Job heartbeats (poller, anchor, reconciliation) with freshness
  and the "manual — preview" label when applicable; anchoring: last anchor or
  "not configured"; SMS outbox depth (mock); provider ids; AI on/off and this
  month's usage; environment; app version (`VERCEL_GIT_COMMIT_SHA` when
  present); `settings.seedProfile`.
- **Feed.** The last 50 events across `ledger_events`, `security_event_log`
  and `admin_action_log`, each rendered from a typed label table (no free
  text from the database is shown raw), with display names and masked phones
  only. A unit test asserts the serialised snapshot contains no phone number
  (the scrubber's regex) and no customer name.

Performance: p95 under 800 ms on the `full` demo dataset, measured in an
integration test (warning in CI, hard fail locally). Add indexes through a
new migration if needed and say which queries needed them. Aggregate in SQL,
not in JavaScript loops over whole tables.

### 3.3 Layout (one screen; desktop-first, must not break on a phone)

1. **Banner and honesty line** when `settings.seedProfile = "demo"`:
   "SIMULATED DATA — generated for testing; no district is running." The
   founders approve the exact wording (§4). Environment badge always.
2. **Attention strip** across the top: one chip per attention category with a
   count; zero-count chips are grey; click filters the page to that category.
   The strip is the handbook's stop-and-fix list made visible.
3. **Flow graph** (centre): columns supplier → riders → hubs → champions →
   customers. Nodes are boxes showing name, status icon, stock units and a
   red lock badge when anything is locked. Edges are drawn only for orders in
   flight, thickness by units, colour by payment state (pending / confirmed /
   review / hold). Clicking a node opens the existing page for it
   (`/admin/stakeholders/<id>`, `/admin/inventory`, `/admin/orders?…`); check
   that champion pages reached this way show customer counts, not names, by
   default. Built with inline SVG rendered on the server (no external
   charting library; CSP unchanged). A focusable table with the same data
   sits beside the graph for screen readers and keyboards.
4. **Right column: live feed** of the last events, newest first, with a
   "Live" indicator, an "as of HH:MM:SS" stamp, and a pause button.
5. **Bottom: tables** — hubs (stock, min, pending in/out, manager, last
   activity), champions (customers, active plans, stalled plans, stock, last
   sale), open edges (orders in flight with age and payment state). Sortable
   by column; filters for area, hub and window apply to everything.

Colour is never the only signal: every status has an icon or text.
Touch targets ≥ 48 px on phone; on phone the columns stack (attention →
tables → feed; the graph becomes the table).

### 3.4 Live behaviour (and the free-tier budget)

- Auto-refresh via a small client component calling `router.refresh()`
  (server components re-render; no client data layer). Default interval
  30 s; refresh **only while the tab is visible**; back off to 60 s after
  10 minutes; stop after 60 minutes idle and show "paused — click to resume".
  Rationale: Neon's free plan meters compute hours and suspends when they are
  used up; a tab left open must not keep the database awake all month
  (verify current limits in Neon docs and cite them in the README).
- A pause button stops it; the tab title shows a dot when new attention
  items appeared since the last view.
- Server-Sent Events are not required; if attempted, verify Vercel's function
  duration limits for the plan first and document them.
- The page is `force-dynamic`; no caching beyond a single request.

### 3.5 Access and privacy

- New policy action `admin.ecosystem.view`, SUPER_ADMIN only, checked
  server-side; the page and the snapshot service both call `authorize`.
- One `admin_action_log` entry per admin session per day ("viewed
  ecosystem"), not per refresh — this screen is read access to every
  stakeholder's name and masked phone.
- No customer is identifiable on this page: counts only, masked phones for
  stakeholders, display names only. No education or health content.
- No exports from this page; use the existing export flow (which shows the
  simulated-data banner when applicable).
- No AI on this page.

### 3.6 Verification for B

- Unit: snapshot Zod schema; label tables cover every ledger event type,
  security event type and admin action type (test enumerates the enums).
- Integration: snapshot on the demo dataset — counts match direct SQL;
  attention counts match the existing admin priorities; no PII in the
  serialised snapshot; p95 timing (warning in CI).
- e2e: as admin, open `/admin/ecosystem`, see the hubs and the banner; click
  hub A → its page; toggle window to 7d → money changes; trigger "Simulate
  one hour" in the simulator, return, wait for refresh, see the feed's newest
  event change; switch to another tab (page hidden) → no refresh requests.
- Accessibility: axe run in the e2e with no serious violations; keyboard
  path through the attention strip and the graph's table equivalent.

### 3.7 Docs for B

README section "Ecosystem view" (what each panel means, the refresh model
and why, what "confirmed" means, the banner); `docs/REVIEW.md` row.

## 4. Founders' decisions and stop conditions

**Decision needed before step 3:** what is this demo for? (a) The Day 8 dry
run and internal training — then `small` scale is enough and the banner
wording is internal. (b) Showing partners or funders — then the founders
approve the exact on-screen honesty copy (banner, money labels, "simulated"
wording on `/verify`) before anything is shown outside the team; the ops
rules forbid partnership or traction claims, and a convincing simulation is
how over-claiming happens by accident. Record the decision in
`docs/DECISIONS.md`.

Stop, report with the exact command or decision needed, then continue with
what is unblocked, when:

- Backdating requires changing a database trigger or an append-only rule.
- `small` cannot meet the 90 s budget on Neon free — propose reduced counts
  and ask.
- A scenario can only be produced by bypassing a service guard.
- Vercel function limits make the refresh model or SSE questionable — verify
  against current docs and record what was verified.
- Deployment Protection cannot be enabled on the founders' plan — then the
  demo profile stays off in the preview and the report says so.

## 5. Order of work and commits

0. **Preconditions (founders):** enable Deployment Protection for previews;
   add `SEED_ADMIN_PASSPHRASE_A/B`, `SEED_ADMIN_TOTP_A/B`, `SEED_FIELD_PIN`
   to the preview environment with fresh values. Confirm in the report.
1. Fail-closed `appEnv()`; `lib/clock.ts` + `lib/clock-override.ts`;
   replacement of `new Date()`; ESLint boundary; guard tests; ADRs. Commit.
2. Seed safety guards (§2.8), env-sourced seed credentials, demo scenario
   modules, manifest, profiles and scales, fake-range guard, integration
   tests. Commit. Only now set `SEED_PROFILE=demo` in the preview environment.
3. Simulator "simulate one hour/day" (with in-process jobs) and "reset to
   demo". Commit. (Founders' decision from §4 recorded by now.)
4. `lib/services/ecosystem.ts`, policy action, snapshot tests, indexes if
   needed. Commit.
5. `/admin/ecosystem` page, visibility-aware refresh, e2e, axe. Commit.
6. Docs, `.env.example`, REVIEW/DECISIONS/GO_LIVE notes. Commit.

Before every push: typecheck, lint, i18n parity, unit, integration, the
existing e2e on `minimal`, and the new e2e on `demo`. The preview redeploys on
push.

## 6. Definition of done

- `SEED_PROFILE=demo` produces the full scenario matrix deterministically,
  under budget, through services only, on an empty database only, with a
  manifest that explains every anomaly; all tests above pass; production is
  untouched; the repository contains no credential usable on a deployed
  environment.
- `/admin/ecosystem` shows nodes, stock, edges, money, attention, system and
  feed for the whole system on one screen, refreshes only while watched,
  degrades to tables on a phone and for screen readers, exposes no PII, and is
  read-only (one log entry per session).
- The founders can open the protected preview, press "Simulate one day"
  twice, and watch the ecosystem view change — with every number traceable to
  a ledger event and the simulated-data banner visible in every screenshot.
- Report at the end: what was generated (counts), timing on Neon, anything
  parameterised down, every ADR added, the founders' decision from §4, and the
  exact Vercel env var changes made or still needed.

## 7. Review log (v1 → v1.1)

| Review item | Verdict | What changed |
| --- | --- | --- |
| C1 settable clock inside auth | Accepted with corrections: the code uses `VERCEL_ENV`, not `APP_ENV`, but the fail-open default ("unset = development") was real | Fail-closed `appEnv()`; override in `lib/clock-override.ts` importable only by `scripts/` and tests (ESLint + test); runtime refusal in production and inside Next; DI through 65 sites judged unnecessary once the set path is absent from the bundle |
| C2 seed into production DB | Accepted, fix adjusted: a host allowlist fails with Neon's per-branch hosts | Content guard (non-`(TEST)` users or unexplained ledger events → refuse) on top of `PRODUCTION_DB_HOST` |
| C3 backdating into hash-chained / time-windowed data | Accepted | `demo` only on an empty database; live ticks forward on the real clock |
| C4 public repo + public preview + seed credentials | Accepted (repo confirmed public) | Env-sourced seed credentials with no defaults outside development; Deployment Protection precondition; reset control typed-confirm, rate-limited, logged |
| H1 no crons on previews | Accepted (verify in Vercel docs) | Ticks run jobs in-process; "manual — preview" heartbeat label |
| H2 refresh burns Neon free tier | Accepted | Visible-only refresh, 30 s default, back-off, idle stop |
| H3 banner keyed on names | Accepted | Keyed on `settings.seedProfile`; also on `/verify` and exports |
| H4 re-scope security review | Accepted | Note in GO_LIVE G5 |
| H5 fake range unverified | Accepted as a documentation fix; already contained because SMS is forced to mock outside production | ADR-025 records the range as unverified and what closes it (TCRA numbering-plan check or aggregator confirmation) |
| Follow-up: lint boundary can be silenced | Accepted | `scripts/check-bundle.ts` fails the build if the override leaks into `.next/` |
| Follow-up: guard before migrations too | Accepted | Content guard runs in `predeploy` before migrating on non-production builds |
| Strategic timing / honesty copy | Accepted | Founders' decision before step 3 (§4); banner wording approved by founders |
| 90 s optimistic | Accepted | `DEMO_SCALE=small` default for builds |
| Viewing not logged | Accepted | One log entry per session per day |
| Determinism wording | Accepted | Spy test only; no ledger-equality claim |
| Time zone | Accepted | Explicit conversion + Sunday / quiet-window / UTC-boundary tests |
| Low items (champion pages, typed reset confirm, p95 soft in CI) | Accepted | Included above |

## 8. Amendment (v1.2): the supplier is a full stakeholder

The supplier — the company or organisation that manufactures or sells the
products to the pilot — must be as visible in the tool and in the demo as the
hubs and champions are. Today it is a thin record (`suppliers`: business name,
area, active flag) plus one login that confirms batches and gets paid. That is
not enough to run a pilot with, or to show one.

### 8.1 Data (migration; data-minimising)

- `suppliers` gains: `contactName` (optional, business contact), `contactPhoneEnc`/`contactPhoneIndex`
  (encrypted like every phone; optional), `leadTimeDays` (integer, default 2),
  `paymentTermsNote` (short text, display only), `notes`. No personal data
  beyond a business contact; nothing about health.
- `supplier_products` (supplierId, productId, `supplierSku` optional, active):
  which products each supplier supplies. A pickup can only be created for a
  product the supplier supplies; the active price list for (area, supplier)
  already prices it.
- Several `SUPPLIER` users may belong to one supplier organisation
  (`users.supplierId` already allows it); the policy stays "sees only its own
  organisation's orders and batches".
- Activating a supplier organisation is a dual-approved action:
  `STAKEHOLDER_ACTIVATE` (the enum value exists and is unused — this gives it
  its meaning). Deactivation is dual-approved too. Money flows to suppliers;
  two admins decide who is one.

### 8.2 Supplier-side app (One Screen rule)

- Home: the one next action — a pickup to prepare (`PICKUP_ASSIGNED` →
  confirm batch ready with seal id), a rider waiting for release
  (`PAID` → confirm release), or "nothing to do".
- Below it, display-only: today's and this week's pickups (state, rider,
  quantity), payments **confirmed by the provider** to this supplier this
  week and this month (never "expected"), and batches with a quality issue
  raised downstream (inspection failures, damaged lots) so the supplier learns
  what came back. Problem reporting already exists.
- Any supplier user of the organisation sees the same organisation view.

### 8.3 Admin

- `/admin/suppliers`: directory (name, area, active, lead time, products,
  users, last pickup, open pickups, quality signal); add/edit reference data;
  request activation/deactivation (dual approval); add supplier users through
  the existing `createUser` flow with `supplierId`.
- `/admin/suppliers/[id]`: organisation profile, users, products, price lists
  (area, supplier), pickups and their outcomes, payments confirmed to the
  supplier (with statement matches), quality issues traced to its batches,
  the activation approval history.
- Pickup creation offers only (supplier, product) pairs from
  `supplier_products` and only active suppliers.

### 8.4 Ecosystem view

Supplier nodes carry: batches prepared and units shipped in the window; TZS
confirmed to the supplier; pickups waiting on the supplier (attention when
`PICKUP_ASSIGNED` is older than the supplier's lead time); quality signal —
share of this supplier's batches with an inspection failure or damage report
in the window; "stale" when no pickup for N days. Edges supplier → riders are
drawn per open pickup as for the other legs. The attention strip gets
"waiting on supplier" and "supplier quality" chips. Tables: a supplier table
next to hubs and champions.

### 8.5 Demo dataset

- Both scales have **two suppliers**: a primary one with a short lead time and
  a good quality record, and an occasional one with a longer lead time whose
  batches carry most of the inspection issues — so the view has a story to
  tell. Names are fictional companies; never a real manufacturer's name or
  anything that could be read as a partnership claim.
- Each supplier has 1–2 users; the second user is enrolled through the SMS
  link flow during the run.
- Supplier-caused anomalies are deliberate and in the manifest: a batch short
  on count (`STOCK_SHORT`), a broken seal, a batch confirmed ready two days
  late, a pickup left `PICKUP_ASSIGNED` past the lead time at the end.
- Supplier payments appear in the statement import with one deliberate
  difference attributable to a supplier payment.

### 8.6 Tests, docs, honesty

- Unit: supplier metrics aggregation; policy per supplier organisation
  (user of supplier A cannot see supplier B's pickup).
- Integration: `STAKEHOLDER_ACTIVATE` for a supplier needs two different
  admins; a pickup for a product the supplier does not supply is refused.
- e2e: the supplier home shows the pickup to prepare; the admin supplier page
  shows the payment after the rider pays; the ecosystem view shows both
  supplier nodes with the quality chip on the second.
- Docs: README (supplier section), REVIEW rows, an ADR for
  `STAKEHOLDER_ACTIVATE` semantics. The handbook calls this role "Supplier"
  (§8A); keep that word in the UI and note that "manufacturer" and "vendor"
  mean the same organisation here.
- Money to suppliers is shown only as **confirmed by the provider**; margins
  are the hub's and champion's business, not shown to suppliers.

### 8.7 Where it fits in the order of work

Supplier data and pages are their own commit between steps 3 and 4
("Step 3b — supplier organisation"); the sale paths and organisation buyers
of §8.8 are the commit after it ("Step 3c — sale paths"); the ecosystem view
(steps 4–5) then consumes both; the demo generator changes ride with 3b and
3c. The review log gains two rows: "Supplier thinly modelled — accepted
(founder request)" and "Chain modelled as a fixed ladder — accepted (founder
clarification, §8.8)".

### 8.8 Amendment (v1.3): how the products actually move

Founder clarification (2026-09-29): the supplier sells mainly to the delivery
drivers — the handbook's boss riders — who distribute to customers directly or
to villages. NGOs, non-profits and other organisations take part. The tool is
the distribution system for feminine-hygiene supplies (disposable pads,
reusable pads, cups and other approved menstrual-health items) and it exists
so that the people who take part earn money. And a customer, or any other
stakeholder, who lives close to the factory may simply buy from it directly.

The handbook's ladder — supplier → boss rider → hub → champion → customer
(§8 A–E) — stays the default path and the price-list example. It is not the
only path. Model the chain as a **graph of allowed sales between
stakeholders**, not a fixed ladder.

**8.8.1 Allowed sales — one table of truth.** `lib/domain/sales.ts` exports
`ALLOWED_SALES`: rows of (seller role, buyer role, shape, default enabled).
Every order carries its seller and buyer; the order kind is derived from the
pair. Anything not in the table is refused with a `DomainError` before any
row is written.

| Seller | Buyer | Shape | Default | Note |
|---|---|---|---|---|
| Supplier | Boss rider | bulk | on | handbook A/B (exists: `SUPPLIER_TO_RIDER`) |
| Boss rider | Hub | bulk | on | handbook B/C (exists: `RIDER_TO_HUB`) |
| Hub | Champion | bulk | on | handbook C/D (exists: `HUB_TO_CHAMPION`) |
| Champion | Customer | plan | on | handbook D/E (exists: `CHAMPION_TO_CUSTOMER`) |
| Boss rider | Customer | plan | per area | "village drop": the rider sells directly |
| Supplier | Customer | plan | per area | factory gate: a customer who lives nearby |
| Supplier | Hub / Champion | bulk | per area | factory gate: a stakeholder collects their own stock |
| Supplier / Hub / Boss rider | Organisation | bulk | per area | NGO, non-profit, school, community organisation |

Two shapes only, and they are the two machines that exist today: **bulk** is
the exact-payment sale with pickup or delivery inspection and a custody
transfer (`amountRuleFor` = `EXACT_REMAINING`); **plan** is the customer
sale with installments, one open payment intent and a handover code
(`UP_TO_REMAINING`). Prefer parameterising the two existing machines by the
(seller, buyer) pair over copying them; if that endangers the existing
domain tests, add explicit kinds — either way `ALLOWED_SALES` is the single
place that says what is allowed, and every path has the same invariants:

- No cash. The buyer pays the seller by mobile money; the provider confirms
  it before custody moves (factory release rule, handbook §8A, applies to
  every seller).
- Custody is unbroken: a sale moves a lot from the seller's holding to the
  buyer's; a sale to a customer or an organisation ends the lot's life in the
  system (`HANDED_OVER` / `DELIVERED_TO_ORG`). Nothing is tracked past that.
- Ledger events, exceptions, the verify link and the SMS receipts are the
  same on every path; the review queue, statements and reconciliation see a
  direct sale like any other.
- Policy: the seller sees their sales, the buyer their purchases, admins
  everything; a supplier still never sees downstream margins.
- Earnings: every stakeholder home shows "earned this week / this month" =
  payments **confirmed by the provider** to them minus what they paid their
  sellers in the window, per path. The ecosystem view shows the same per
  node (admins only). Never "expected" earnings.

**8.8.2 Per-area switches.** Each row beyond the handbook ladder is a
per-area setting (`areas.allowedSales`, default: ladder only). Enabling a
path in a real area is a `SETTING_CHANGE` dual approval, because it decides
who earns. The demo profile enables every path in every area so the view has
every node and edge type.

**8.8.3 Prices.** One customer price per (area, product), whoever sells —
a customer never pays more for buying from a rider or at the factory gate,
and never less either (the price rules in the handbook forbid per-seller
customer prices). The seller on a direct sale receives the whole payment;
the margin a hub or champion would have earned is simply not earned. Price
lists gain an `organisation` step price; suppliers may quote it. Whether the
pilot wants direct paths in a real area is the founders' call (§8.8.6).

**8.8.4 Organisations.** A buyer record, not a login: `organisations`
(name, kind: NGO / NON_PROFIT / SCHOOL / COMMUNITY / OTHER, area, contact
name, encrypted contact phone, active; activation is `STAKEHOLDER_ACTIVATE`
dual approval like a supplier). An organisation pays by mobile money, gets
the same SMS receipt and `/verify/[ref]` link a customer gets, and takes
custody at delivery. Nothing about the people the organisation serves is
recorded — no headcounts, no names, no health data. A login for
organisations is a later decision, not this step.

**8.8.5 Demo dataset.** Both scales get: two organisations (fictional names;
"never call any organisation a partner", handbook §11) with bulk orders from
a hub and from the supplier; a rider who does village drops (direct customer
plans in an area without a champion nearby); a few factory-gate sales — two
customers and one champion collecting her own stock. Anomalies in the
manifest: an organisation order unpaid past its due date; a village-drop
handover whose code was never confirmed; a factory-gate sale where the
supplier released before the provider confirmed (an exception, not a
success). The generator's `Manifest.counts` gains one count per path.

**8.8.6 Founders' decisions (record in DECISIONS.md before 3c ships).**
Which paths are enabled in the first real area; what an organisation pays;
whether a rider who sells directly keeps the whole customer margin (default:
yes, it is what the money flow does) or the area sets a different customer
price rule (not allowed by the handbook today). Until decided, real areas
stay ladder-only and only the demo shows the other paths.

**8.8.7 Tests.** Unit: `ALLOWED_SALES` refuses a pair not in the table;
the derived order kind for each row; earnings arithmetic. Integration: a
disabled path in an area is refused; a factory-gate customer sale pays the
customer price and moves custody supplier → customer; an organisation sale
is exact-payment and ends the lot; a supplier user cannot see an
organisation order it did not sell. e2e: a rider records a village drop
from the field app and the customer's verify link shows it; the ecosystem
view shows an organisation node and a dashed direct edge.

## 9. Amendment (v1.4): the district map — "clean SimCity", data-rich

Founder direction (2026-09-29): the bird's-eye view should feel like a clean,
simple SimCity — a picture of the district you can read at a glance, dense
with numbers, nothing decorative. The column graph of §3.3 becomes a
**schematic district map**; everything else on the page stays.

### 9.1 What the map is

- One schematic per service area, laid out by the system, **never a real
  map**: no coordinates, no addresses, no GPS (privacy, §3.5). Left to
  right: the factory (supplier tiles), a road, the hubs as depots along the
  road, each hub's champions as kiosks under it, each hub's customers as a
  neighbourhood block whose dot density is the customer count, and on the
  right the organisations (school / office tiles) and the "direct" customers
  of riders and factory-gate sales.
- Riders are motorbike markers on the road segments that carry orders in
  flight; a marker per open pickup/delivery, sized by units.
- Every tile carries its numbers inside it: units on hand (small crate
  stack + number), open orders, plans active / stalled, TZS confirmed in
  the window, earned in the window (§8.8.1). A padlock on any tile with a
  locked lot. An attention outline (with an icon, never colour alone) on
  tiles the attention strip points at; clicking a chip highlights them.
- Edges: solid for ladder legs, dashed for direct paths (village drops,
  factory gate, organisations); grey pending, green confirmed, amber
  review, red on hold; thickness by units. Hover or focus shows the full
  breakdown; click opens the existing page (§3.3 rule unchanged).
- Movement: markers advance a little along their edge on every refresh
  (a CSS transition, honoured `prefers-reduced-motion`); nothing animates
  when nothing is in flight. No canvas, no WebGL, no charting library;
  server-rendered inline SVG with a `<symbol>` sprite for the pictograms;
  CSP unchanged (§3.3).
- On a demo dataset the map header carries the simulator's "one hour / one
  day" controls (the SimCity speed knob) — the same server actions as
  `/dev/simulator`, admin-only, non-production only, with the same rate
  limit and log.

### 9.2 Simple beats clever

- Flat pictograms, two neutral colours plus the four payment-state accents
  already in use; icon **and** text for every status.
- One legend line. Numbers over glyphs: if a value matters it is printed,
  not encoded in size alone.
- The table twin and the mobile stacking of §3.3 stay; the map is
  `hidden md:block`, the table is the map on a phone and for screen readers.
- Nothing on the map is a customer name or a phone; customers are dots
  and counts.

### 9.3 Tests and docs

- Unit: layout function is pure — given a snapshot it returns tile and
  marker positions; every node gets exactly one tile; edges reference
  existing tiles; two areas never overlap.
- e2e: the map renders for the demo dataset with one tile per hub and a
  marker per in-flight pickup; the attention chip highlights the right
  tiles; axe stays clean; the table twin lists the same nodes.
- README "Ecosystem view" describes the map; the review log gains a row.
- Order of work: after step 3c ("Step 7 — district map"), then a report.

