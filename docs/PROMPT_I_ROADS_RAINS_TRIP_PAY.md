# Dandelion — Build Prompt I: roads, rains, trip pay, and a chain that works on any road (v1.0)

Founder direction (2026-10-01), in the founders' words:

- *Red team what the tool does well now and what it doesn't, and how it
  could be improved in line with our long-term goal. Right now we're just
  doing sanitary pads, but technically it should work for any kind of
  social enterprise or NGO.*
- *East African markets, Tanzania: sometimes in the city the roads are
  fine, but other times it needs to be distributed to the rural
  countryside with bumpy roads, and all of those variables we need to
  consider — and what the best way is to incentivise and structure the
  environment so that everything just works anyway.*
- *However Uber or DoorDash does it?*
- *Ok* — to writing this up as Prompt I and building the parts that need no
  decision: roads with road type and distance, travel times learned from
  real trips, and demand counted when a hub was out of stock.

As in Prompts B–H: the response first (Part 1), the build prompt after
(Part 2), then the decisions (Part 3). Status words are used strictly:
**built** means built and tested in software on simulated data; nothing
here has run on a real road, with real people or real money.

---

## Part 1 — Response

### 1.1 In one paragraph

Dandelion is strong on **trust**: who holds what, who paid whom, and proof at
every hand-over. Until this round it was weak on **geography, cash and
signal**: it could not tell a paved town street from a muddy village track,
it paid the same for both, it asked everyone to pay up front, and it needed
phone signal at the moment of hand-over. Those are exactly the things that
break in the countryside. This round makes the app see the road and the
rains, learn how long trips really take, and stop reading an empty shelf as
low demand. Paying fairly for hard trips, removing the cash-up-front chain
and handing over without signal come next. Those three need founders'
decisions (Part 3).

### 1.2 What it does well (keep)

- **Custody you can prove.** Every hand-over is counted, sealed and
  confirmed by both sides with a code; stock cannot quietly disappear.
- **Nobody is paid on a promise.** Goods move only after the mobile-money
  provider confirms payment; earnings count confirmed money only.
- **Customers need no app.** She uses texts only. She pays in instalments
  with no interest, and the price is fixed the day she starts. The receipt
  text does not name the product.
- **Two people for anything risky** (prices, areas, new partners, sale paths).
- **Organisations already buy in bulk** (schools, NGOs), and donor-funded
  orders need evidence.
- **Restocking follows demand**, and now the road (§1.6).

### 1.3 Where it broke, worst first — and what happened this round

| # | What broke | Why it matters on a rural road | This round |
| --- | --- | --- | --- |
| 1 | **The app could not see the road.** Hubs had no distance, road type or rainy season. Every trip was assumed to take 1 day. | Far hubs were under-stocked, and slow routes stayed invisible. | **Built (I1–I2):** road and rains per hub and area; a lead time from the plan or the record, whichever is slower. |
| 2 | **Pay ignores distance.** A delivery partner earns the price difference per unit, the same for a hub 5 km away on tarmac as for one 95 km away on dirt. | Partners rationally choose easy trips; rural hubs starve. | **Next (I4), after decisions §3.1–3.2:** trip pay by road and season, shown before accepting. |
| 3 | **Everyone pays cash up front.** The partner pays the factory, the hub pays the partner, the seller pays the hub. | The chain stalls where cash is scarcest: in the villages. | **Next (I6–I7), gated:** payment route G1 and stock on trust (§3.3). |
| 4 | **Hand-over needs signal.** The customer's code arrives by text and expires in 30 minutes, and the seller's app must be online. | In a village without signal, the sale cannot finish. | **Next (I8).** |
| 5 | **An empty shelf looked like low demand.** Suggestions read sales only. | A hub empty for two weeks "sold nothing" and was suggested less: a vicious circle that hits the hardest places first. | **Built (I3):** nights with an empty shelf are not counted as days of demand; what sellers are waiting for is counted as owed. |
| 6 | **A damaged delivery still counted as "on the way".** | A hub whose delivery was locked for weeks looked well supplied. | **Built (I3):** locked deliveries do not count until two admins resolve them. |
| 7 | **The demo topped up hubs at random,** to keep the map moving. | Hubs held "494 days" of stock, which undermines the demand story. | **Built:** the demo restocks by the suggestions. When no hub needs stock, it tops a hub up to at most twice its target, or a school or NGO order keeps the map moving. |
| 8 | **Specific to pads and Tanzania** (product types, inspection wording, +255 phones, shillings, Swahili/English). | Blocks other products and countries later; harmless for the pilot. | **Next (I10):** product types and country settings as data, when a second product or partner is real. |

### 1.4 How Uber and DoorDash do it — and what to copy

Uber and DoorDash work because orders are **dense**: many orders close
together, so it pays to send one courier per order. Where orders are sparse
they charge much more, or do not go. Reaching sparse places is Dandelion's
whole point, so copy **how they pay people**, not **how they price or where
they operate**.

| Uber or DoorDash | Copy? | Dandelion's version |
| --- | --- | --- |
| The customer pays the company; the company pays everyone. Nobody in the middle fronts money (a courier paying a restaurant uses a company card). | **Yes — the most important one** | The buyer or organisation pays; Dandelion pays the factory and the partner; hubs and sellers stop needing cash up front. This is "platform collection" in gate G1 and needs a legal opinion first (§3.5). |
| Pay per trip, more for distance, time and unpopular orders | **Yes** | Trip pay = base + distance by road type + waiting time + rainy-season extra (I4). Amounts from pilot data. |
| Pay shown before accepting | **Yes** | The partner sees the whole route's pay before saying yes. |
| Several orders in one trip | **Yes, even more** | Fixed weekly village routes on market day, carrying every order for those villages (I5). |
| Bonuses for busy times and hard areas | **Yes — paid by us** | A hard-route bonus for remote villages and the rains, funded by the enterprise or donors, never the buyer. |
| "Complete X trips" rewards | **Carefully** | Reward finishing the route on schedule, never speed: on motorbikes on bad roads, speed bonuses hurt people. |
| Ratings and tiers | **Yes, openly** | Reliable partners (on time, exact counts) get first pick of routes and more stock on trust; rules visible to all; removal needs two admins. |
| Customers pay more for distance or busy times | **No** | One price per area, always (ADR-035). |
| Serve only dense areas | **No** | That gap is why Dandelion exists. |
| Couriers carry their own costs | **No** | Rural roads mean punctures, mud and waiting; if trip pay does not cover them, partners quit or skip far villages. |
| Spend investors' money to grow fast | **No** | Kenya's Copia collapsed in 2024 after growing faster than its rural costs allowed: prove one district before the second. |

### 1.5 Who pays for the far villages

Not the customer. Three open sources, together:

1. **Town sales and school or NGO bulk orders** are cheap to deliver and
   leave margin; part of it goes into the delivery budget.
2. **Donors sponsor a route** — "the monthly delivery to Village X". Every
   trip is proven by the custody chain and the public record, which is the
   proof donors want.
3. **The route fee is visible** on the admin side and changed only by two
   admins (once it drives pay).

### 1.6 What was built this round (no decisions needed)

**I1 — Roads and rains.** On **Areas & sale paths**, each area now has
**Roads and rains**:

- tick the months the rains slow the roads in that area;
- for each hub, enter the km from town, the worst stretch of road (paved,
  gravel or dirt) and whether the rains slow it.

It is planning data only: it changes how much stock a hub is told to hold,
**never what anyone is paid**, so one admin records it and every change is
logged with before and after. The moment trip pay uses it, changes must move
under the two-admin rule (I4). Distance is from the district town, never a
location (no coordinates are stored).

**I2 — Lead time from the plan, checked against real trips.**

- **The plan:** the supplier's promised days, plus days on the road. A paved
  or gravel road takes a day and dirt takes two. Over 80 km adds a day. On a
  road the rains slow, in a rainy month, the road days are doubled. Example:
  dirt, 95 km, in the rains = 2 + (2 + 1) × 2 = **8 days**, instead of the
  old flat 3.
- **The record:** for each completed delivery in the last 90 days, the days
  from "pickup assigned" to "on the hub's shelf". The app already
  timestamps both ends.
- **The rule:** with at least 3 recent trips, take the time within which 4
  in 5 trips arrived. Compare it with the plan, and **use the slower of the
  two**. A route slower than planned is planned as slow. A fast record never
  shortens a careful plan, because running out in a village costs more than
  a few extra packs on a shelf.
- **Where to see it:** the Areas page says "Restocking plans for 8 days from
  pickup to shelf", with the real trips under it. The Stock page shows the
  road, the km, "rains now", and whether the time came from real trips.

**I3 — Demand the shelf could not show.**

- **Every night,** with the nightly reconciliation, the app records what
  each hub holds of each product (`hub_stock_days`).
- **Empty days don't count.** Restock suggestions measure demand over the
  days the hub had stock, never fewer than 3. Example: 28 sold in 14 days
  looks like 2 a day, but if the shelf was empty for 7 of those days, it was
  4 a day.
- **What sellers are waiting for counts as already owed,** so it comes off
  the hub's stock position.
- **A delivery locked as damaged or on hold** is not counted as on the way.
- **The Stock page says so:** "Empty 7 days of the last 14: those days are
  not read as low demand", "5 asked for by local sellers and still waiting".

**Demo.** The district's hubs now have roads:

- **Area 1:** the town hub on tarmac (4 km); the second hub 95 km out on a
  dirt road the rains slow. Rains March–May and October–December.
- **Area 2:** peri-urban gravel. Rains November–April.

The demo restocks by the suggestions, so the Stock page reads like a real
district, not a warehouse. In live hours, hubs are restocked only by the
deliveries you can watch on the map, one step an hour.

**Tests.**

- **Unit:** the plan, the record and the slower-of-the-two rule; empty days
  and waiting sellers in the formula.
- **Integration, on a real database:**
  - recording roads (admins only, validated, logged);
  - a dirt road planned longer, twice that in the rains;
  - three real 5-day trips switching the lead time to the record;
  - the nightly record (a second run overwrites);
  - empty days and waiting sellers counted;
  - a locked delivery not counted as on the way.
- **End-to-end:** an admin records a far dirt road on the Areas page and the
  plan grows by two days; the Stock page shows "Dirt · 95 km".
- **Screenshots:** 16b (roads and rains) and 16c (restock suggestions).

**Known limits.**

- **Demo trips are too fast.** The demo's seeded trips finish in hours
  (the seed compresses time), so on the far hub the plan, not the record,
  sets the lead time. I11 makes far trips take real days.
- **No planning for the coming rains yet.** The rains are judged by this
  month only; I9 adds stocking up before the rains.

### 1.7 Beyond pads and beyond Tanzania

What already generalises:

- the custody chain, seals, counts and codes;
- provider-confirmed payments;
- two-admin approvals;
- areas with sale-path switches;
- organisations as buyers;
- the public record;
- restock and lead-time maths.

What is specific today:

- **Products:** product categories (reusable, disposable); the
  water-and-sanitation rule per area; inspection checks such as "clean and
  dry"; hygiene education at hand-over.
- **Country:** +255 phone numbers; prices stored in shillings; Swahili and
  English only; the Dar es Salaam clock.

Recommendation: **don't build a generic platform yet.** When a second
product or partner is real (I10), move these into settings:

- **Product types,** each with its own checks, education, and expiry dates
  or serial numbers where needed (medicines, seeds, solar lamps).
- **A country pack:** currency, phone format, mobile-money providers and
  languages.
- **Free distribution for NGOs:** giveaways with proof of delivery to
  beneficiaries.

---

## Part 2 — The prompt: what to build next, in order

### I4 — Trip pay (after §3.1 and §3.2)

- Pay a delivery partner **per trip**: base + km by road type + waiting
  time + rainy-season extra. Amounts live in a two-admin-approved table per
  area.
- The trip pay is shown **before accepting** and is paid on the hub's
  confirmed receipt, from the delivery budget. It is never added to the
  buyer's price.
- From this point, changes to a hub's road or distance go through the
  two-admin rule, because they now decide pay.
- The ledger records each trip payment like any other.
- **Tests:** the pay table is applied; pay is shown before accepting; the
  buyer's price is unchanged; a road change needs two admins.

### I5 — Scheduled village routes

- A route is an ordered list of hubs or villages and a weekday (market day).
- Orders for those villages are bundled onto the next run. The partner
  accepts the whole route and sees the whole route's pay.
- On demand stays for town; the countryside runs on a schedule.

### I6 — The platform collects and pays out (gate G1)

- The customer or organisation pays the platform; the platform pays
  supplier, hub keeper, local seller and partner their shares on confirmed
  hand-over.
- Nobody in the middle fronts cash.
- Only after the legal opinion in §3.5.

### I7 — Stock on trust (after §3.3)

- Hubs and sellers with a clean record take stock and pay when they sell.
- The limit per person grows with on-time, count-exact hand-overs, and
  shrinks or stops on a locked batch.
- The custody chain makes this auditable, which is the app's real advantage
  here.

### I8 — Hand-over without signal

- Payment is confirmed while in signal (it already is before hand-over).
- The goods hand-over uses a code the seller's phone can check offline,
  recorded on the phone and synced when back in signal.
- Money stays online-only.

### I9 — Stock up before the rains

- In the month before an area's rainy months, raise the days of cover for
  hubs on rain-slowed roads, so they enter the rains full.
- Driven by the rainy months already recorded (I1).

### I10 — Product types and a country pack (when a second product or partner is real)

- Product types as data (checks, education, unit, expiry or serials).
- Country settings as data (currency, phone format, providers, languages).
- A free-distribution sale path for NGOs with proof to beneficiaries.

### I11 — Demo realism for far roads

- The seed makes far, rain-slowed trips take real days, so the record shows
  slow routes and the Areas page can demonstrate "slower than the plan, so
  restocking uses the real time".

---

## Part 3 — Founders' decisions

| # | Decision | Recommendation |
| --- | --- | --- |
| 3.1 | Who funds trip pay on far routes | All three, openly: margin from town and organisation sales, donor "sponsor a route", and the enterprise's delivery budget. Never the buyer. |
| 3.2 | Trip pay amounts | Start with a simple table (town / rural / remote, plus a rainy-season extra). Set the numbers after 4–6 weeks of real trip data from the pilot (the app now records it). |
| 3.3 | Stock on trust (take now, pay when sold) | Yes for hubs and sellers with a clean record, with small limits that grow; stop on any locked batch. |
| 3.4 | Village routes on market days | Which villages, which weekday; agree with the delivery partners. |
| 3.5 | Payment route (gate G1) | Platform collection removes cash up front but may need a licence: a lawyer should confirm what the National Payment Systems Act, 2015 and the Bank of Tanzania require before building I6. |
| 3.6 | When to generalise | After the pilot district's numbers work, with a real second product or partner in hand. |

---

## Review log

| Finding | Decision |
| --- | --- |
| The app could not see roads or rains | **Built:** road, km and rains per hub and area; plan vs record lead time, the slower one used. |
| An empty shelf read as low demand | **Built:** nightly stock record; empty days excluded; waiting requests counted as owed. |
| A locked delivery counted as on the way | **Fixed:** excluded until resolved. |
| Demo hubs piled up stock | **Fixed:** the demo restocks by demand; idle top-ups bounded at twice a hub's target. |
| Pay ignores distance | **Planned (I4)**, after §3.1–3.2. |
| Cash up front at every step | **Planned (I6–I7)**, gated by G1 and §3.3. |
| Hand-over needs signal | **Planned (I8).** |
| Pads- and Tanzania-specific wiring | **Planned (I10)**, when a second product or partner is real. |
