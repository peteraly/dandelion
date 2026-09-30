# Dandelion — Build Prompt G: a district that is always live, run by founders who are not technical (v1.0)

Founder direction (2026-09-30), in the founders' words:

- *I like the simplicity of the role picker, but the admin portal I don't understand yet. It should be intuitive while staying rich in data, transparency and liveness.*
- *I want a complete working ecosystem live on the district map: where each stakeholder is, what is going on, what is being transported where and to whom, and payments and everything, live, visually.*
- *The admin is not technical.*
- *The whole demo and tool should have demo data on every page: organisations, orders, inventory, everything, as if the ecosystem were live and running now.*
- *Call the boss rider "delivery partner"; give the hub manager and the field champion simple one- or two-word names too.*
- *There's no play button, everything is live: 100+ orders and scenarios the tool circulates through, visible live when logged in as admin.*

As in Prompts B–F, the response comes first (Part 1: what is built today and
what it means), the build prompt after (Part 2: what to build next, in
order), then the decisions (Part 3). Nothing here changes a handbook rule:
the money is still simulated, the provider still confirms every payment,
two admins still approve anything important.

---

## Part 1 — Response

### 1.1 In one paragraph

Built and pushed. **The next preview build fills itself with the full demo
district, and the district is running when you open it.** You do not need
to change anything in Vercel. Every admin page has data: 286 orders across
all ten sale paths, 161 customers, 480+ provider-confirmed payments, 60+
reported problems, 70+ approvals, money checks, statements, stock at every
hub and seller, and organisations buying in bulk. While any admin page is
open, the district takes one step a minute on its own: deliveries leave the
factory, travel, are inspected and paid for; customers sign up and pay
instalments; problems are reported and resolved; organisations order, pay
and receive. There is no play button: a green **"Live — the district is
running"** in the sidebar says it is moving. The admin home now answers
first (what needs you, what is happening, everything else in plain words),
and the roles have plain names: **Delivery partner, Hub keeper, Local
seller.**

(Counts are from a local run of the full demo; the preview's exact numbers
depend on the day it is built.)

### 1.2 What you will see, page by page

| Where | What it shows now |
| --- | --- |
| **Admin home** (`/admin`) | *Needs you now*: only what is above zero, most urgent first, one sentence and one button each. *Happening right now*: on the road, waiting to leave, waiting for payment, paid in the last hour, customer plans, events in the last hour, and **Open the live map**. *Everything else*: every page as a card with one line saying what it is for. |
| **Every other admin page** | One line at the top: where you are and what the page is for ("Day to day › Approvals — Anything important needs two admins…"). The sidebar marks the page you are on. |
| **Live district map** (`/admin/ecosystem`) | Every open order is on the map at the step it is at: a motorbike when a delivery partner carries it, a parcel otherwise; its ring is its payment colour; the number beside it is the units. Orders waiting at the same door share one marker with a count, so a busy hub never piles markers on top of each other. A coin on a place's corner is money the provider confirmed there in the last hour. **Click any place**: a panel shows what it holds, what is coming in and going out, at which step, with each payment, and the money that moved in the last hour. A "Moving now" line counts what is on the road, waiting, being inspected, ready to hand over, on hold, and paid. |
| **Orders, Stock, Problems, Approvals, Money check, Statements, Public record, Messages, People, Suppliers, Organisations, Areas, Prices** | Filled by six weeks of history, and changing while you watch (each live step refreshes the page you are on, never while you are typing). |

### 1.3 How "live" works, honestly

- **It is a simulation through the real system.** Every step is the same
  code a real district will run, by the person who would take it (the
  supplier confirms the batch, the delivery partner pays, the hub keeper
  inspects); payments go through the mock provider. The banner stays on
  every screen. Nothing is real money.
- **It runs while someone watches.** A preview has no background server
  (Vercel's scheduled jobs run only on production), so the district moves
  while an admin page is open and in front of someone. It pauses when the
  tab is hidden or after an hour without anyone touching the page, and picks
  up again at the next touch.
- **One step a minute, however many people watch.** One step is one
  simulated hour. The server refuses a second step within the same minute
  and has its own limit (12 per 10 minutes); every step is in the admin log
  (`demo.tick`, marked `auto`).
- **It starts moving before anyone arrives.** The seed ends by running six
  live hours on the real clock, so the first visitor finds deliveries at the
  factory, on the road and at the hubs.
- **Only orders the live engine started are moved.** The history's
  deliberate problems (a batch waiting on a late supplier, a delivery on
  hold, a payment in review) stay where the story put them, so the
  attention list always has something to show.
- **Shared.** Everyone with the preview link sees the same district moving.
- **Cost.** The database stays awake while a page is watched. On Neon's free
  plan compute hours are metered; check the current allowance at
  neon.com/docs if the demo will be left open for long.

### 1.4 What happens on the next build (nothing for you to do)

1. The build sees a preview with the simulator on and chooses the demo
   profile at full size (two areas, three hubs, three delivery partners,
   twelve local sellers, 150 customers, six weeks).
2. Your preview database holds our small starter dataset (fictional people
   only), so the build wipes it and builds the demo district. It never does
   this to production, never to a database that looks real, and never to a
   demo district that is already there: later builds leave it alone. Before
   this change, a second build on a demo preview would have failed; that is
   fixed too.
3. Sessions end with the wipe: open the preview's `/demo` page again and
   choose a role (the open demo is still on).
4. If the demo district cannot be built, nothing is lost: the build checks
   what it needs before wiping anything, and if it still fails half-way it
   puts the small starter dataset back and the preview keeps working. The
   admin home then shows one amber line with the reason, to pass on.

**One caveat carried from Prompt F (finding E1):** Production and Preview
share the same database today, so the production address will show the
same demo district until they are separated (GO_LIVE item 11). Before
launch that is harmless; before any real person's data it must be fixed.

### 1.5 Intuitive for a non-technical founder, without hiding anything

The rule used everywhere: **answer first, details one click away, nothing
removed.**

| Principle | What it looks like |
| --- | --- |
| Answer first | The home and the map open with a few numbers and "what needs you"; tables and history sit below or behind a click. |
| Only what needs action is loud | Zero counts fold away into "N checks all clear"; amber means "look at this", red means "on hold". |
| Plain words | "Reconciliation flags" → **Money that does not match**; "Dead verification jobs" → **Payment checks that stopped**; "Locked batches" → **Stock on hold**; "Silent for 7 days" → **Quiet for a week**; "Anchoring" → **Public ledger**; "Exceptions" → **Problems**; "Inventory" → **Stock**; "Ledger" → **Public record**; "Logs" → **Security log**; "Ecosystem" → **Live district map**. |
| Where am I, what is this for | A one-line guide on every page; the sidebar marks the current page. |
| Click anything | Any place on the map opens its details; any marker opens its order; every number on the home opens its list. |
| Same meaning everywhere | Grey pending, green confirmed by the provider, amber to check, red on hold; icon and words, never colour alone. |

### 1.6 The new names

| In the app (English) | In the app (Swahili) | Internal code (unchanged) | What they do |
| --- | --- | --- | --- |
| Supplier | Msambazaji | `SUPPLIER` | Makes the product; sells at the factory gate and to organisations. |
| **Delivery partner** | **Msafirishaji** | `BOSS_RIDER` | Collects at the factory, delivers to hubs and villages. |
| **Hub keeper** | **Mtunza kituo** | `HUB_MANAGER` | Checks deliveries, keeps the stock, supplies local sellers. |
| **Local seller** | **Muuzaji wa mtaani** | `FIELD_CHAMPION` | Signs up customers, sells on plans, hands over, gives receipts. |

Only what people read changed: role labels, field screens, the map, the
open demo, the customer SMS. The database, code, logs and the handbook keep
the original role codes, so nothing breaks and the audit trail reads the
same. The Swahili names need a native speaker's review (GO_LIVE G6).

### 1.7 Built in this round (acceptance)

- Previews default to the full demo district; a minimal preview filled by
  our seed moves up to it; a demo preview is left alone on later builds
  (`scripts/seed.ts` `seedProfileFromEnv`, `seedDemoProfile`;
  `scripts/demo/run.ts` `scaleFromEnv`).
- Live engine (`lib/demo/live.ts`): factory → delivery partner → hub one
  step per hour, organisation orders ordered → paid → delivered; the seed
  ends with six live hours. Demo test follows one delivery from "being
  prepared" to "handed over at the hub" and sees it on the map.
- Always-on heartbeat, no button (`components/live-district.tsx` in the
  admin layout, `autoTickAction`, one step a minute server-side,
  `settings.demoLastLiveAt`, rate limit `demo:auto` 12/10 min).
- Admin home, page guide, current page in the sidebar, plain labels
  (en/sw); map markers per order, coins, click-to-focus panel, "Moving now".
- Tests: 208 unit (district geometry, stages, coins, focus), 78
  integration, 19 demo-profile, 22 Playwright (admin home, page guide, map
  focus with an axe check), plus the demo screens.

---

## Part 2 — The prompt: what to build next, in order

Each step keeps every suite green and adds its own test. The demo test is
the gate for anything in `lib/demo/`.

### G1 — Every scenario circulates

Today the live loop moves deliveries and organisation orders step by step;
customer sign-ups, instalments, handovers, restocks, village drops, problems
and resolutions happen within one step. Make each of these open *and close*
over several steps so the attention list rises and falls on its own:

1. Local seller restock: requested → hub accepts → paid → handed over, one
   step each.
2. Village drop by a delivery partner: sold → paid → handed over.
3. A payment the provider flags (wrong amount): shows in *Payments to
   check*; two steps later the simulated second founder resolves it, or it
   waits for the signed-in admin to act (G2).
4. Inspection issue: delivery on hold → problem reported → two admins
   approve resume or return → stock released or sent back.
5. A quiet local seller who comes back; a hub running low that gets a
   delivery.

Acceptance: over 60 live steps on the demo dataset, each attention category
is non-zero at least once and returns to its starting count; no order is
left in a state no step moves on from (demo test).

### G2 — The signed-in admin takes part

While the district runs, it should ask the watching founder for things a
founder does: an approval requested by the simulated second founder (price
change, a new organisation, a stakeholder to activate), a payment to decide,
a problem to close. They appear under *Needs you now*; acting on them moves
the district on. Nothing waits forever: after a few steps without action the
simulated second founder handles it and the feed says so.

### G3 — The field apps are live too

The same heartbeat on the field homes of the open-demo roles, so a local
seller sees a customer's instalment arrive, a hub keeper sees a delivery
partner arriving, a delivery partner sees a pickup ready. Field homes
refresh only between actions, never mid-form.

### G4 — Live without anyone watching (decision first)

Options, for the founders (§3.4): (a) keep "live while watched" (today, free);
(b) a scheduled job every 10–15 minutes on a separate demo deployment
(Vercel runs schedules on production deployments only, so the demo would be
its own project with its own database); (c) a GitHub Actions schedule
calling a protected endpoint. (b) or (c) keep the district moving overnight
but keep the database awake: measure compute hours first.

### G5 — Size and variety

Keep `full` as the preview default. Add `DEMO_SCALE=large` (three areas,
five hubs, 400 customers, eight weeks) if investors ask for a bigger
district; check the map stays readable (one band per area, horizontal
scroll) and the build stays under ten minutes on Neon.

### G6 — Plain words on every page

Extend §1.5 from the home and the map to every admin page: table headers,
buttons, empty states and error messages; each page's first line says what
to do there. Swahili review by a native speaker (GO_LIVE G6). A unit test
keeps a short list of banned words out of admin labels ("reconciliation",
"anchoring", "exception", "heartbeat", "intent").

### G7 — Acceptance for the whole round

- A founder who has never seen the app opens `/demo`, enters as Founder, and
  within two minutes can say what needs them, what is moving and where the
  money is, without help (hallway test with two people, notes in
  `docs/REVIEW.md`).
- Every admin page shows data on the demo preview; none says "nothing yet"
  (e2e scan of every sidebar link on the demo dataset).
- The district moves with nobody clicking: two screenshots a minute apart
  differ (e2e on the demo dataset).

---

## Part 3 — Founders' decisions

1. **Names.** Delivery partner / Hub keeper / Local seller (Swahili:
   Msafirishaji / Mtunza kituo / Muuzaji wa mtaani), or your own. Recorded
   in ADR-034; the customer SMS now says "local seller" instead of "Health
   Champion".
2. **Speed.** One simulated hour per real minute (today), or slower / faster.
3. **G4.** Live only while watched (free), or always moving (cost, a
   separate demo project).
4. **Production.** Confirm it never shows the demo once F0.1 separates the
   databases (recommended: it never does).
5. **G2.** Should the live district ask the watching founder to approve
   things (recommended), or only show?

---

## Review log

| Finding | Decision |
| --- | --- |
| "Admin portal not understood" | **Built**: answer-first home, page guide, current page marked, plain labels; all data kept. |
| "Complete ecosystem live on the map" | **Built**: one marker per open order at its real step, payment rings, coins, click-to-focus details, "Moving now". |
| "Demo data on every page, as if live now" | **Built**: previews seed the full district automatically; the seed ends with live steps; a heartbeat moves it while watched. |
| "No play button, 100+ orders" | **Built**: button removed; 286 orders in the full dataset; one live step a minute. Scenario circulation beyond deliveries and organisation orders is G1. |
| "Simpler names" | **Built in the interface**; codes unchanged (ADR-034). |
| A demo preview failed every rebuild after the first | **Fixed**: the demo seed skips a database that already holds the demo district. |
