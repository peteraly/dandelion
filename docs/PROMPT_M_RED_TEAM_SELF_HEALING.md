# Dandelion — Build Prompt M: red team of all the work, and an admin list that stays short (v1.0)

Founder direction (2026-10-01), in the founders' words:

- *Write prompt re red team all work, and also note the below. Any issues like the ones below, think about how the
  environment and system can be built where these don't happen, but I understand a human/admin may need to be
  involved for edge cases or specific scenarios.*
- What the admin home showed on the preview: **9** payments to check ("the provider's answer did not match the
  order"), **14** problems reported, **10** money that does not match, **3** deliveries arriving.

As in Prompts B–L: the response first (Part 1), the build prompt (Part 2), the founders' decisions (Part 3). Labels as
in Prompt J: **Known** (measured in the code or data), **Assumed** (to confirm, usually with a provider).

---

## Part 1 — Response

### 1.1 The short answer

The admin home was showing **the same few problems two or three times, and problems already solved that never
closed**. Measured on a full demo district (6 weeks, 304 orders, 2 areas), the list had **34** items:

| On the admin home | Before | What it really was | After this round |
| --- | --- | --- | --- |
| Payments to check | 9 | 8 of the 9 belonged to problems **two admins had already closed**: closing a problem never closed its payment. | **1**: a payment the provider reversed |
| Problems reported | 8 | Real, but 3 of them are field problems the field could settle (§1.4). | **7** |
| Money that does not match | 9 | All 9 were **the same payments** as "payments to check", flagged again every night. | **1**: a customer said she paid; nothing arrived in 21 hours |
| Deliveries | 8 | Normal traffic on the road and at inspection, plus 2 **stuck for 16 and 37 days** that nobody was told about. | **2**: only the stuck ones |
| **Total** | **34** | | **11** |

With the steps in Part 2, about **5** would remain, and those need a person on purpose: a customer who felt unsafe,
suspected theft, a payment the provider reversed, and two water-and-washing (WASH) decisions for an area.

The rule for the whole system: **an item reaches an admin only if it is real, not already listed, owned, closable,
and needs a person.**

### 1.2 Why it happened

- **Loops that never closed.** A payment the provider flagged stays "in review" for the record; that is right. But the
  count of payments to check read that record directly, so it could only grow. **Known; fixed.**
- **One issue, three lists.** A flagged payment created a payment to check, a problem, and every night a "money does
  not match" flag. A problem waiting for the second admin's signature also counted under approvals. **Known; fixed.**
- **Information shown as work.** "Deliveries arriving" listed every delivery on the road. **Known; fixed.**
- **No owner after a decision.** When two admins let a held delivery continue, nobody told the hub keeper, so it sat at
  inspection for weeks. **Known; fixed.**
- **Problems that could be prevented reach the end of the line.** Wrong amounts, wrong numbers and unmatched
  references happen because customers type the amount, the number and the reference themselves. **Known; Part 2.**
- **The demo never tidies up.** The demo district adds problems on purpose to show the tools, and live ticks keep
  adding them, but no simulated admin ever handles one, so a demo always looks like an admin is drowning. **Known;
  Part 2.**

### 1.3 The design: five filters before anything reaches an admin

| Filter | What it means | Example |
| --- | --- | --- |
| **1. Prevent** | Make the mistake impossible. | The customer confirms a payment request with her PIN: the amount, the account and the reference are already filled in. |
| **2. Absorb** | Accept harmless differences automatically. | Paying in parts is allowed. A statement row that arrives a day late is not a mismatch until a day has passed. |
| **3. Heal** | The system retries, expires and closes on its own. | A payment she says she made but that never arrives: polled, then the claim lapses with an SMS to her; nothing for an admin unless money appears. |
| **4. Route** | The person who can fix it gets it first, with a due time. | A short count at the hub goes to the hub keeper, the delivery partner and the supplier to settle in the app. An admin sees it only if they disagree or it is above a value. |
| **5. Escalate or decide** | A person decides only after the due time, or because a person must decide. | A customer who felt unsafe, suspected theft, a reversed payment, money going out, a policy question. |

Two more rules: **count each issue once** (one list, one next step), and **every item has an owner, a due time and a
condition that closes it**.

### 1.4 Queue by queue

**Payments to check** (money problems)

| Cause today | Prevent | Heal | Route | Human |
| --- | --- | --- | --- | --- |
| Wrong amount | Payment request she confirms with her PIN (amount filled in) | Paying in parts is already allowed | — | Overpayment refund (money out) |
| Wrong account (payee) | With every payment to Dandelion's one account, a wrong payee means our own setup is wrong: a **system alarm**, not a list item | — | — | Fix the setup once |
| No matching reference | Payment request with the reference filled in | Match automatically when exactly one open order fits the payer's phone and amount | — | Several possible matches |
| Pending too long | — | Poll; after 24 h the claim lapses and she gets an SMS; reopens if money appears | Her seller is told | Only if the provider shows money that matches nothing |
| Reversed by the provider | — | — | — | **Always** (possible fraud) |

**Assumed** (confirm with the provider under G1): Vodacom M-Pesa, Tigo Pesa and Airtel Money each offer a payment
request ("push") that the customer confirms with her PIN, and a payout API that returns a reference.

**Problems reported**

| Problem | Owner first | How it closes without an admin | Admin only when |
| --- | --- | --- | --- |
| Stock short, seal broken, damaged or wet | Hub keeper, delivery partner and supplier | All three agree in the app: accept the count received, return, or replace; custody follows | They disagree, or the value is above a threshold (setting) |
| Wrong hub | Hub keeper | Redirects to the right hub, or accepts it | The delivery partner disagrees |
| Payment pending too long | System | Closes itself when the payment arrives or the claim lapses | Money appears that matches nothing |
| Customer unwell | Local seller and admin | — | **Always** (health) |
| WASH concern | Area coordinator | — | **Always**: a two-admin decision on product availability |
| Suspected theft | — | — | **Always** |
| Customer felt unsafe | Safeguarding leads (texted at once) | — | **Always** |

**Money that does not match** (reconciliation)

- Never flag what is already on a list. **Built.**
- Fetch the provider's statement every night through its API instead of an admin uploading it; give timing
  differences one day before flagging; send payouts through the provider's payout API with Dandelion's reference so
  every payout matches by itself. **Assumed**: provider APIs, G1.
- A flag clears itself when its condition goes. **Built** (since Prompt A).

**Deliveries**

- Only stuck deliveries are listed: more than 3 days on the road or 1 day at inspection. **Built.** Next: use each
  hub's own learned lead time (Prompt I) instead of fixed numbers.
- The hub keeper is texted when a held delivery may continue. **Built.** Next: the delivery partner and hub keeper
  are nudged before anything is listed for an admin.

**Approvals, payouts, shop orders waiting**

- Approvals need a second admin by design (two-admin rule). Next: a due time, and a reminder to the other admin.
- Payouts need two admins by design. Next: the payout API, so "sent" is confirmed by the provider and not typed.
- Customers waiting more than 12 hours: sellers with stock are already texted when she orders (Prompt L). Next: a
  second text to the next sellers at 6 hours before anything reaches an admin.

### 1.5 Red team of all the work (Prompts A–L)

| # | Finding | Severity | Status |
| --- | --- | --- | --- |
| R1 | Payments to check never closed: closing a problem left its payment counted for ever | High (the main number lied) | **Fixed**: `payment_intents.review_closed_at`, set when the last problem about it is closed by two admins; set once, guarded by the database; old ones backfilled |
| R2 | One payment problem counted up to three times; problems awaiting a second admin counted twice | High | **Fixed**: one definition per list (`PAYMENT_PROBLEM_TYPES`); reconciliation no longer re-flags payments in review; a problem awaiting signature counts only under approvals; the live map and the brief use the same definitions |
| R3 | Deliveries on the road shown as work | Medium | **Fixed**: only stuck deliveries |
| R4 | A held delivery that may continue waited unseen for weeks | Medium | **Fixed**: hub keeper texted; listed if not finished within a day |
| R5 | Payment claims that never arrive need an admin | Medium | **To build** (M2) |
| R6 | Customers type amount, account and reference, so wrong ones are common | Medium | **To build** (M3, after G1) |
| R7 | Field problems go straight to admins | Medium | **To build** (M4) |
| R8 | Problems have no owner, due time or nudge | Medium | **To build** (M5) |
| R9 | The live demo piles up problems that nobody handles | Medium (first impressions) | **To build** (M6) |
| R10 | Anyone can make the shop send code SMS to many numbers (3 per number per 15 minutes; 20 per network per 5 minutes): a cost attack | Medium | **To build** (M7): a cap per hour on shop code SMS, with an alarm |
| R11 | Numbers that joined the shop but never confirmed the code are kept | Low (privacy) | **To build** (M7): deleted after 7 days by the retention job |
| R12 | "Woman local seller" is assumed from the role, not recorded or confirmed | Medium (safeguarding) | **To build** (M8), with the second admin for people (Prompt K, K3) |
| R13 | A lead's phone receives the customer's phone number | Low | By design (she asked for follow-up); recommend a dedicated work phone for each lead |
| R14 | Payouts are recorded by an admin typing the provider's reference | Medium | **To build** after G1: payout API |
| R15 | Statements are uploaded by hand | Medium | **To build** after G1: statement API |
| R16 | Stuck thresholds are fixed numbers | Low | **To build**: the hub's learned lead time |
| R17 | Real payment providers and the key service (KMS) are still stubs | High before launch | Known since Prompt A; gates G1, G5 |
| R18 | SMS cost exceeds fees at pilot volume | Medium | Known (Prompt L §1.4); grant and quotes |

### 1.6 What stays human, on purpose

A customer who felt unsafe · suspected theft · a payment reversed by the provider · money going out (payouts, refunds)
· a WASH decision for an area · a dispute the parties cannot settle · prices, sale paths, settings, new members, donor
funding · anything above a value the founders set. Everything else should close by itself or be closed by the people
it concerns.

### 1.7 How we will know it works

- **Items needing a person per 100 orders**, every week. Demo district: 34 → 11 now → about 5 after Part 2.
- **Items closed by the system this week**, shown on the admin home, so admins can trust what they do not see.
- **Median time to close**, and **items reopened** (a sign that something was closed too early).
- **Admin minutes per week**, estimated by the founders monthly.

---

## Part 2 — The prompt: what to build, in order

- **M1 — Count once, close loops** *(done in this round)*: R1–R4 above; tests in `tests/integration/queues.test.ts`.
- **M2 — Payment claims that heal** *(done)*. A claim pending 24 h (setting) lapses: the customer gets one SMS ("we have not
  received it; if you paid, show your seller the M-Pesa message"); the reconciliation flag clears; a later payment
  confirms a fresh request as today. A matching payment that arrives after the lapse is matched automatically.
- **M3 — Payment requests (push) and auto-matching** *(after G1 and the provider contract)*: payments start from a
  request she confirms with her PIN; unmatched payments are matched when exactly one open order fits the payer's
  phone and amount; a wrong payee becomes a system alarm.
- **M4 — Field settlements.** For stock short, seal broken, damaged or wet, and wrong hub: the people involved choose
  one outcome in the app (accept the count, return, replace, redirect); custody and payment follow; when all agree it
  closes with a ledger event. Disagreement, or a value above `fieldSettleMaxTzs` (setting), goes to admins.
- **M5 — Owners, due times, nudges.** Every problem gets an owner role and a due time by type; an SMS nudge at the due
  time; the admin list shows only overdue items and the "always human" types. The admin home shows "closed by the
  system this week".
- **M6 — A demo that tidies up** *(done)*. In the live district, simulated admins and field people handle items older than a
  day (never safety, theft or reversals, which stay for the visitor to see); fewer problems are injected per hour; the
  demo settles at a realistic list of 3–6 items.
- **M7 — Shop abuse and privacy** *(done)*: shop code SMS capped at 100 an hour with an alarm at 50; unconfirmed shop
  numbers forgotten after 7 days by the retention job.
- **M9 — The next seller** *(done)* (§3.1): a paid shop order not handed over in time passes to the next seller with
  stock, her payment with it; reminder half-way; sellers who pass fewer orders on are asked first.
- **M10 — Pickups by rule**: a restock suggestion becomes a pickup to the most reliable delivery partner with capacity.
- **Prevention** *(done)*: waterproof packing confirmed before a batch can leave; a rain cover confirmed for pickups in
  the rainy months.
- **M8 — Safeguarding records.** A local seller's "woman" status recorded at enrolment and confirmed by the second
  admin (Prompt K, K3); woman-seller-only orders reach only confirmed sellers.

---

## Part 3 — Founders' decisions and direction (2026-10-01)

In the founders' words: *nothing should be done by hand if possible — all automated, and in the tool, with limited to
no creativity; everyone is in the system.* *Payments should settle and be received instantly after they are sent — no
ambiguity.* *The items shouldn't be damaged in the first place.* *The system should be built so that no problems
exist.* *The goal is for the customer to receive the products as soon as possible.*

| # | Question | Decision | Built |
| --- | --- | --- | --- |
| 1 | Field settlement limit | **OK, 100,000 TZS**, but damage must be prevented first | **Prevention built**: a batch cannot be marked ready unless the maker confirms it is packed in a sealed waterproof bag (`batches.packed_waterproof_at`); in the area's rainy months a pickup cannot be accepted without a rain cover (`orders.rain_cover_at`). Settlement by rule (M4) next, with the limit as a backstop. |
| 2 | Payment claims | Make it foolproof; payments settle instantly | **Fallback built**: a claim with no money after 24 h (`paymentClaimLapseHours`) lapses by itself, one SMS to the payer, no reconciliation flag; money that comes later still confirms. **The real fix** is the payment request she confirms with her PIN, confirmed by the provider within seconds (M3), and payouts sent through the provider's payout API — waiting for the provider contract and G1. |
| 3 | Shop code SMS cap | **Half the suggestion: 100 an hour, alarm at 50** | **Built** (`shopCodeSmsPerHour`, `shopCodeSmsAlarm`; the cap counts every request, so it reveals nothing about who has joined) |
| 4 | "Who owns each problem" | No list to approve: problems should not exist; where something unpreventable happens, the system tells the right person | Owners are fixed in the tool (§1.4), not chosen by people; admins see only what always needs a person |
| 5 | Build order, in plain words | Build now what does not need the mobile-money company or the lawyer | Built now: claims that clear themselves, prevention checks, the SMS cap, forgetting unconfirmed numbers, a demo that tidies up. Waiting: paying with only a PIN; payouts and statements arriving by themselves. |

### 3.1 Who carries the stock, and what happens when a seller is late

**Known**: a delivery partner buys stock from the maker (paying Dandelion's account, credited to the maker), carries
it and owns it (custody "with delivery partner"), and resells it — to customers who order in the shop, to hubs and to
organisations. Women local sellers do the same with stock from their hub. Each sale's money is held until the
hand-over, then credited to the seller less the fee.

**Decided (founders, 2026-10-01: "Ok") and built (M9) — the customer receives her pack as soon as possible:**

1. **A deadline, the same for everyone.** Once she has paid in full, the seller has `shopHandoverHours` (24, a
   setting two admins change; 0 = off) to hand over. Both see it: "Hand over by Thu 14:00" on the seller's order
   page, "Juma hands it over by …" in her shop. No free text, no negotiating. *(A promise slot chosen by the seller
   at acceptance — "today" or "market day" — is a possible refinement; the fixed deadline needs nothing from him.)*
2. **A reminder half-way.** One SMS to the seller at half the time: "hand it over by …, or it passes to another
   seller". Never twice.
3. **Then the next seller, by itself.** At the deadline the order is cancelled for him (`REASSIGN`, by the system), a
   pack he had set aside goes back into his stock, and her order reopens to the other sellers in her area who hold
   the product — never to him: he does not see it and cannot take it (`request_passed_on`). Both get one SMS; neither
   names the product. It runs whenever the shop, a seller's list or Shop health is opened, every live-demo hour, and
   every night.
4. **Her money follows her order.** What she paid into Dandelion's account moves to the next seller's order the
   moment he accepts — one permanent row in `order_transfers` (never changed, never deleted; database guard) and an
   `ORDER_REASSIGNED` entry in the public ledger. She does not pay again; the next seller's plan starts paid in full
   with no payment request, and she is told who is coming. The late seller earns nothing (his balance for that order
   is zero; a cancelled order's money never counts as his); the seller who delivers is credited at the hand-over, less
   the fee, as for any sale.
5. **The reliable go first.** Sellers are alerted and listed in order of how few orders passed on from them in the
   last 90 days, then by stock. Reliability earns orders.
6. **When nobody can take it.** A reopened order that no seller takes within 48 hours lapses like any other, and her
   money goes back to her: the system opens the refund for the admins (only admins send money out) and texts her.
   The same when she cancels while waiting. If the price went up meanwhile she pays only the difference; if it went
   down, the difference is opened as a refund. Money paid straight to the late seller (the seller-collects route)
   cannot follow the order; the system opens a case to get it back to her.

Code: `passOnLateShopOrders`, `passOn`, `handoverDueAt` in `lib/services/shop.ts`; `createPlanInTx` (carried payment)
in `lib/services/orders.ts`; `paidTotals`, `creditRows` and reconciliation count transfers; migration
`0014_late_orders_pass_on`. Tests: `tests/integration/late-orders.test.ts`; the demo shows one late seller whose order
passed on and was handed over by a local seller (`tests/demo/demo-profile.test.ts`).

### 3.2 Instant payments, no ambiguity (to build, M3, after G1)

- **In**: she presses "Pay" (or the seller sends the request); her phone shows the payment request with the amount,
  Dandelion's account and the reference filled in; she enters her PIN; the provider confirms to Dandelion within
  seconds; both see "Paid". No "I have paid" button, nothing pending to check, no reference to type.
- **Out**: a payout approved by two admins is sent through the provider's payout API; the member receives it on their
  phone at once; the provider's reference is recorded automatically. Nobody types a reference.
- Until the provider contract: the simulated provider behaves the same way in the demo, and a claim that never turns
  into money lapses by itself after 24 h.

### 3.3 What is still done by hand, and how each goes away

| Done by hand today | Becomes | When |
| --- | --- | --- |
| Customer types amount, account, reference | Payment request confirmed with her PIN | M3, after G1 |
| Admin sends payouts with the provider's tools and types the reference | Payout API, reference recorded | after G1 |
| Admin uploads the provider statement | Statement fetched every night | after G1 |
| Admin assigns pickups (with a suggestion filled in) | Restock suggestion becomes a pickup to the most reliable delivery partner with capacity, by rule | M10 |
| Admins settle damaged or short deliveries | Settlement by rule from the evidence (seal intact and wet → packing; seal broken → the trip), within 100,000 TZS | M4 |
| A shop order a seller never brings | Reminder half-way, then the next seller, her payment with it | **built** (M9) |
| Admins close other stuck items | Reminders, then reassignment by rule | M5 |
| Two admins for prices, sale paths, settings, members, money out | Stays — these are decisions, not chores | — |

## Review log

- 2026-10-01 — Measured on a full demo district (`DEMO_SCALE=full`, seed `demo`): 34 → 11 items with M1. Fixes in
  this round: migration `0012_queues_count_once`, `lib/services/admin.ts` (one definition per list),
  `lib/services/reconciliation.ts`, `lib/services/exceptions.ts` (closing a problem closes its payment; hub keeper
  nudge), `lib/services/ecosystem.ts` and `lib/services/brief.ts` (same definitions).
- 2026-10-01 (later) — Founders' decisions applied: prevention checks (migration `0013_prevent_damage`), payment claims
  that lapse (`lib/services/self-heal.ts`), shop code cap 100/h with alarm at 50, unconfirmed shop numbers forgotten
  after 7 days, the demo tidies up (`lib/demo/tidy.ts`); tests in `tests/integration/self-heal.test.ts`.
- 2026-10-01 (later) — Measured again on a fresh full demo district after these changes: the same four lists show
  **7** items (2 payments to check, 5 problems, 0 money that does not match, 0 deliveries stuck), all from the last
  day — against **34** at the start. Two payouts also wait for a second admin, by design.
- 2026-10-01 (later) — M9 built after the founders' "Ok": late shop orders pass to the next seller with her payment
  (migration `0014_late_orders_pass_on`, ADR-044). Red-team points handled in the same change: only money in
  Dandelion's account follows an order; the late seller can neither see nor take it back; a cancelled order's money
  never counts in a seller's balance; a reopened order that nobody takes refunds her automatically; one order that
  cannot pass on (its stock held in a problem) never blocks the others; the demo keeps one held delivery of each kind
  for visitors instead of tidying every one away.

