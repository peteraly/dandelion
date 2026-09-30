# Dandelion — Build Prompt F: red-team everything, a sustainable market, AI-native with people in charge, and a DoorDash-easy experience (v1.0)

Founder ask (2026-09-30): red-team every scenario, good and bad; say how to
build the system and its environment so issues cannot happen, or cannot
hurt; describe how it would work in a perfect world — a sustainable market
for this context — AI-native with a human in the loop; and make the
dashboard keep every element yet be as easy as DoorDash at every step, for
every stakeholder, with incentives. "Fail-proof", defined and built.

As with Prompts B–E: the response comes first (§0–§5), the build prompt
after (§6), then decisions (§7) and the review log (§8). Where this changes
an earlier decision (Prompt C refused incentives), it says so.

---

## 0. The answer on one page

1. **Nothing is fail-proof; this system can be fail-safe.** The standard
   to build to, and test against, is four words — **safe, visible,
   recoverable, bounded** (§1). Most of the money and stock rules already
   meet it by construction. The gaps are mostly in the environment, people
   and market, not the code.
2. **Two current risks come before anything else.** Production and Preview
   point at **the same database**, and the database keeps **6 hours** of
   restore history (Neon free plan). Fix both before a real person or a
   real shilling touches the system (§2.1).
3. **The perfect market is one channel for everyone.** Customers,
   organisations, schools and donors all buy through the same local
   sellers, so subsidies strengthen the champions instead of undercutting
   them. Every shilling is confirmed by the provider and every hand-over by
   two people. Impact funders pay for verified outcomes (§3).
4. **AI-native means AI drafts, explains, forecasts and flags. People
   decide.** It never confirms money, releases stock, approves, changes a
   price or contacts a customer on its own. There are four autonomy levels,
   one kill switch and every call is logged (§4).
5. **DoorDash-easy, kept honest.** Borrow the Dasher side: see the pay
   before you accept, a live step tracker, clear earnings, an availability
   toggle. Add **incentives** paid by the programme for reliability and
   quality, capped and dual-approved. Never reward selling more to one
   customer, never rank people publicly (§5).
6. **Build order:** environment safety → DoorDash-easy core → loss caps
   and safety → incentives → AI co-pilots → market rails (§6).

---

## 1. "Fail-proof", defined

No real system is fail-proof: phones get stolen, people lie, networks go
down. The target is a system in which **every failure is**:

| Property | Meaning | How it is tested |
| --- | --- | --- |
| **Safe** | A failure leaves money and stock where they were. Nothing is released, confirmed or deleted by accident. | State machines refuse illegal moves; the database refuses them again (triggers, checks); tests cover every event × every actor. |
| **Visible** | A failure shows up for the founders within an hour, in plain words. | The attention strip, the security log, reconciliation flags and health checks; a test per exception type proves it surfaces. |
| **Recoverable** | Any mistake can be undone or restored within a day, with a record of who did what. | Append-only logs, dual-approved resolutions, point-in-time restore and a monthly restore drill. |
| **Bounded** | No single person, device, account or outage can cost more than a set limit. | Dual control, per-seller and per-day caps, rate limits, lockouts; tests at each limit. |

Where prevention is possible, the rule is to **make the bad state
impossible to represent**, not to warn about it. Examples already built:
only the provider's verified callback can confirm a payment, stock cannot
leave without full payment and two confirmations, prices come only from a
dual-approved list, and a locked lot cannot move. Where prevention is not
possible (theft, coercion, a lying human), the rule is **deter, detect
fast, limit the damage, recover**.

---

## 2. Red team: every scenario, bad and good

Legend: **Built** = in the code with tests today. **Gap** = to build
(numbered in §6). Likelihood and impact are for the first pilot district.

### 2.1 Environment and operations (fix first)

| # | Scenario | L / I | Today | Prevent / contain |
| --- | --- | --- | --- | --- |
| E1 | **Production and Preview share one database.** A preview build (or its open demo) writes to the same place real data would live. | High / Critical | Both Vercel environments carry the same Neon `DATABASE_URL` | **Gap F0.1**: a separate Neon project (or branch) for Production, its own secrets, no seed variables, no `DEMO_OPEN_ACCESS`; a build check that refuses a production build whose database host equals the preview's. |
| E2 | **Short restore window.** A bad migration or deletion noticed the next morning cannot be undone (free plan: 6 h history). | Medium / Critical | Restore drill documented; free plan | **Gap F0.2**: paid Neon plan with ≥ 7 days point-in-time restore before real data; nightly logical backup to separate storage; restore drill monthly (GO_LIVE G5). |
| E3 | **Data region.** The database is in the US (N. Virginia); Tanzanian personal data leaves the country. | Certain / Legal | G3 lists a transfer impact assessment | **Gap F0.3**: counsel decides region (EU/Africa region if available, verify Neon/Vercel docs) and records the transfer basis before launch. |
| E4 | Misconfigured environment (wrong variable, missing secret). | Medium / High | Fail-closed `appEnv`, `secret()` throws outside dev, seed guards, predeploy guard, bundle check | Keep; add a startup self-check page for admins listing every required setting as ok/missing (no values). |
| E5 | A migration that half-applies (found 2026-09-30 when the schema was wiped by hand). | Low / High | Migrations self-heal a stale journal; tested | Keep; migrations run on a branch copy first (Neon branching) before production. |
| E6 | Preview left public with the open demo on. | Medium / Low (fictional data) | Gated to non-production + switch + seeded data; guards | Deployment Protection on previews after the investor round; GO_LIVE item 10. |
| E7 | Vercel, Neon, SMS gateway or provider outage. | Medium / High | Payments never wait on anchoring; poller retries; offline notes | **Gap F2.5**: a printed "outage card" procedure for champions (take no money in cash; record the customer and come back), status banner driven by health checks. |
| E8 | Founders unavailable (both admins travelling, a lost phone). | Medium / High | Dual approval, passkey + TOTP | Third admin (2-of-3, ADR-007) and a sealed recovery procedure. |

### 2.2 Money

| # | Scenario | Today | Prevent / contain |
| --- | --- | --- | --- |
| M1 | Fake "I paid" screenshot or SMS. | **Built**: "I have paid" is only a claim; only the provider's verified callback or status query confirms. | Keep; the claim never unlocks anything. |
| M2 | Spoofed, replayed or duplicated callback. | **Built**: secret URL token, signature, dedupe on provider transaction, direct status query, security events. | Keep; add IP allow-list once the provider publishes ranges (G2). |
| M3 | Wrong amount, wrong payee, overpayment. | **Built**: exact-amount rules, payee match, review queue, reconciliation flag. | Keep. |
| M4 | Reversal after the product left. | **Built**: reversals reopen plans or orders that have not completed; a completed one becomes a refund case with an exception. | **Gap F2.1**: per-customer and per-seller velocity caps so repeated reversal abuse is bounded. |
| M5 | SIM swap: a thief takes over a champion's number and resets access. | Partly: PIN reset needs an admin, lost-phone lock, new-device OTP alert. | **Gap F2.2**: SIM-swap check at enrolment and PIN reset through the operator's SIM-swap API (verify availability with the provider); re-enrolment after a recent swap needs a call-back. |
| M6 | Collusion (hub and champion, or rider and hub) to invent sales or hide stock. | Partly: dual confirmation, custody chain, reconciliation against statements. | **Gap F2.3**: pattern detection (same payer across many plans, round-trip transfers, sales without handover codes); an AI explainer drafts, a human investigates. |
| M7 | Two admins collude. | Dual approval makes one admin powerless alone; append-only logs; public fingerprints. | Third-party monthly review of the admin log and statement reconciliation; a board member as third signer on the contract Safe. |
| M8 | Donor funds diverted. | **Built**: donor funding needs evidence, a reference, dual approval and a cap; highlighted in logs. | **Gap F5.1**: vouchers redeemable only at champions for named programmes, so funds stay in the channel and are traceable. |
| M9 | Holding customer money (legal risk). | Design keeps money peer-to-peer: the customer pays the seller directly. | G1 decides the route; if the platform ever collects, a legal opinion first. |
| M10 | Price manipulation. | **Built**: prices only from the dual-approved list; database refuses edits. | Keep. |

### 2.3 Stock and product

| # | Scenario | Today | Prevent / contain |
| --- | --- | --- | --- |
| S1 | Theft, short counts, damage in transit. | **Built**: seals, counts, dual confirmation, inspection at the hub, locks with dual-approved resolution. | Keep. |
| S2 | Counterfeit or unsafe product enters the chain. | Suppliers are dual-approved organisations; products are a controlled list. | **Gap F2.4**: supplier certification record (national standards mark, verify with TBS), lot numbers on batches, and a **recall** action that locks every unit of a lot and texts the customers who received it. |
| S3 | Expired or degraded stock. | — | **Gap F2.4**: expiry on batches for disposables; oldest-first prompts; alerts before expiry. |
| S4 | Hoarding or diverting to another market. | Custody chain shows who holds what, and for how long. | "Stock held too long" attention check (built as oldest-batch days); caps per champion. |
| S5 | Stock-outs in villages. | Hub minimum stock, restock requests. | **Gap F4.2**: AI demand forecast per hub; suggested restock for a human to approve. |

### 2.4 People and safety

| # | Scenario | Today | Prevent / contain |
| --- | --- | --- | --- |
| P1 | Pressure or debt-like selling to a customer. | **Built**: no credit, installments are voluntary, no late fees, tone guard on every message, reminders only with consent. | **Gap F1.5**: an independent customer line (SMS short code or call centre, not the seller) and a one-question satisfaction SMS after handover, read by the founders, never by the seller. |
| P2 | Minors as customers (schoolgirls). | Consent is recorded; no age field by design. | **Decision §7.4**: counsel and a health advisor decide. Recommended default: under-18s are reached through schools and organisations (bulk, dignified, no personal records), not individual plans. |
| P3 | Stigma and privacy (menstrual health). | **Built**: no health data; phones encrypted; the public record shows no names; the map shows customers as dots. | Keep; the SMS copy never names the product category on a shared phone (review with native speakers, G6). |
| P4 | Champion or rider safety (travel, cash-free but still targeted). | Cashless by design. | **Gap F2.6**: optional safety check-in for late deliveries, emergency contact, no home addresses stored. |
| P5 | Lost or shared phones. | **Built**: lock from another device with phone + PIN; admin re-enrolment. | Keep. |
| P6 | Low literacy, language. | Swahili first, icons and text, 48 px targets. | **Gap F4.4**: voice notes for problem reports (built behind AI flag), audio hints on key screens. |
| P7 | Admin social engineering ("I'm the founder, reset my PIN"). | PIN reset only by an admin session with a second factor; logged. | A call-back rule to a registered number; written in the runbook. |

### 2.5 Technology and AI

| # | Scenario | Today | Prevent / contain |
| --- | --- | --- | --- |
| T1 | Bug in a state machine lets an illegal move through. | **Built**: pure machines, unit tests per event × actor, database triggers as a second wall. | Add property-based tests that generate random event sequences and assert the invariants. |
| T2 | AI hallucination or prompt injection. | **Built**: AI off by default; one gateway; guards; drafts only; PII scrubbed; evals in CI. | Keep; red-team prompts added to evals each release. |
| T3 | Dependency or supply-chain compromise. | Dependabot; lockfile; `npm audit` in CI. | Pin and review major updates (several Dependabot branches are open now); no install scripts in CI. |
| T4 | Account takeover of an admin. | Passkeys, TOTP fallback, never SMS; short sessions. | Passkeys mandatory for every admin before launch (G5). |
| T5 | Data breach. | Encrypted phones, blind index, minimal schema, forbidden-fields test. | KMS for keys (G5); a pen test (G5). |
| T6 | Blockchain unavailable or fees spike. | Anchoring never blocks payments; events queue. | Keep; alert on the writer wallet balance (built). |

### 2.6 Market and economy

| # | Scenario | Prevent / contain |
| --- | --- | --- |
| K1 | Free NGO distribution undercuts champions and collapses local supply. | One channel: NGOs buy through champions (organisation sales, vouchers), so free-to-the-girl still pays the seller (§3). |
| K2 | Fuel or input prices rise; rider margins turn negative. | Price-list reviews with a margin floor per layer; dual-approved; a "margin below floor" attention check. |
| K3 | Supplier monopoly or unreliable supplier. | Two suppliers per area (built in the demo); supplier quality signal (built); lead-time tracking (built). |
| K4 | Donor dependency. | Target: self-sustaining margins at every layer; donors fund access (vouchers) and outcomes, not operations. |
| K5 | Seasonality (school terms, harvests). | Forecasts per hub; organisation orders planned per term. |

### 2.7 The good scenarios, and their risks

| # | Scenario | What goes right | What to prepare for |
| --- | --- | --- | --- |
| G1 | Fast growth | More districts, more champions earning | Controls must scale first: onboarding by dual approval, training records, caps per new seller. |
| G2 | An NGO or ministry adopts it | Bulk orders through champions; school programmes | Procurement rules, reporting formats, anchored impact reports. |
| G3 | Reusables win | Lower cost per cycle, less waste | Education and WASH guidance (health advisor review, G6); lower repeat sales — champion income shifts to accessories, replacements and organisation sales. |
| G4 | Local manufacturing | Jobs, lower prices | Certification (S2), capacity planning with forecasts. |
| G5 | Results-based financing | Funders pay per verified outcome | Outcomes defined with the funder; data aggregated, anonymised, anchored. |

---

## 3. The perfect world: a sustainable market for this context

**One channel, many buyers, everyone earns, every shilling verified.**

- **Customers** buy from a trusted local woman (the champion) or at the
  factory gate. They see the full price first, and may pay at once or in
  voluntary instalments with no debt. They get the product with a
  hand-over code, and a receipt they can check.
- **Champions, hubs and riders** each earn a transparent margin set by the
  dual-approved price list. They see their earnings before they accept
  work, and earn programme bonuses for reliability and quality (§5.3).
- **Suppliers**, ideally local manufacturers, get predictable demand
  (forecasts), paid pickups and a quality signal they can act on.
- **Organisations, schools, NGOs and government** buy in bulk **through the
  same sellers**. Donor money arrives as **vouchers** redeemable at
  champions, so a free pad for a schoolgirl still pays the woman who sells
  it. The market grows instead of being undercut.
- **Impact funders** pay for verified outcomes: units reached, reuse
  cycles, school-day retention if a partner measures it. The evidence comes
  from provider-confirmed payments, two-person hand-overs and public
  fingerprints.
- **Dandelion** (options for the founders, §7.2): a small, transparent
  platform fee inside the price list; subscriptions for organisations
  running programmes; paid impact reporting. It never takes a cut of
  customers' instalments beyond the published price, and never lends.

What makes it sustainable: margins cover every layer's real costs without
subsidy; subsidies flow through the channel instead of around it; quality
and safety are enforced by the rails, not by trust; and the data needed to
raise outcome funding is produced as a by-product of doing the work.

---

## 4. AI-native, with people in charge

**Principle:** AI makes every person faster and better informed. A person
makes every decision that moves money, stock, prices, access or a message
to a customer.

| Level | AI may… | Examples | Built today |
| --- | --- | --- | --- |
| **L0 — never** | — | Confirm a payment, release stock, approve anything, change a price, delete data, message a customer unreviewed, give health advice | Enforced by the gateway, guards and policy |
| **L1 — draft for a person to approve** | Propose; a named person accepts | Message drafts, problem categories, weekly reviews, investigation notes, restock suggestions, organisation invoices | Messages, problem intake, weekly review |
| **L2 — act visibly, reversible** | Do low-risk work, shown and undoable | Translate, summarise, explain an anomaly, rank the morning priorities with reasons | Brief, anomaly explainer |
| **L3 — watch** | Detect and flag, never act | Fraud patterns (M6), stock anomalies, silent sellers, margin below floor | Deterministic checks today; AI explainers on top |

**Co-pilots by role (to build, F4):**

- **Champion:** voice problem reports in Swahili. An education helper
  answers only from the approved pack. "Customers who asked for a
  reminder" drafts. Nothing about who to sell to.
- **Rider:** a suggested order of stops for today's pickups and deliveries
  (no tracking of the person).
- **Hub manager:** a restock suggestion with its reasons.
- **Supplier:** a demand forecast per product for the next four weeks.
- **Founders:** the morning brief, anomaly explanations, fraud-pattern
  investigation drafts, donor and investor report drafts.

**Controls:** one kill switch (`AI_ENABLED`), a monthly budget, every call
logged with its prompt version, evals in CI including red-team prompts, and
a human-override record on every accepted draft. Every co-pilot has a
working non-AI path, so the AI can be off without harm.

---

## 5. A DoorDash-easy experience, keeping every element

### 5.1 The rule

Every screen answers three questions, in this order: **what is happening,
what do I do next, what do I earn or get.** Everything else stays one tap
away (progressive disclosure), so no element is removed and nothing
crowds.

### 5.2 Pattern by pattern

| DoorDash pattern | Dandelion form | For | Status |
| --- | --- | --- | --- |
| One clear next step | Status + one primary action | every field role | **Built** |
| See the pay before you accept | Every pickup or delivery offer shows "you earn X" from the price list | rider, hub, champion | **Gap F1.1** |
| Accept / decline with a reason | Decline returns the job to the admin at once, with a reason | rider, hub | **Gap F1.2** |
| "Dash now" availability | "Available today" toggle; admins see who is free when assigning | rider, hub | **Gap F1.3** |
| Live order tracker | A step tracker (Assigned → Ready → Paid → Collected → Delivered → Receipt) on every order | all roles; customers and organisations through their SMS link | **Gap F1.4** (timeline built) |
| Earnings tab | Week and month net, received, paid out (built), plus a per-order list and bonus lines | all sellers | Partly built; list in **F1.1** |
| Ratings | **No person-to-person ratings.** Private quality indicators from objective events (on-time %, problems raised, hand-overs confirmed), shown only to the person and admins | all sellers | **Gap F3.2** |
| Promotions and challenges | Programme-funded bonuses for reliability and quality (§5.3) | riders, hubs, champions | **Gap F3.1** |
| Customer tracking link | The receipt/verify link becomes a clear tracker with plain steps | customers, organisations | **Gap F1.4** |
| Merchant tablet | Supplier home: pickups queue, confirmed money, quality | suppliers | **Built** |
| Ops command centre | The bird's-eye view: headline numbers, action-only checks, live map | founders | **Built** (Prompt E) |
| Support chat | Problem report (typed or voice), call and WhatsApp buttons | everyone | **Built** |
| In-app payment | **Refused.** The provider confirms money; the app never holds it | — | by design |
| Surge pricing, tips | **Refused.** One published price list | — | by design |

### 5.3 Incentives: a changed decision, with rules

Prompt C refused gamification. The founders now ask for incentives, and
they can be designed without the harms Prompt C was guarding against.
**Incentives are allowed when all six hold:**

1. **Paid for reliability and quality, never for selling more to one
   customer.** Examples: on-time hub deliveries, zero short counts in a
   month, restocks before minimum, problem reports that were resolved,
   organisation orders delivered on time.
2. **Funded by the programme or a donor, not by customers.** The budget is
   dual-approved, capped per person per month, and published to the
   participants.
3. **Rules are visible in advance**, in Swahili, on the person's earnings
   screen, with progress shown.
4. **Paid through the same rails.** A bonus is a provider payment with a
   reference, logged and reconciled.
5. **No loss-aversion tricks.** No streaks that reset, no countdown
   pressure, no public leaderboards.
6. **Reviewed monthly** for unintended effects (for example, hurrying
   inspections to be "on time").

### 5.4 Per stakeholder, at a glance

| Who | Home shows | Tracker | Earnings / gets | Incentive examples |
| --- | --- | --- | --- | --- |
| Customer (SMS, no app) | — | Tracker link from each SMS | Price, paid, remaining, receipt | None, by design |
| Organisation (SMS, no app) | — | Tracker link per order | Invoice, confirmation, receipt | Term planning reminders |
| Champion | Next step, stock, my day | Every sale and stock order | Net, received, paid out, per sale | Restocked before running out; all hand-overs confirmed |
| Rider | Next pickup or delivery, my day, stock on hand | Every job | Per job, shown before accepting | On-time deliveries; zero short counts |
| Hub manager | Delivery to inspect, champion requests, stock | Every transfer | Per transfer | Inspections within a day; no stock-outs |
| Supplier | Pickups queue, money confirmed, quality | Every pickup | Confirmed per pickup | Batches with no quality issues |
| Founders | Headline numbers, checks, live map, feed | Any order in one click | Money confirmed, margins by layer | Set and approve programmes |

### 5.5 Fail-safe interface rules

1. One primary action per screen. Everything else is secondary or folded.
2. Impossible actions are not shown, or are shown disabled with the reason
   ("waiting for the provider").
3. Irreversible actions need a second step, or a typed word for
   destructive ones.
4. Every action is idempotent: a double tap or a retry applies once
   (built).
5. Reading works offline; nothing that moves money works offline (built).
6. Every error says what to do next, in the person's language.
7. No dead ends: every screen has back, help, call and report.
8. Icons and text together; 48 px targets on field screens; screen-reader
   labels; Swahili first.
9. Every role's happy and unhappy journeys have an end-to-end test. Five
   real users per role test the flow before launch.
10. Privacy-preserving journey analytics (counts of drop-offs per step, no
    identities) show where people get stuck.

---

## 6. The prompt: what to build, in order

Each phase ends with its tests green, the demo profile still passing, and
REVIEW updated. No phase starts before the previous one's founder
decisions are recorded.

**Phase 0 — environment safety (before any real person or money)**

- F0.1 Separate Production database and secrets. Add a build check that
  refuses a production build whose database host matches the preview's.
  No seed or open-demo variables in Production.
- F0.2 Paid database plan with ≥ 7-day point-in-time restore, a nightly
  logical backup to separate storage, and a monthly restore drill.
- F0.3 Data region and transfer basis decided with counsel (G3).
- F0.4 Deployment Protection on previews after the investor round. Open
  demo off anywhere real data could exist.
- F0.5 Passkeys for every admin, a third admin, KMS for keys, a pen test
  (G5).
- F0.6 An admin self-check page: every required setting shown as ok or
  missing, never its value.

**Phase 1 — DoorDash-easy core**

- F1.1 "You earn X" on every offer, plus a per-order earnings list.
- F1.2 Decline with a reason; the job returns to admins immediately.
- F1.3 Availability toggle for riders and hubs; the pickup form shows who
  is free.
- F1.4 An order step tracker on every order page and on the SMS tracker
  link (customers, organisations).
- F1.5 Independent customer line and a one-question satisfaction SMS after
  hand-over, reported to founders only.

**Phase 2 — bounded losses and safety**

- F2.1 Velocity and value caps per customer, per seller, per day. Raising
  a cap needs dual approval.
- F2.2 SIM-swap check at enrolment and PIN reset (provider API, verify
  availability).
- F2.3 Collusion and fraud pattern checks in the attention strip, with an
  investigation workflow.
- F2.4 Supplier certification, lot numbers, expiry, and one-click recall
  with customer SMS.
- F2.5 Outage procedure and a status banner from health checks.
- F2.6 Optional safety check-in for riders and champions.

**Phase 3 — incentives (rules in §5.3)**

- F3.1 A programme bonus rules engine: rule, budget, cap, period; dual
  approval; paid through the provider; reconciled.
- F3.2 Private quality indicators per person.

**Phase 4 — AI co-pilots (levels in §4)**

- F4.1 Fraud-pattern explainers.
- F4.2 Restock and demand forecasts.
- F4.3 Stop ordering for riders.
- F4.4 Swahili voice reports.
- F4.5 Report drafts.

All behind `AI_ENABLED`, with evals, budgets and a non-AI path.

**Phase 5 — market rails**

- F5.1 Donor vouchers redeemable at champions.
- F5.2 Organisation term planning.
- F5.3 Anchored impact reports for results-based funders.
- F5.4 Onboarding for local manufacturers.

**Acceptance for "fail-safe":** for each scenario marked Critical or High
in §2, one automated test or drill proves it is safe, visible, recoverable
and bounded. A red-team session each quarter adds scenarios to this
document.

---

## 7. Founders' decisions

1. Separate production database now (F0.1), and the paid plan (F0.2):
   yes / when.
2. How Dandelion earns (§3): platform fee in the price list, organisation
   subscriptions, impact reporting, or a mix.
3. Incentive programme (§5.3): budget, first rules, who funds it.
4. Minors (P2): schools and organisations only, or individual plans with
   guardian consent (counsel and health advisor).
5. Independent customer line (F1.5): short code, call centre, or partner
   NGO.
6. Third admin and a board member as contract co-signer (E8, M7).

---

## 8. Review log

| Finding | Decision |
| --- | --- |
| "Fail-proof" | Defined as safe, visible, recoverable, bounded; tested per Critical/High scenario. |
| Shared production/preview database | **Open, first priority** (F0.1). |
| 6-hour restore window | **Open** (F0.2). |
| Incentives (Prompt C refused gamification) | **Changed**: allowed under the six rules of §5.3; person-to-person ratings and leaderboards stay refused. |
| AI-native | Four levels; L0 list unchanged from the build prompt; co-pilots behind the existing gateway. |
| Perfect market | One channel for every buyer; subsidies through champions; outcomes funded on verified evidence. |
