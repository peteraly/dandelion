# Dandelion — Build Prompt C: one interface per participant (v1.0)

Founder question (2026-09-30): *what is the interface for all participants —
is it like a DoorDash?* This document is the response first (§1–§3: what to
borrow from a marketplace app, what to refuse, and why) and then the prompt
(§4–§8: what each participant sees, what changes, how it is tested). It is
written against `docs/handbook-v3.1.pdf`, `docs/BUILD_PROMPT.md` and Prompt B
(`docs/PROMPT_DEMO_AND_ECOSYSTEM.md`, §8.8 sale paths); nothing here overrides
a handbook rule.

## 1. Response in one paragraph

No. DoorDash is a consumer marketplace: a customer app, algorithmic dispatch,
live GPS tracking, ratings, tips, surge pricing and in-app payment. Dandelion
is a **distribution system with a verified money trail**: an admin-run supply
chain (supplier → riders → hubs → champions → customers, plus villages,
organisations and the factory gate) where every hand-off is confirmed by both
sides and every payment is confirmed by the mobile-money provider, never by
the app. The right model is closer to a **field job app + SMS** for the
people who move stock, **SMS only** for the people who buy, and **one control
room** for the founders. Three things from DoorDash's *Dasher* side are worth
keeping — one next step at a time, a job you accept, an earnings screen — and
they are already in the app. Everything on DoorDash's consumer side is
either impossible here (no smartphones, no data, no card) or harmful (ratings
of poor customers, pressure, credit).

## 2. What makes sense to borrow (and where it already exists)

| Marketplace pattern | Keep? | Dandelion form | Status |
| --- | --- | --- | --- |
| "Next step" screen for the courier | **yes** | Role home: one status heading, one primary action (One Screen Rule, handbook §7) | built |
| Accept a job | **yes** | Rider: *Pickup available → Accept pickup*; champion: *Request stock* | built |
| Earnings screen | **yes** | Field home card: earned this week / this month, provider-confirmed only, minus what you paid your own sellers | built (3c) |
| Order status timeline | **yes, read-only** | `/verify/<ref>` shows event types and dates; the receipt token shows the customer her own amounts | built; timeline view for field roles is §5.2 |
| Notifications | **yes, as SMS** | Every state change that matters to a person is an SMS from the §18 templates; no push, no app badge | built |
| Map | **only for the founders** | Schematic district map (Prompt B §9, step 7) — where stock and money are, not where a person is | planned (step 7) |
| Job list ("my day") | **yes, small** | Riders and hub managers with more than one open order get a short list under the primary action | built (recent orders list); §5.1 tightens it |
| Photo proof | **no, checklist instead** | Handover and receipt are checklists + SMS codes; no camera permission (CSP/Permissions-Policy already deny it) | built |

## 3. What to refuse, and why

- **No customer app.** Customers have basic phones, prepaid data and shared
  handsets. Their interface is SMS (plan started, payment confirmed, handover
  code, receipt with verify link) and the public verify page, which works on
  any browser and shows no phone numbers. An app would exclude exactly the
  people the programme is for.
- **No ratings or reviews of people.** Champions are not rated by customers
  nor customers by champions; the handbook's quality signals are about
  *stock* (seal, damage, short count) and *money* (review, reversal), and they
  go to admins, not onto a profile.
- **No live GPS tracking.** Location is not collected (Permissions-Policy
  denies geolocation). "Where is the stock" is answered by custody events
  the two parties confirmed, not by a dot on a map. The founders' map is a
  schematic of the district, never a real map.
- **No algorithmic dispatch, no surge, no tips, no in-app payment.** Admins
  assign pickups (dual-approved prices decide the money); riders accept; the
  customer pays the seller directly by mobile money and the provider's
  confirmation is the only truth. Tipping and dynamic pricing would break the
  one-price-list rule and the no-pressure rule.
- **No streaks, badges or leaderboards.** Earnings are shown as a fact, not
  a game. Nothing nudges a champion to sell more to a customer who has paused.
- **No chat.** Free text between participants is a privacy and pressure
  risk; problems go through the problem report (typed, with the admin as the
  reader) and phone calls happen outside the app.
- **No credit and no debt language anywhere** (handbook §9; enforced in
  copy tests).

## 4. Prompt — what each participant sees

The One Screen Rule stays: on a phone, each field role's home has one status
heading, one explanation, one primary action, and short supporting cards. All
copy in Swahili and English; every list item is a 48 px target; every page is
server-rendered and readable without JavaScript. Nothing below adds a new
permission, a new data category or a new way to confirm money.

### 4.1 Supplier (organisation login; several users share it)

- Home: pickups this week (assigned → ready → paid → released), payments the
  provider confirmed this week and month, quality feedback on its batches,
  *Sell to an organisation* when the area allows it.
- Actions: confirm batch ready (seal), confirm release (counted), create an
  organisation order, confirm delivery to the organisation.
- Never shown: hub or champion margins, customer names or numbers.

### 4.2 Rider (Boss Rider)

- Home: the one pickup or delivery that needs the rider now; under it a short
  *My day* list of other open orders (pickups accepted, deliveries en route,
  village stock on hand), then earnings.
- Actions: accept pickup, *I have paid* (a claim, never a confirmation), confirm
  receipt at the factory, open delivery code at the hub; with village drops
  enabled: add customer, start plan, start/confirm handover, sell to an
  organisation.
- Never shown: other riders' work, customer phone numbers in full.

### 4.3 Hub manager

- Home: the delivery to inspect or the champion request to prepare; then stock
  (available, reserved, locked, below minimum), champion requests, this
  week's confirmed money, *Sell to an organisation* when enabled.
- Actions: inspection checklist, pay the rider (claim), confirm receipt,
  prepare champion stock, confirm release, report a problem.

### 4.4 Field champion

- Home: the customer step that needs her now (paid in full → handover; new
  customer enrolled → choose product), then customers, stock, earnings,
  education, problem report.
- Actions: enrol a customer (consent + OTP), start a plan, record a payment
  claim, start and confirm handover (education checklist + customer's code),
  request stock, report a problem, notes (offline-capable, no money).

### 4.5 Customer (no login)

- SMS: plan started (full price, no automatic deductions, no late fees, no
  debt), payment confirmed, handover code, receipt with verify link,
  reminders only with consent and in the handbook's tone.
- Web: `/verify/<ref>` — the record's event types and dates; with the receipt
  token, her own receipt. Nothing else.
- Founders' option (§7): a reply keyword ("HALI" / "STATUS") that answers with
  the plan's paid/remaining amounts by SMS. Off by default.

### 4.6 Organisation (no login)

- SMS: payment details with reference, payment confirmed, receipt with
  verify link.
- Web: `/verify/<ref>`. An admin can print or export the organisation's
  orders from `/admin/organisations/<id>` (existing export rules apply).

### 4.7 Founders / admins (laptop first, phone second)

- Ecosystem view (attention strip, district map, feed, money, system),
  approvals inbox (every dual approval), exceptions, areas & sale paths,
  organisations, suppliers, stakeholders, prices, orders, statements,
  reconciliation, ledger, logs, exports, data requests, morning brief.
- Admin pages stay usable on a phone (tables scroll horizontally; the map is
  replaced by its table twin), but wide tables are laptop work.

## 5. Prompt — changes to make (small, in this order)

### 5.1 "My day" list for riders and hub managers

Under the primary action, list the actor's other open orders (max 8) with
ref, kind, state chip and one verb ("Deliver", "Collect", "Waiting for
payment"). Riders with village stock see the units on hand. No new service:
`recentOrdersFor` already scopes by party; add a state chip and the verb from
`WORKFLOWS`. e2e: a rider with two pickups sees both; the primary action is
still exactly one button.

### 5.2 Order timeline on the field order page

Below the details, the order's ledger events as a vertical list (type label,
date, who confirmed by role — never by name for the other side). Read-only,
from `ledger_events` by `orderId`, labelled through `verify.eventTypes.*`
(already translated). Unit: every ledger event type has a label (exists).
e2e: after a handover the timeline shows plan → payments → handover.

### 5.3 Customer status by SMS keyword (founders' decision, off by default)

Setting `smsStatusKeyword` (default off). When on, an inbound SMS "HALI" from
a customer's verified number answers with the open plan's paid and remaining
amounts, no product names, no debt language. Inbound SMS is a provider
webhook like payment callbacks: signature-checked, rate-limited per number,
logged. Do not build the provider adapter for real telcos yet — the mock
provider gets a `simulate inbound` operation so the path is testable.

### 5.4 Nothing else

No ratings, GPS, chat, push, tips, dispatch, gamification, customer app, or
organisation login. If a reviewer asks for one, point to §3.

## 6. Acceptance

- One Screen Rule holds on every field home after 5.1 (e2e counts primary
  buttons).
- No new permission in `Permissions-Policy`; CSP unchanged.
- No phone number, customer name or margin reaches a role that does not
  already see it (extend the snapshot PII test to the timeline).
- Swahili and English keys in parity (CI gate); copy tests for pressure and
  debt language still pass on new strings.
- Playwright: rider *My day*, order timeline, and — when 5.3 is on — the
  status keyword through the mock provider.

## 7. Founders' decisions (record in DECISIONS.md before 5.3 ships)

1. Customer status by SMS keyword: on or off for the first area; the reply
   text (paid / remaining only, or also next installment date).
2. Whether riders choose among assigned pickups (accept the first, accept any)
   or admins assign one rider per pickup — today: one rider per pickup,
   assigned by an admin.
3. Whether hub managers see other hubs' stock levels (today: no).

## 8. Review log

| Finding | Decision |
| --- | --- |
| "Is it like DoorDash?" | **No** — a field job app + SMS + one control room; borrow only the Dasher-side patterns (§2), refuse the consumer-side ones (§3). |
| Customer-facing app | **rejected** — SMS and the public verify page are the customer interface. |
