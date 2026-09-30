# Dandelion — Build Prompt H: every step between every stakeholder, prices, demand, and a phone-first app (v1.0)

Founder direction (2026-09-30), in the founders' words:

- *Write prompt and response for the demo to add all steps and actions
  between each stakeholder for a complete demo, for example we can see when
  a text message is sent to someone and a view of their phone and the
  message appearing.*
- *The price is set for some things but may vary for others depending on
  distance or something else?*
- *Yes to everything re what each group faces: update the environment and
  app to account for all scenarios and be fail-proof, seamless like DoorDash
  and Uber.*
- *Clean up the UI/UX more, with progressive loading and smartphone-optimised
  design.*
- *I think deliveries are only made when requested by the end customer, the
  school or other buyer, so the calculations are made downstream from that?
  Or how do DoorDash and Uber do it?*
- Approved in the previous turn: the receipt text must not name the product;
  draft the rules for a plan that stalls, for the founders' approval.

As in Prompts B–G: the response first (Part 1), the build prompt after
(Part 2), then the decisions (Part 3). Status words are used strictly:
**built** means built and tested in software on simulated data; nothing
here has run with real people, real money or a real mobile-money provider.

---

## Part 1 — Response

### 1.1 In one paragraph

Built in this round:
- **A guided walkthrough** at `/admin/demo/journey` follows one sale across
  every stakeholder in 20 steps, from the customer's first text message to
  the factory refilling the hub. Five phones are on screen: customer, local
  seller, hub keeper, delivery partner and supplier. Each phone shows the
  texts arriving (new ones slide in) and what that person's app says they
  should do next.
- **The receipt text no longer names the product.**
- **Restocking follows demand:** each hub gets a suggested pickup worked out
  from what it actually sold. The Stock page shows it; the live demo orders
  by it.
- **Pages load progressively:** a placeholder appears at once on every
  navigation.
- **The admin works on a phone:** a folding menu and a tappable list of
  places instead of the wide map.

To your two questions:
- **Deliveries to buyers are pulled by the buyer. Stock to the hubs is
  pushed ahead of demand, sized by that demand.** That is also how DoorDash
  works underneath (§1.2).
- **Keep the product price fixed per area. If distance costs differ, show
  them openly as a delivery charge by zone, never as a changing product
  price** (§1.3).

### 1.2 Pulled by the buyer, or pushed ahead? How DoorDash and Uber do it

General knowledge, not a study of their systems:

- **DoorDash** is pulled at the front and pushed behind. Nothing is cooked or
  driven until a customer orders, but the restaurant bought its ingredients
  days earlier from its own forecast. The courier is found per order.
- **Uber** is pulled: a ride exists only when someone asks. It keeps drivers
  nearby with incentives and prices that rise when demand is high.
- **What carries over to Dandelion:** the factory is days away and a trip is
  worth making only for a batch, so the chain cannot wait for each customer.
  - **Pulled by the buyer (built):** a customer's plan, a school's or
    organisation's order, a local seller's restock request. Nothing moves to
    a buyer unless that buyer asked.
  - **Pushed ahead to the hubs, sized by demand (built in this round):**
    each hub keeps enough to last until the next pickup could arrive, worked
    out from its own sales (`lib/domain/replenishment.ts`):

    | Quantity | How it is worked out |
    | --- | --- |
    | Daily demand | Units the hub sold in the last 14 days ÷ 14 |
    | Reorder point | The larger of the hub's minimum and daily demand × (lead time + 3 safety days) |
    | Suggested pickup | When stock on hand plus stock on the way reaches the reorder point: enough to last lead time + 3 + 14 days, in packs of 10 |

    The Stock page shows every hub's numbers, with an **Assign pickup**
    button that opens the pickup form already filled in. A person still
    decides. The live demo now orders from the factory by these
    suggestions, not at random.
  - **So yes: the calculations run downstream to upstream.** Sales at the
    edge set each hub's demand, and each hub's demand sets the factory
    pickups.

### 1.3 Prices: fixed, or varying with distance?

**Today (built):**
- There is one price list per area and supplier, with a price at every step:
  supplier → hub → local seller → customer, and an organisation price.
  Changing it needs two admins.
- Every customer in an area pays the same price, and a plan's price is fixed
  the day the plan starts.
- Each person earns the difference between what they pay and what they
  charge.

**Recommendation:**
1. **Keep the product price the same for every customer in an area.** For an
   essential hygiene product, one visible price builds trust and is simpler
   to check. **Never** raise prices with demand, and never price from what
   is known about a person.
2. **If distance changes the cost, say so openly, where it applies:**
   - (a) A distant area can have its own price list; the average transport
     cost is already in its prices. This is possible today.
   - (b) An organisation's bulk delivery far from the hub can carry a
     **delivery charge by zone** (for example within 5 km, 5–15 km, beyond
     15 km), shown before payment and changed only by two admins.
   - (c) A delivery partner's earnings on a long trip can include that zone
     charge, so far villages are worth serving.

   (b) and (c) are not built; they wait on §3.2.

### 1.4 The complete demo: every step between every stakeholder (built)

Open **Walkthrough: one sale** in the sidebar, or **Open the walkthrough** on
the Demo guide. Press **Do it** for each step, or **▶ Play** for one step
every four seconds. Every step is the real service call by the person who
would take it; mobile money and texts are simulated.

| # | Who acts | What happens | Text message → whom |
| --- | --- | --- | --- |
| 1 | Local seller | Signs up a customer, with her consent | 6-digit code → customer |
| 2 | Customer | Reads the code to the seller; phone verified | — |
| 3 | Local seller | Starts a plan; the price is fixed from now on | Price, where to pay, reference → customer |
| 4 | Customer | Pays part by mobile money; the provider confirms | — |
| 5 | Customer | Pays the rest; the provider confirms | "Paid in full, meet your local seller" → customer |
| 6 | Local seller | Starts the hand-over; one unit set aside | One-time hand-over code → customer |
| 7 | Customer | Reads the code; the seller confirms use and care instructions | Receipt, product not named → customer; earnings → seller |
| 8 | Local seller | Asks her hub for five more: demand goes up the chain | — |
| 9 | Hub keeper | Sets the units aside; the price is fixed | — |
| 10 | Local seller | Pays the hub; the provider confirms | — |
| 11 | Hub keeper | Hands over; both confirm count and seal | Earnings → hub keeper |
| 12 | Founder | Assigns a factory pickup sized by the hub's sales (§1.2) | Pickup details → delivery partner |
| 13 | Supplier | Counts, seals and marks the batch ready | — |
| 14 | Delivery partner | Accepts the pickup | — |
| 15 | Delivery partner | Pays the supplier; nothing leaves before the provider confirms | — |
| 16 | Supplier | Releases the batch; the partner checks count and seal; it is on the road | — |
| 17 | Delivery partner | Arrives; shows the delivery code; inspection starts | — |
| 18 | Hub keeper | Inspects: product, count, seal, clean and dry | — |
| 19 | Hub keeper | Pays the delivery partner; the provider confirms | — |
| 20 | Delivery partner | Confirms; the hub is restocked | Earnings → delivery partner |

Notes:
- **The phones.**
  - Each shows the last five texts that person received, with the newest
    ones outlined and sliding in.
  - Everyone except the customer also shows an **App** strip: what their
    app says about this sale and their next action, computed exactly as
    their app does. When it is someone else's move, it says whom they are
    waiting for; before the sale reaches them, it shows their home screen.
  - The customer has no app; she lives on texts. The phones of the people
    the last step touched are outlined and move to the front, so the text
    that just arrived is on screen without scrolling.
  - Each thread opens at the newest text, as on a real phone, and scrolls
    up to older ones.
- **Held apart from the live district.** The walkthrough's orders are kept
  away from the live engine, so nobody else moves them mid-demo.
- **Nobody is played twice.** While someone is signed in to the field app
  (active in the last 30 minutes), the live engine does not act for them:
  it skips their plans, their day and new pickups for them. A founder
  playing a local seller on a phone never sees the demo finish her sale
  for her.
- **The seller sees her stock before she starts a plan.** When she picks a
  product for a customer, each one shows how many she holds, in-stock
  first, and "none with you: ask your hub before the hand-over" otherwise.
  A hand-over without stock is still refused, but she is warned at the
  start, not at the end.
- **A step that cannot run** (someone left, the hub is short) says why in
  plain words and can be tried again, or the walkthrough restarted.
- **Where it is covered by tests.**
  - A demo test runs all 20 steps. Every order must complete; each phone
    must get the texts listed above; the receipt must not name the product;
    and the live engine must leave the walkthrough's plan alone.
  - The screenshot script captures the walkthrough at step 7, at step 12
    and on a phone.

### 1.5 Fail-proof, for each group (from the bottleneck red team)

| Group | What can go wrong | Built | Next (Part 2) |
| --- | --- | --- | --- |
| Customers | Can't pay all at once; privacy on shared phones; losing the phone; a plan that stalls | Voluntary instalments, no credit or fees; price fixed at the start; receipt text without the product (this round); public record without names | Stalled-plan rules (§1.6, H3); lost-phone re-verification; voluntary one-question follow-up after hand-over (H7) |
| Girls under 18 | Sensitive data by law (Personal Data Protection Act 2022) | No age field; decision open | Recommended: reach through schools and organisations only, no personal records, until counsel and a health adviser decide (§3.4) |
| Local sellers | Earning too little after time and transport; running out of stock | Earnings on the home screen; restock requests | Seller restock suggestions from her nearly-paid plans (H4); earnings after costs in the pilot measures |
| Hubs | Running out; overstock | Minimum stock; demand-driven pickup suggestions (this round) | Suggestions on the admin home with one-tap assign (H4) |
| Delivery partners | Long trips not worth it | Earnings per sale | Zone charge for far deliveries (H5, after §3.2) |
| Suppliers | Irregular orders | Lead times; quality tracking | Visible demand forecast per supplier from the same numbers (H4) |
| Organisations and schools | Paying before delivery; proof for funders | Pay in full, then delivery with a receipt; public record | Walkthrough for an organisation order (H1) |
| Everyone | The payment route | Provider-confirmed design; everything runs on a mock provider | **Gate G1 (founders):** merchant till per seller, licensed aggregator, or platform collection with a legal opinion |

### 1.6 Draft: what happens when a plan stalls (for the founders' approval)

Nothing below is built yet. Today:
- Plans have no expiry and no late fees.
- The price is fixed at the start.
- A refund request opens a case but moves no money.
- Reminder consent is recorded, but no reminders are sent.

Proposed rules:

1. **Nothing expires and nothing costs extra.** No deadline, no late fee, no
   interest, ever. (Same as today.)
2. **The price stays what it was the day she started,** even if the price
   list changes. (Same as today.)
3. **Reminders only with her consent:** at most one text a fortnight, in
   Swahili, never mentioning the product, and stopped by replying STOP.
4. **Her money is hers until hand-over.** She can ask for a full refund of
   what she paid, at any time before hand-over, to the number she paid
   from, within 7 days. Two admins approve it. The route depends on G1.
5. **Quiet plans.** After 60 days with no payment, the local seller calls
   once (in person or by phone, not a text). After 90 days the plan is
   marked *paused*, not cancelled. The money stays hers, and she can pay
   again or ask for a refund. No stock is reserved for a plan before
   hand-over, so nothing is lost by waiting.
6. **Lost or changed phone.** The plan belongs to her, not the SIM card. The
   seller verifies the new number with a code sent to the new phone, and
   two admins approve the change. Texts then go to the new number only.
7. **If she moves away or dies,** a family member can ask for the refund.
   Two admins approve it on evidence.

### 1.7 Phone-first and progressive loading (built)

- Every admin and field page shows a loading placeholder the instant a link
  is tapped, while its data streams in; motion stops under reduced-motion.
  - Placeholders sit only on pages that never answer "not found": once a
    page starts streaming, the answer is already "OK", so a detail page
    with a wrong id would say "OK" instead of "not found". List pages live
    in their own route groups (`(list)`, `(home)`) for this reason.
- On a phone the admin menu folds behind one **Menu** button that shows the
  current page. It closes after each choice.
- On a phone the live map becomes a **list of places**, ordered by what
  needs attention, then by what is moving. Each place shows its numbers,
  "live", orders moving and money that just arrived; tapping one opens its
  details as a bottom sheet.
- The walkthrough's phones scroll sideways on a phone and wrap on a laptop.

---

## Part 2 — The prompt: what to build next, in order

Each step keeps every suite green and adds its own test.

### H1 — More walkthroughs

Same engine and phones, new stories:
- **A school's bulk order:** ordered, paid in full, delivered, receipt.
- **A village drop:** a delivery partner sells directly.
- **Problem stories:**
  - a payment the provider flags, resolved by two admins;
  - an inspection problem: batch locked, two admins decide, stock released
    or returned;
  - a stalled plan and a refund (after §1.6 is approved).

Each problem story shows who is told what, on which phone.

### H2 — A phone for anyone, anywhere in the demo

A **Their phone** button in the live map's details panel and on each
person's page opens the same phone view: their last texts and their app's
next action.

### H3 — Stalled-plan rules (after approval)

Build §1.6 as approved:
- the paused state;
- refund cases that move money through the chosen route;
- consent-only reminders with STOP;
- lost-phone re-verification with two-admin approval.

Customer-facing wording goes to the health adviser and counsel first.

### H4 — Demand everywhere

- Hubs below their reorder point appear on the admin home under *Needs you
  now*, with one-tap **Assign pickup**. The delivery partner still has to
  accept.
- A local seller sees *Ask your hub for N* when her nearly-paid plans will
  outrun her stock.
- Suppliers see the coming fortnight's likely pickups.

### H5 — Zone charges for far deliveries (after §3.2)

- A zone per organisation or village; a charge per zone in the price list,
  approved by two admins.
- Shown before payment, on the receipt, and in the delivery partner's
  earnings.

### H6 — Phone-first on every admin page

Below 640 px, tables become cards. Keep one sticky primary action per page
and 48 px touch targets. Check every sidebar page at 393 px with an axe
scan.

### H7 — Hearing from customers

- One voluntary question after hand-over ("Did you get what you needed? 1
  yes, 2 no"), read by the founders, never by the seller.
- An independent customer line.
- Both with consent and without naming the product.

### H8 — The payment route (gate G1)

The founders choose the route. Build the adapter against the provider's
sandbox and test collection, payout, callbacks, refunds and reconciliation,
before any claim of "confirmed by the provider" leaves the demo.

---

## Part 3 — Founders' decisions

1. **Stalled plans:** approve §1.6 as written, or change it.
2. **Distance:** keep one price per area (recommended), plus a zone charge
   for far organisation deliveries (recommended); name the zones and
   charges.
3. **Restock numbers:** 14-day window, 3 safety days, 14 days of cover,
   packs of 10. Confirm them, or set your own per area.
4. **Girls under 18:** schools and organisations only, no personal records
   (recommended), until counsel and a health adviser decide.
5. **Payment route (G1):** a merchant till per seller, a licensed
   aggregator, or platform collection with a legal opinion.

---

## Review log

| Finding | Decision |
| --- | --- |
| "See each step and each person's phone" | **Built:** the 20-step walkthrough with five phones, texts and app status; covered by a demo test and screenshots. |
| "Deliveries only when requested?" | **Answered and built:** buyers pull; hubs are stocked ahead of demand by suggestions from their own sales; a person assigns. |
| "Price varies with distance?" | **Answered:** one product price per area; distance shown openly as a zone charge for far deliveries (decision §3.2); never demand-based pricing. |
| Receipt text named the product | **Fixed:** the receipt says "your order"; an integration test forbids any product name in it. |
| Stalled plans undefined | **Drafted** for approval (§1.6). |
| UI on phones | **Built:** loading placeholders, folding admin menu, places list for the map, walkthrough phones in a carousel. |
| The live engine could finish a sale the presenter was playing | **Fixed:** people signed in to the field app in the last 30 minutes are left alone by the live engine. |
| A seller could start a plan for a product she did not hold, and learn it only at hand-over | **Fixed:** the product picker shows her stock, in-stock first, with a plain warning otherwise. |
| A loading placeholder turned "not found" into "OK" | **Fixed:** placeholders only on pages that never answer "not found"; an end-to-end test checks the 404. |
