# Dandelion — Build Prompt L: a marketplace where every side wins (v1.0)

Founder direction (2026-10-01), in the founders' words:

- *Sellers are the manufacturers, the NGOs and organisations; they will sell to me or to the delivery drivers. There
  is ideally no operating fee, all money stays in the ecosystem, maybe 50 shillings per transaction from the seller to
  the delivery person and the delivery person to the customer, stays with us to fund the operation. We can sell both
  washable and biodegradable pads from one or multiple organisations, NGOs etc. Only the admins can move money and
  collections of funds etc., although drivers and suppliers can monitor and select when to withdraw funds. Girls and
  women or customers in general can join using a signup like DoorDash or Uber to buy pads or supplies from delivery
  drivers. Keep everything in the tool but clean up the UI/UX so it's easy for the admin to do their job.*
- *"4 ok"*: two named safeguarding leads receive confidential reports, and a second admin confirms every local
  seller.
- *Think about the most successful marketplaces, like social media, Uber etc.: make sure incentives and economics and
  everything are aligned to have a successful marketplace.*
- Two sets of ideas to review "that may or may not be right — identify what makes sense and is an improvement": a
  three-sided-marketplace write-up (dukas, schools, bodabodas, daladalas, USSD, vouchers, cross-subsidy, surge pricing,
  algorithmic pay, a blockchain with zero-knowledge vouchers), then a Solidity smart contract with an M-Pesa oracle,
  offline "data mules", and a donor impact dashboard.

As in Prompts B–K: the response first (Part 1), what was built (Part 2), then the decisions only the founders can make
(Part 3). Claims carry the same labels as Prompt J: **Known** (checked in the code or the data), **Assumed** (our
belief, to test in the pilot).

---

## Part 1 — Response

### 1.1 The model in one picture

```
 Makers & NGOs ──(wholesale)──► Delivery partners ──(pack)──► Customers
  (washable,                    Women local sellers            (girls, women,
   biodegradable,               (via hubs, the ladder)          anyone, at a
   one or many)                                                  public place)
        ▲                               ▲                              │
        └──────── paid out ─────────────┴──── Dandelion's account ◄────┘ pays by mobile money
                  (when they ask;                 (holds each share until the hand-over;
                   two admins send)                keeps 50 TZS on two kinds of sale)
```

- Every buyer pays **Dandelion's collection account**. Each seller's share is **held until the goods are handed
  over**, then it is **available**; the seller **asks to withdraw** when they choose; **one admin approves and a
  different admin sends** (Phase 1, ADR-039). Only admins move money. **Known.**
- Dandelion keeps **50 TZS** on *supplier → delivery partner* and *delivery partner → customer* sales, fixed on each
  order when it is made. **Known.**
- Customers **join themselves** in the shop, like a delivery app, and order to a **named public meeting point**; a
  **woman local seller or a delivery partner** in her area accepts (Phase 2 and §2.2). **Known.**

### 1.2 What makes the big marketplaces work — and what that means here

Uber, DoorDash and the social networks look different but live by the same few rules. Here is each rule, translated
to pads in Tanzania.

| Rule | What the big ones do | What it means for Dandelion | Where it stands |
| --- | --- | --- | --- |
| **Liquidity**: an order is answered, fast | Uber measures minutes to pick-up and the share of requests filled | Measure, per area, the share of shop orders a seller takes, how fast, and how many lapse unanswered (demand nobody met) | **Built**: *Shop health* (§2.5) |
| **Supply where the demand is** | Surge pricing pulls drivers to busy places | Not prices (§1.5). Instead: tell sellers holding the product the moment someone orders, and let women local sellers take orders too | **Built**: alerts and local sellers (§2.2, §2.3) |
| **Density before breadth** | Launch city by city; win one before the next | One area at a time; meeting points with a usual day and time (market day) so one trip serves many | **Built**: meeting-point times, requests grouped by place (§2.4) |
| **Trust and safety** | Ratings, ID checks, in-app safety button, money held by the platform | Public places only, a code only she can give, money held until the hand-over, a private "report a problem" that reaches admins and never the seller, a woman-seller-only choice | **Built** (§2.2, §2.6) |
| **Low friction** | Sign up in a minute; reorder in one tap | Join with a phone and a code; "Order again" | **Built** (Phase 2, §2.7) |
| **Repeat use** | Habits; DashPass | Periods come monthly: demand is predictable. Measure who comes back | **Built**: "came back" in Shop health. Monthly reminder SMS waits on §3.4 |
| **A take rate small enough that nobody goes around it** | 15–30 % at Uber/DoorDash, and drivers go around it when they can | 50 TZS on a 4,500 TZS pack is about 1 %. Hard to beat by going around; but see the costs in §1.4 | Fee **Known**; costs **Assumed** |
| **Word of mouth** (social networks) | Invite friends; your friends are here | Girls tell friends; schools, clinics and women's groups introduce the shop. No paid referral rewards (that would be a voucher) | Doc only; Shop health shows "quiet" areas to visit |
| **Proof for the people who pay for scale** | Investors read the metrics | Funders read a public impact page: delivered, how fast, where the money went, and the public record | **Built**: `/impact` (§2.8) |

### 1.3 Does each side win? (incentives)

| Who | Why they show up | Why they stay | What could push them away | What we did |
| --- | --- | --- | --- | --- |
| **Customer** (girl, woman, anyone) | A pack near her, at a public place, at a fixed price, paid in parts if needed | No debt, no late fees, privacy (the SMS never names the product), her code protects her | Waiting with no answer; feeling unsafe; a phone shared at home | Answer-speed metrics and alerts; woman-seller-only; public places; private reports; shop sessions end after a day idle |
| **Delivery partner** | Margin on each pack: customer price − supplier price − 50 TZS (e.g. 4,500 − 3,000 − 50 = **1,450 TZS**) | Orders come to him (alerts) and bunch up on market day; money is held safely and withdrawn when he asks | Too few orders to cover fuel; slow payouts | Alerts, grouped requests; payout queue on the admin home |
| **Woman local seller** | Margin on each pack (the ladder); now also shop orders in her area | More customers than she can find on foot; safer than being alone with strangers (public places) | Being out-competed by delivery partners | Shop orders reach her too; customers can ask for a woman seller only |
| **Maker / NGO** (washable, biodegradable; one or many) | Wholesale volume; paid through Dandelion when the goods change hands | Demand signals (restock suggestions; orders that lapse show unmet demand) | Slow payment; poor demand data | Wallet and payouts (Phase 1); Shop health; restock suggestions (Prompt H/I) |
| **Dandelion** (non-profit) | 50 TZS per qualifying sale | — | Fees that do not cover the cost of running the service (§1.4) | Cost-of-service facts in §1.4; decisions in §3.1 |
| **Funders and partners** | Verified delivery | Live, private-by-design numbers; a public record | Spreadsheets they cannot check | `/impact` and the public record |

### 1.4 The economics: does 50 TZS pay for the service?

**Known** from the code: a shop sale sends the customer **five SMS**, and the seller one more:

| SMS | Parts (160 characters each, in Swahili) |
| --- | --- |
| Order accepted (who, where) | 2 |
| Price and how to pay | 3 |
| Payment confirmed | 2 |
| Hand-over code | 1 |
| Receipt | 1 |
| Seller: "your balance" | 2 |
| Sellers alerted (up to 3, setting) | 1 each |

That is about **11–14 SMS parts per shop sale**, plus one for each sign-in code. A ladder sale (seller-enrolled
customer) is about 9.

**Assumed** (get real quotes): if one SMS part costs *c* TZS, a shop sale costs **11c–14c** in SMS alone. At *c* = 20
TZS that is 220–280 TZS — **four to five times the 50 TZS fee** on that sale. Dandelion also earns 50 TZS on each
pickup, but a pickup carries 20–100 packs, so that adds only 0.5–2.5 TZS per pack. Mobile-money charges (receiving
into the collection account, and sending payouts) come on top; ask the provider.

So the fee alone will not pay for the service at pilot volumes. The levers, cheapest first:

1. **Fewer, shorter SMS.** Done: the organisation messages used "×" and "—", which makes a phone network count every
   70 characters as an SMS part instead of every 160. A filter now replaces them, and a test keeps every message plain
   (§2.9). Next (decision §3.1): merge "order accepted" into the payment SMS, and drop "payment confirmed" for
   shop customers, who see it in the shop. Saves about 4 parts per sale.
2. **A fee per pack, not per order** on supplier → delivery partner (decision §3.1). A pickup of 50 packs would then
   carry 50 × 50 TZS instead of 50 TZS.
3. **A grant for running costs** during the pilot, reported openly on `/impact`.
4. **A cheaper channel** later: WhatsApp or USSD where customers have it (§1.5).

`/impact` shows the fees collected; the founders should add the SMS bill beside it each month.

**Applied (founders, 2026-10-01; Part 3):** fee per pack on supplier → delivery partner (≈ 100 TZS per pack in all), one SMS
instead of two when a shop order is accepted, and a one-part "payment confirmed" — about 8–11 SMS parts per shop sale.

### 1.5 The ideas you shared: what makes sense, what to adapt, what not to do

| Idea | Verdict | Why |
| --- | --- | --- |
| Three-sided marketplace (customers, sellers, carriers) with the platform matching them | **Adopted** | That is what the shop now is (Phase 2), with the metrics that keep it honest (§2.5). |
| Dukas, schools, clinics, pharmacies as "supply nodes" | **Adapted** | As **meeting points** they are named public places (built). As **buyers** of stock they are business buyers (pharmacies, women-owned businesses, schools, NGOs: built in Prompt J). A handling fee paid to dukas is new money going out → decision §3.2. |
| Bodabodas for the last mile | **Adopted** | Delivery partners are exactly this. |
| Daladalas / buses for the long haul, paid on proof of delivery | **Later** | Real and cheap in Tanzania, but it is a new leg ("carrier") with its own hand-over proof and payment. Prompt I's measured road times will show where it pays. |
| USSD menu (*xxx#) for feature phones | **Later, recommended** | It widens the shop to phones without internet. Needs a USSD aggregator and a short code (a cost and a contract, like the SMS gateway G3). The menu can call the same shop service, so no new rules. Until then, local sellers enrol customers without smartphones. |
| Community health workers placing orders for people | **Already there** | Local sellers enrol and serve customers in person (the ladder). |
| Vouchers / free SMS codes for subsidised packs | **Not built** | Founders decided **no vouchers** (Prompt J, 2026-10-01). Donor money can already pay part of a named order, approved by two admins. |
| Cross-subsidy: richer areas pay more to fund rural areas | **Possible now, founders' call** | Each area has its own price list (two admins). Raising town prices to fund villages is a policy choice → §3.3. |
| Surge pricing | **Rejected** | A health necessity at a price that changes with the hour breaks trust and hits girls hardest when supply is short. Pull supply with alerts, local sellers and market days instead; if needed, a fixed, published "hard-to-reach" bonus paid from donor money (§3.2). |
| Algorithmic pay set to the lowest a driver will accept | **Rejected** | It works against the mission and the people the mission depends on. Margins here are fixed, published and the same for everyone. |
| Order batching | **Adopted** | Meeting-point times and requests grouped by place (§2.4). |
| Home delivery in town | **Rejected** | Safeguarding: public places only; we never store an address (§3.9). |
| Star ratings | **Adapted** | Stars need volume and can be weaponised. Instead, a private "report a problem" that goes to admins and safeguarding leads, never to the seller (§2.6). |
| Blockchain tracking of every box (tokens), zero-knowledge vouchers, Hyperledger | **Not needed** | Dandelion already writes a fingerprint of every event to a public blockchain in batches (Prompt E), with no personal data, so donors can check that history was not rewritten. Batches and seals already track every lot; receipts prove every hand-over. Per-box tokens and zero-knowledge proofs add cost and complexity with no gain at pilot scale. |
| The Solidity contract with an M-Pesa oracle | **Not built** | (1) It does not compile: it uses `public void`, which is Java, not Solidity. (2) It writes the duka owner's **phone number** into a public, permanent event log: a privacy breach that cannot be undone. (3) One admin key controls everything, against the two-admin rule. (4) The "zero-knowledge" nullifier is just a value the oracle passes in, so nothing is proven on chain; you are trusting the oracle anyway. (5) An oracle that **sends money automatically** breaks "only admins move money" and needs the G1 legal opinion (National Payment Systems Act, Bank of Tanzania). (6) A transaction per pack costs fees. |
| Offline duka checks a code with a key on the phone (SIM toolkit) | **Rejected** | A six-digit code checked on the seller's own phone can be found by trying all million numbers offline: the protection would be gone. SIM toolkit apps need the mobile network operator. |
| Bluetooth / Wi-Fi "data mules" on bodaboda phones | **Rejected** | Browsers cannot do this, feature phones cannot, and it puts payment records on strangers' phones. |
| Working with poor network | **Adapted, recommended next** | Keep the code check on the server, but let a seller **record a hand-over offline** and send it when the network returns; a wrong code then becomes a problem for an admin, and the money waits until it checks out. Offline notes already work this way. |
| Donor impact dashboard | **Built, honestly** | `/impact` (§2.8): hand-overs, packs to organisations, time to hand-over, money in, paid out, fees, the public record. Small numbers hidden. No made-up "efficiency" percentages: we show only what the data proves. |
| "Off-chain database bridging phones to wallets" | **Not needed** | Phones are already encrypted, with a one-way index to find them; there are no personal wallets. |
| "Risk plan for lost or damaged inventory" | **Already there** | Damaged, wet, short, broken seal or theft locks the batch; two admins resume or return it (Prompt A). |
| "A Python simulation of the full lifecycle" | **Already there** | The demo generator runs weeks of the whole district through the real services, and the live district keeps it moving (Prompts B, G). |

### 1.6 Safeguarding with delivery partners selling to girls

The founders reopened delivery partners selling to customers. These protections stand together:

- **Public places only**, named by admins: a market, a dispensary gate, a school gate. Never an address, never a map
  point. **Known.**
- **Woman local seller only**, if she asks: delivery partners never see that order. **Known.**
- **Her code** is sent only after full payment and read only when she holds her pack. **Known.**
- **Report a problem**, privately: it reaches admins first on their to-do list, never the seller. **Known.**
- **Shared phones**: shop sessions end after a day idle and a week at most; the SMS never names the product. **Known.**
- **Still to do (§3.5)**: name the two safeguarding leads; text them when a safety report arrives; a second admin to
  confirm every local seller and delivery partner (Prompt K, K3).

---

## Part 2 — What was built

### 2.1 Phase 1 (5968161) — money

Dandelion collects every payment; balances held until the hand-over; the 50 TZS fee; wallets; payouts (one admin
approves, a different admin sends). See ADR-039.

### 2.2 Phase 2 (7322576) — the shop

Join with a phone, a code, a name, a public meeting point and consent (never revealing whether a number already has
an account); one order at a time; cancel; orders lapse after 48 hours unanswered; a seller in her area who holds the
product accepts and the sale becomes an ordinary plan, paid to Dandelion's account and handed over with her code.

### 2.3 Women local sellers take shop orders; "woman seller only"

- Local sellers at a hub see the shop orders in their hub's area and accept them from their own stock (it is the
  handbook ladder, so it is always allowed). The shop is open in every area that has a meeting point, a product with a
  price, and either local sellers or delivery partners switched on.
- She can tick **"Hand-over by a woman local seller only"**; delivery partners do not see it and cannot accept it
  (`request_women_only`). Kept in the database as part of the order's terms.

### 2.4 Market days: meeting-point times, requests grouped by place

Admins give a meeting point its usual days and times ("Thursdays 10–12, market day"). Customers see it when choosing;
sellers see requests grouped by place with the time, so one trip serves several.

### 2.5 Shop health and the admin's to-do list

- **Admin → Shop health**, per area, last 30 days: orders, share taken, time to be taken, lapsed (unmet demand),
  waiting now (and the oldest), sellers with stock, customers who came back, woman-seller-only orders, and one plain
  sentence on what to do. Below, everyone waiting, oldest first.
- The admin home's **to-do list** now starts with **customers who reported feeling unsafe**, and adds **customers
  waiting more than 12 hours**. Navigation regrouped: **Today** (to-do list, approvals, problems, live map, brief),
  **Shop & stock**, **Money & proof**, **People & places**, **Settings & records**.

### 2.6 Report a problem

On any accepted order: "I felt unsafe", "I was asked for more money or for cash", or "something else", with an
optional note. It becomes a problem for admins (`SAFETY_CONCERN`, `WRONG_AMOUNT` or `OTHER`), never shown to the
seller; at most three a day per customer.

### 2.7 Seller alerts; order again

- When she orders, up to **3** sellers in her area who hold the product get an SMS (setting `shopAlertSellers`, two
  admins to change; 0 turns it off). The SMS names neither her nor the product.
- **Order again**: one tap repeats her last order (same product, same place) once it is finished.

### 2.8 `/impact` — the public's view

Hand-overs (all time, last 30 days, by kind), packs to organisations, usual days from order to hand-over, active
sellers, areas served, money in, paid out, fees, and the public record. Counts under 10 hidden; the total paid out is
hidden while fewer than 10 people have been paid, so nobody's income can be worked out.

### 2.9 SMS cost: plain characters only

Every outgoing SMS is converted to the basic SMS alphabet ("—" → "-", "×" → "x", curly quotes → straight), so names
typed with special characters do not triple the cost; a test checks every message template in both languages.

### 2.10 Tests

Integration (shop: 12), demo (shop, women-only, safety reports, meeting times), end-to-end (join → order → accept →
pay → hand-over → report → impact → shop health), unit (SMS alphabet).

---

## Part 3 — Founders' decisions (2026-10-01)

The founders accepted the recommendations ("yes as you recommend"), and the verdicts in §1.5 (later / not built).

| # | Decision | What it means | Status |
| --- | --- | --- | --- |
| 1 | **Fee per pack** on supplier → delivery partner sales; 50 TZS per customer sale stays. **Cut two customer texts.** | About 100 TZS per pack (≈ 2 % of a 4,500 TZS pack), up from about 52. A shop order now sends one SMS with who, where, the price and how to pay; "payment confirmed" is one SMS part. Saves about 3 parts per shop sale, 1 per ladder sale. A small running-cost grant is still planned for the first months; SMS quotes to be gathered. | **Built**: setting `platformFeeBasis` = `PACK` (two admins can switch to `ORDER`); `sms.shopPlan`; shorter `sms.customerPaid`. |
| 2 | **No handling fees** for shops or schools yet; **a hard-to-reach bonus for delivery partners later** — donor-funded, fixed per pack, published, only where Shop health shows "slow" after a month of data. | Shops and schools start as free meeting points. | Bonus **not started** (after a month of data; needs G1 like all payouts). |
| 3 | **No cross-subsidy** from town to village prices for now; donor funding for village orders instead (exists, two admins). | Revisit after 3 months of real prices and sales. | No change needed. |
| 4 | **Monthly reminders: yes.** | Only to customers who agreed; about 25 days after the last pack; once per pack and never twice in 30 days; never while an order is open; never naming the product; one SMS part; she switches them on or off in the shop. | **Built**: `lib/services/reminders.ts`, run with the nightly reconciliation (20:00 East Africa time). |
| 5 | **Safeguarding leads**: two women, at least one independent of money and approvals, ideally one with child-protection experience. **Helplines**: national child helpline 116, police 112, the nearest police Gender and Children Desk — each called by the leads before publishing. | The leads' phones are a setting; each lead gets an SMS (report reference, area, meeting point, her first name and phone) whenever a customer reports feeling unsafe. Helplines are a setting shown on the safety page and in the shop once set. | **Built**: settings `safeguardingLeadPhones`, `helplineText` (two admins). **Waiting on the founders** to name the leads and set both. |

Still open from Prompt L: real SMS and mobile-money quotes; the G1 legal opinion before real money; next builds in order of value — offline hand-over, USSD ordering, the carrier leg, viewer accounts for funders (Prompt K, K4); a second admin to confirm every local seller and delivery partner (Prompt K, K3).
