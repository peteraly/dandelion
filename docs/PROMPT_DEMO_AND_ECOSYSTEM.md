# Dandelion — Build Prompt B: living demo dataset + ecosystem view (v1)

This prompt extends `docs/BUILD_PROMPT.md`. Everything there still applies — the
§3 invariants, the honesty rules, the stop conditions, the "never mark a gate
passed" rule, one commit per milestone. Where this prompt and BUILD_PROMPT.md
conflict, BUILD_PROMPT.md wins and the conflict is recorded in
`docs/DECISIONS.md` as an ADR.

Read first: `docs/BUILD_PROMPT.md`, `docs/handbook-v3.1.pdf` (§8, §12, §15,
§18, §20), `docs/DECISIONS.md`, `docs/REVIEW.md`, `lib/domain/types.ts`,
`lib/services/*`, `scripts/seed.ts`, `app/dev/simulator/*`, `app/admin/(dash)/page.tsx`.

## 0. Goal

Two deliverables that turn the pilot from "a working app with seven fake users"
into something a founder can put in front of a partner and say *this is what a
running district looks like*:

- **A. A living demo dataset.** A deterministic generator that populates a
  non-production database with weeks of realistic, mutually consistent activity
  across every stakeholder, every order kind, every payment outcome, every
  exception type and every admin workflow — and can keep the ecosystem moving
  during a live demo ("simulate one more day").
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
   `(TEST)` suffix. Phone numbers come only from the reserved fake range
   `+255 700 00[0-9] [0-9][0-9][0-9]` (`+255700000000`–`+255700009999`); the
   generator refuses any other number. Place names for areas, hubs and streets
   are fictional but Tanzanian in shape, and marked fictional in the manifest.
   No real person, business, till number or address anywhere.
3. **No health data, ever.** Customers have no medical fields (the forbidden
   fields test stays green). Problem reports, notes and exception texts may
   describe stock and payments; they never describe a person's health.
4. **Non-production only.** The generator, the "simulate time" controls and any
   demo banner are hard-guarded by `appEnv() !== "production"` and by the
   existing `refuseIfProduction`. Production gets exactly what it has today.
5. **Deterministic.** A seeded PRNG (`DEMO_SEED`, default `dandelion-2026`)
   makes every run reproducible; two runs with the same seed on empty
   databases produce identical ledgers apart from generated ids.
6. **Honest labels.** Money is always "confirmed by the provider" (mock in the
   demo). Anchoring shows "not anchored" when no chain is configured. Swahili
   strings added here carry `needs_native_review: true`. The ecosystem view
   shows a persistent **DEMO DATA** banner whenever the database contains
   `(TEST)` people.
7. **Read-only view.** `/admin/ecosystem` performs no writes. Its only server
   actions are filter changes.
8. Everything is tested, typed, linted and documented like the rest of the repo.
   No go-live gate changes status because of this work.

## 2. Deliverable A — living demo dataset

### 2.1 Profiles and scale

`scripts/seed.ts` gains a `SEED_PROFILE` (`minimal` | `demo`).

- `minimal` = today's seed, unchanged (CI and e2e depend on it).
- `demo` = superset of `minimal`. It can run on an empty database **or on top
  of a `minimal` one** (detects the profile in the `settings` table and
  upgrades; never double-applies). `SEED_ON_BUILD=true` with
  `SEED_PROFILE=demo` is what a preview deployment uses.

Default scale (all overridable by env, documented in `.env.example`):

| Thing | Default | Notes |
| --- | --- | --- |
| Service areas | 2 | one urban, one peri-urban; different WASH availability |
| Suppliers | 2 | one primary, one occasional |
| Hubs | 3 | one low-stock, one healthy, one over-stocked |
| Boss riders | 3 | one serves both areas |
| Hub managers | 3 | one per hub |
| Field champions | 12 | 3–5 per hub; one inactive for 10+ days; one newly enrolled with an unused link |
| Customers | 150 | uneven per champion (2–25); one champion with none |
| Products | 3 | 2 disposable, 1 reusable (only where WASH confirmed) |
| Simulated history | 6 weeks | ending "yesterday" in Africa/Dar_es_Salaam |
| Admins | 2 | the existing seed admins; passphrases and TOTP unchanged |

Runtime budget: the full `demo` profile completes in under 90 seconds against
Neon's free tier from a Vercel build (measure; reduce scale defaults if needed
and say so).

### 2.2 Simulated time

The services stamp times with `new Date()` in ~65 places. Backdated history
needs one clock:

- Add `lib/clock.ts` exporting `now(): Date`. Replace every `new Date()` in
  `lib/services`, `lib/payments`, `lib/auth` and `lib/ledger` with `now()`.
  Add a unit test that fails if `new Date()` reappears in those folders.
- `now()` returns the real time unless a **test/seed override** is active. The
  override is only honoured when `appEnv() !== "production"`; in production it
  is a no-op and a security event is logged if anything tries to set it.
- Every timestamp a service writes must be passed explicitly (never left to a
  database `default now()`), so backdating is complete. Audit the schema for
  `defaultNow()` columns written by services and fix the services, not the
  schema. If a trigger in `drizzle/0001_guards.sql` stamps `now()` itself,
  stop and record an ADR before changing it.
- Sessions, OTPs, lockouts and rate limits keep using `now()` too; the
  generator therefore produces realistic login and OTP histories as well.

### 2.3 Scenario coverage (all required)

The generator is organised as scenario modules under `scripts/demo/`, each a
pure function of `(rng, clock, actors)` that calls services. The full profile
must produce **at least** the following, and a manifest
(`scripts/demo/manifest.ts` → written to the `settings` table as
`demoManifest`) lists every deliberate anomaly with its ids so tests can prove
that nothing unexplained appears.

**Supply chain, happy paths (dozens of each)**
- Supplier → rider pickups: assigned → batch ready → accepted → paid (exact) →
  confirmed by verifier → both confirmations → in transit.
- Rider → hub: delivery code → inspection checklist → pass → paid → both
  confirm → stock at hub; margins visible.
- Hub → champion: stock request → hub prepares → paid → both confirm.
- Champion → customer: enrolment with OTP and consent; plans paid in full at
  once; plans paid in 2–5 voluntary installments (amounts rounded to 500/1000
  TZS, gaps of days to weeks); handover with code; receipt; `/verify` works.

**Payment outcomes through the mock provider (each at least three times)**
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
- A reconciliation run per simulated day; the last run produces flags whose
  set equals the manifest's deliberate anomalies (test).
- One provider statement import covering the last simulated week with rows
  that match, differ in amount, are missing in the statement and missing in
  the app — all deliberate and listed in the manifest.
- Ledger events accumulate for everything above. No anchoring is faked: with
  no chain configured, anchors are absent and `/verify` says so honestly.

**Inventory shape**
- Hub A below `minStockUnits` with a pending restock request; hub B healthy;
  hub C over-stocked with an idle champion. Stock ages visible (oldest batch
  per node).

### 2.4 Realism rules

- Activity follows East Africa Time: mornings and early evenings busier;
  Sundays quiet; no activity 23:00–06:00 except the nightly reconciliation.
- ~15% of customer plans stall for 10+ days before resuming; ~5% of payments
  need review; ~3% of deliveries hit an inspection issue; ~2% of users get
  locked at some point. Make these rates parameters.
- Names: fictional Tanzanian-style first and family names with `(TEST)`;
  never reuse a real public figure's name. Streets/villages fictional.
- Swahili texts for problem reports use simple standard Swahili and go into
  `messages/`-style files only if they are UI strings; free-text report bodies
  live in the generator with a `needs_native_review` note in the manifest.

### 2.5 Keep it moving: simulated time in a live demo

Add to `/dev/simulator` (non-production only; existing admin + guard):

- **Simulate one hour** and **Simulate one day**: runs the same scenario
  modules forward from "now" using the real clock for timestamps (no
  backdating), so the ecosystem view visibly changes within a demo. Each tick
  produces a plausible amount of activity for the current hour/day, including
  a small chance of each anomaly type.
- **Reset to demo dataset**: `SEED_RESET=1` semantics, behind an extra
  confirmation and only outside production.
- Every tick writes a `settings.demoTicks` counter and an admin action log
  entry so it is visible that data was generated.

### 2.6 Verification for A

- Unit: scenario modules are deterministic (same seed → same sequence of
  service calls, recorded via a spy).
- Integration (Postgres): run the `demo` profile on an empty DB; assert every
  `ORDER_STATE`, `CUSTODY_STATE`, `PAYMENT_STATUS`, `EXCEPTION_TYPE`,
  approval type and user status appears; assert `reconcileOrder` flags ⊆
  manifest; assert the schema-invariants test still passes; assert no phone
  outside the fake range and no display name without `(TEST)`; assert the
  run completes under the time budget.
- e2e: after the demo seed, the admin home shows non-zero priorities, a hub
  page shows the low-stock warning, `/verify/<ref>` of a generated receipt
  renders, and one full customer plan from the generated data can be
  continued through the UI.
- The existing 17 Playwright tests keep passing on the `minimal` profile.

### 2.7 Docs for A

README "Demo data" section (profiles, env vars, simulator controls, time
budget); `docs/DECISIONS.md` ADR for the clock abstraction and for the fake
number range; `docs/REVIEW.md` updated; `.env.example` updated.

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
- **System.** Job heartbeats (poller, anchor, reconciliation) with freshness;
  anchoring: last anchor or "not configured"; SMS outbox depth (mock);
  provider ids; AI on/off and this month's usage; environment; app version
  (git SHA from `VERCEL_GIT_COMMIT_SHA` when present).
- **Feed.** The last 50 events across `ledger_events`, `security_event_log`
  and `admin_action_log`, each rendered from a typed label table (no free
  text from the database is shown raw), with display names and masked phones
  only. A unit test asserts the serialised snapshot contains no phone number
  (the scrubber's regex) and no customer name.

Performance: p95 under 800 ms on the demo dataset, measured in an integration
test. Add indexes through a new migration if needed and say which queries
needed them. Aggregate in SQL, not in JavaScript loops over whole tables.

### 3.3 Layout (one screen; desktop-first, must not break on a phone)

1. **Attention strip** across the top: one chip per attention category with a
   count; zero-count chips are grey; click filters the page to that category.
   The strip is the handbook's stop-and-fix list made visible.
2. **Flow graph** (centre): columns supplier → riders → hubs → champions →
   customers. Nodes are boxes showing name, status icon, stock units and a
   red lock badge when anything is locked. Edges are drawn only for orders in
   flight, thickness by units, colour by payment state (pending / confirmed /
   review / hold). Clicking a node opens the existing page for it
   (`/admin/stakeholders/<id>`, `/admin/inventory`, `/admin/orders?…`).
   Built with inline SVG rendered on the server (no external charting
   library; CSP stays as is). A hidden-but-focusable table with the same data
   sits beside the graph for screen readers and keyboards.
3. **Right column: live feed** of the last events, newest first, with a
   "Live" indicator, an "as of HH:MM:SS" stamp, and a pause button.
4. **Bottom: tables** — hubs (stock, min, pending in/out, manager, last
   activity), champions (customers, active plans, stalled plans, stock, last
   sale), open edges (orders in flight with age and payment state). Sortable
   by column; filters for area, hub and window apply to everything.
5. **DEMO DATA banner** when `(TEST)` people exist; environment badge always.

Colour is never the only signal: every status has an icon or text.
Touch targets ≥ 48 px on phone; on phone the columns stack (attention →
tables → feed; the graph becomes the table).

### 3.4 Live behaviour

- Auto-refresh every 15 s via a small client component calling
  `router.refresh()` (server components re-render; no client-side data
  fetching layer). A pause button stops it; the tab title shows a dot when
  new attention items appeared since the last view.
- Server-Sent Events are optional and not required; if attempted, verify
  Vercel's function duration limits for the plan and document them.
- The page is `force-dynamic`; no caching beyond a single request.

### 3.5 Access and privacy

- New policy action `admin.ecosystem.view`, SUPER_ADMIN only, checked
  server-side; the page and the snapshot service both call `authorize`.
- No customer is identifiable on this page: counts only, masked phones for
  stakeholders, display names only. No education or health content.
- Viewing is not logged as an admin action (it is read-only), but exports
  from this page do not exist; use the existing export flow.
- No AI on this page.

### 3.6 Verification for B

- Unit: snapshot Zod schema; label tables cover every ledger event type,
  security event type and admin action type (test enumerates the enums).
- Integration: snapshot on the demo dataset — counts match direct SQL;
  attention counts match the existing admin priorities; no PII in the
  serialised snapshot; p95 timing.
- e2e: as admin, open `/admin/ecosystem`, see 3 hubs and the DEMO banner;
  click hub A → its page; toggle window to 7d → money changes; trigger
  "Simulate one hour" in the simulator, return, wait for refresh, see the
  feed's newest event change.
- Accessibility: axe run in the e2e with no serious violations; keyboard
  path through the attention strip and the graph's table equivalent.

### 3.7 Docs for B

README section "Ecosystem view" (what each panel means, the refresh model,
what "confirmed" means); `docs/REVIEW.md` row; screenshots not required.

## 4. Stop conditions (in addition to BUILD_PROMPT.md §2)

Stop, report with the exact command or decision needed, then continue with
what is unblocked, when:

- Backdating requires changing a database trigger or an append-only rule.
- The demo profile cannot meet the 90 s budget on Neon free without a scale
  the founders would not want — propose the scale and ask.
- A scenario can only be produced by bypassing a service guard.
- Vercel function limits make the 15 s refresh or SSE questionable — verify
  against current docs and record what was verified.

## 5. Order of work and commits

1. `lib/clock.ts`, replacement of `new Date()`, the guard test. Commit.
2. Demo scenario modules, manifest, profiles, fake-range guard, integration
   tests. Commit.
3. Simulator "simulate one hour/day" and "reset to demo". Commit.
4. `lib/services/ecosystem.ts`, policy action, snapshot tests, indexes if
   needed. Commit.
5. `/admin/ecosystem` page, live refresh, e2e, axe. Commit.
6. Docs, `.env.example`, REVIEW/DECISIONS. Commit.

Before every push: typecheck, lint, i18n parity, unit, integration, the
existing e2e on `minimal`, and the new e2e on `demo`. The preview redeploys on
push; set `SEED_PROFILE=demo` in the Vercel preview environment when step 2
lands and say so in the report.

## 6. Definition of done

- `SEED_PROFILE=demo` produces the full scenario matrix deterministically,
  under budget, through services only, with a manifest that explains every
  anomaly; all tests above pass; production is untouched.
- `/admin/ecosystem` shows nodes, stock, edges, money, attention, system and
  feed for the whole system on one screen, refreshes live, degrades to tables
  on a phone and for screen readers, exposes no PII, and is read-only.
- The founders can open the preview, press "Simulate one day" twice, and
  watch the ecosystem view change — with every number traceable to a ledger
  event.
- Report at the end: what was generated (counts), timing on Neon, anything
  that had to be parameterised down, every ADR added, and the exact Vercel
  env var change needed for the preview.
