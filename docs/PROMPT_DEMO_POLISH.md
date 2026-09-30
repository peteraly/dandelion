# Dandelion — Build Prompt D: an investor-ready demo (v1.0)

Founder ask (2026-09-30): make sure the full demo is polished and clean, not
confusing, ready for investors. As with Prompts B and C, the response comes
first (§1–§3: where the demo really stands and what would confuse an
investor today, found by walking the preview) and the prompt after it
(§4–§9: the script, the changes in order, the rehearsal, the decisions).
Nothing here adds a feature; it removes friction and scaffolding from the
investor's line of sight and gives the demo a story.

## 1. Response in one paragraph

The machinery is there: three weeks of mutually consistent history generated
through the real services, a living district map that moves when you press
"one hour", every payment confirmed only by the (mock) provider, honest
labels everywhere. What is missing is a **story** and the removal of
**engineering scaffolding** from view. Today the demo makes the investor do
the work: pick a role, find the page, decode "(TEST)" after every name,
guess what "Dev simulator" is, read "earned -441,800 TZS" on a tile. An
investor demo is one presenter, one laptop, ten minutes, one narrative — *a
district that runs on verified money and earns people a living* — with
everything else still reachable but off the path. The polish pass is: one
scripted path (§4), one guide page that carries it (§5.1), the rough edges
below fixed (§5.2–§5.9), and a rehearsal checklist (§6).

## 2. What would confuse an investor today

Walked on the preview and the demo dataset, in the order an investor meets
them:

1. **"(TEST)" after every name.** Required by ADR-025 so no fictional person
   can be mistaken for a real one — right in the data, noisy on a map tile
   ("Jua Kali Hygiene S…", "Rider One (TEST)"). Fix in the display, never
   in the data: one component renders the name and a small muted *test*
   chip.
2. **The banner reads as an apology.** "SIMULATED DATA — generated for
   testing; no district is running." The honesty must stay; the tone can
   carry the pitch. Proposal: "Demo district — simulated people and money,
   real rules." with a link to the guide. Founders' decision (Prompt B §4,
   still open).
3. **"Dev simulator"** in the admin sidebar, and a page titled for
   developers. On the demo profile it is the demo's remote control: name it
   "Demo controls" and move the "one hour / one day" and reset controls to
   the guide page.
4. **Twenty-two sidebar items in one list.** Group them (Overview · Operate
   · People & places · Money & record · Admin) so the eye finds "Ecosystem"
   and "Approvals" without reading.
5. **Negative earnings.** A rider who bought four kits this week and sold
   one shows "earned -441,800 TZS". Correct arithmetic, wrong sentence. Show
   *received*, *paid out* and *net*, label net as net, and never print a
   bare negative "earned" on a tile.
6. **Truncated names on map tiles.** Fictional company names are long. The
   generator can use shorter fictional names (≤ 18 characters); the tile
   keeps its clip as a guard and the full name in the tooltip.
7. **Feed subjects that mean nothing** ("session", "statement" in
   monospace). Hide the subject when it is not a reference a human would
   recognise.
8. **DRAFT stamps on the public safety and privacy pages.** Correct and
   mandatory until a health advisor and counsel sign off. Keep the stamps;
   keep those pages off the investor path (mention, do not open).
9. **The wrong dataset.** If the preview runs the minimal dry-run seed, the
   map shows "Test Village (TEST)" with a handful of tiles and nothing
   moves. The investor demo needs the demo profile (GO_LIVE item 8).
10. **Login friction.** Passphrase plus authenticator code every session.
    The presenter registers a passkey once (already supported) and signs in
    with one tap; TOTP stays as the fallback.
11. **Cold start.** Neon suspends an idle database; the first page after a
    quiet hour is slow. Warm it before the demo (§6).
12. **No "what am I looking at".** The ecosystem page explains itself in one
    subtitle; the investor needs the story told for them (§4, §5.1).
13. **Small things:** `?ok=created` in the address bar after actions; the
    language toggle default; the map legend not naming the tile background
    colours for user status.

## 3. Recommendation

One story, one presenter path, seven beats in ten minutes; scaffolding out
of sight; nothing new invented for the pitch. The honesty labels are part
of the pitch, not a weakness: *every number on this screen came through
the same code a real district will run, and none of it is real money.*

## 4. The script (seven beats, ten minutes)

Presenter on a laptop, English, one browser window for the founders' view
and one phone-width window for the field app. Times are targets.

| # | Where | Do | Say (one line) | Investor sees |
| --- | --- | --- | --- | --- |
| 1 | `/` | open | "Zero cash. Every shilling verified by the provider. People earn by moving the product." | the promise, the ladder, honest ledger copy |
| 2 | `/admin/ecosystem` | open, point at the attention strip | "This is a district after three weeks. This strip is what the founders see at 7 a.m." | the district map, numbers on tiles, the strip |
| 3 | map header | press **One hour** | "Everything that just happened went through the real services." | motorbikes move, the feed fills, chips change |
| 4 | phone window `/login` → home | sign in as a champion, enrol a customer, choose the product | "One screen, one action. Consent first. The full price before any payment." | the One Screen Rule, the SMS in `/admin/messages` |
| 5 | demo controls | simulate the customer's payment, then the handover | "The app never confirms money. The provider does. Then the code, then the receipt." | "Customer has paid in full", handover code, receipt |
| 6 | `/verify/<ref>` | open the link from the receipt SMS | "The public record: what happened and when. No names. It does not prove more than it says." | event types and dates, anchoring status |
| 7 | back to the map | point at earnings on tiles, open `/admin/approvals` | "Who earned what this week. And nothing important happens on one admin's word." | earnings, the two-admin rule, the banner |

Off the path but ready if asked: `/admin/areas` (which paths are on, who
earns), `/admin/organisations` (bulk buyers), `/admin/reconciliation` and
`/admin/statements` (the money trail), the Swahili toggle (once).

## 5. Changes to make, in this order

Each is small; none adds a flow. Existing tests stay green after every
step; the demo test (`npm run test:demo`) is the gate.

### 5.1 Demo guide page — `/admin/demo`

Demo profile only (404 otherwise), linked from the banner and the sidebar.
It carries §4 as a checklist with deep links, the accounts to use (phones
only; credentials are never shown), the **One hour / One day** and **Reset
to the demo dataset** controls (moved here from the dev page; the dev page
keeps the payment simulator for engineers), a **Warm up** button that
fetches the seven pages, the last reset time, and a short "what this demo
does not claim" box. e2e: opens on the demo dataset, 404 on the minimal
seed, every deep link resolves.

### 5.2 Names: the *test* chip

One server component renders a stakeholder, customer, organisation, hub or
area name: the display name without its " (TEST)" suffix plus a muted chip
reading *test*. Used on map tiles, tables, home cards, order pages, the feed
and the verify page. Data, exports, SMS and the ledger are unchanged (the
suffix stays in them; ADR-025 holds). e2e: on the demo dataset no rendered
admin or field page contains the raw string "(TEST)"; the CSV export still
does. Unit: the component never alters a name that lacks the suffix.

### 5.3 Banner wording

Per the founders (§7.1). Default proposal: "Demo district — simulated people
and money, real rules." with "How to demo →" linking to §5.1. Same setting,
same test id, same rule (keyed on `settings.seedProfile`).

### 5.4 Sidebar groups and naming

Overview (Ecosystem, Morning brief) · Operate (Approvals, Orders,
Exceptions, Inventory, Messages) · People & places (Stakeholders, Suppliers,
Organisations, Areas & sale paths, Price lists) · Money & record
(Reconciliation, Statements, Ledger, Exports) · Admin (Settings, Logs,
Security, Data requests, Passkeys, Demo controls / Dev simulator). Group
headings are text, not links; current page stays marked with `aria-current`.

### 5.5 Earnings without bare negatives

Field home card: three figures — received, paid to own sellers, net — for
week and month; net labelled "net" and shown red only when negative, with
one line: "You bought more than you sold this week." Map tile: "net −18,600"
with the sign in words in the tooltip. Unit test on the formatter.

### 5.6 Shorter fictional names

Generator names (`lib/demo/names.ts`): companies and organisations ≤ 18
characters before the suffix; people unchanged. The map clip stays as a
guard. Demo test asserts the length rule.

### 5.7 Feed subjects

Show the subject only when it is an order, batch, exception, receipt or
approval reference (`OR-`, `B-`, `EX-`, `RC-`, `AP-`, `RECON-`); otherwise
omit it. Unit test on the predicate.

### 5.8 Presenter view

`/admin/ecosystem?present=1`: sidebar hidden, map at full width, feed
below, 16 px larger tile text. Nothing else changes; the URL flag is the
whole feature. e2e: the flag hides the nav and keeps the map.

### 5.9 Screens for the deck

`npm run demo:screens` runs a Playwright script against a demo database and
saves the seven beats as PNGs under `docs/demo-screens/` (fictional data,
fine to commit; founders decide §7.5). It doubles as the backup if the
network fails on the day.

### 5.10 Nothing else

No new flows, no new roles, no charts, no animation beyond the markers.

## 6. Rehearsal checklist

**The evening before**

- Preview on the demo profile; **Reset to the demo dataset** so history ends
  yesterday; confirm the build log says the seed ran.
- Sign in with the passkey; check the authenticator as fallback (phone time
  synced).
- Walk §4 once end to end; note the customer phone you enrol so the SMS is
  easy to find in Messages.
- Generate the deck screens (§5.9) as the backup.

**Thirty minutes before**

- Press **Warm up** on the guide page (or open the seven pages).
- Phone window at 393 × 851; laptop zoom 110–125 % on a projector; English.
- Press **One hour** once so the feed is fresh and the markers are mid-road.
- Close every other tab; the address bar shows only clean URLs.

**Never**

- Real names, real money claims, "a district is live" claims. The banner
  stays on every screen. If asked "is this real?", the answer is the
  banner's answer.

## 7. Founders' decisions (record in DECISIONS.md before 5.3 ships)

1. Banner wording (Prompt B §4): the proposal in §5.3 or your own.
2. "(TEST)" as a chip (recommended) or left inline.
3. Safety and privacy pages: mentioned but not opened in the investor path
   (recommended), or opened with the DRAFT stamp explained.
4. Swahili in the demo: one toggle moment (recommended) or not shown.
5. Commit the screenshot deck to the repository, or keep it out.

## 8. Acceptance

- A cold viewer following §4 on a fresh preview sees no raw "(TEST)", no
  "Dev", no negative "earned", no DRAFT page unless opened on purpose.
- The seven pages answer in under 1.5 s each on a warm preview.
- Every existing suite passes; the new e2e (guide page, name chip scan,
  presenter flag) passes; `npm run demo:screens` produces seven files.
- Nothing about honesty moved: banner on every screen, "(TEST)" in the
  data, "does not prove" on the verify page, no real money anywhere.

## 9. Review log

| Finding | Decision |
| --- | --- |
| "Polished and ready for investors" | **accepted** — one story, one presenter path, scaffolding out of sight; no new features; honesty labels stay and become part of the pitch. |
| Remove "(TEST)" for the demo | **rejected in data, accepted in display** — the suffix stays in every record and export (ADR-025); the UI renders it as a chip. |
