# Dandelion — Build Prompt E: the blockchain in plain language, an open demo, and a calmer interface (v1.0)

Founder questions (2026-09-30): *Is this using blockchain? If so, why does
it matter, in simple language?* Then: *produce a version without the
authentication or logins for now*, and *identify and implement best
practices for a clean, polished, not crowded UI, including the live
bird's-eye view.* As in Prompts B–D, each part answers first and specifies
after. Nothing here changes a handbook rule.

---

## Part 1 — Is it using blockchain?

### 1.1 Short answer

**Yes, in one narrow, deliberate way, and it is switched off in the preview
today.** The app writes a *fingerprint* of its records to a public
blockchain (Celo) about once an hour. It does **not** put payments, people,
phone numbers or money on the blockchain, users have no crypto wallets, and
nobody pays in crypto. Money moves by ordinary mobile money (M-Pesa and
similar); the blockchain is only a public notary for the records.

### 1.2 Why it matters, in simple language

Think of a school exam result book. Anyone could quietly change a mark
later. Now imagine that every evening the head teacher reads out a short
code that summarises every page, and the whole village writes that code
down. If someone changes a mark next week, the code no longer matches what
the village wrote down, and everyone can see the book was touched.

Dandelion does the same with its records:

- **Every event** (payment confirmed, stock handed over, receipt issued,
  problem raised) goes into the record book.
- **Once an hour**, the app computes one short fingerprint of all new
  events and publishes it on a public blockchain, where nobody — including
  us — can change or delete it.
- **Any customer, donor, auditor or journalist** with a receipt link can
  open the record page and check that the record matches the published
  fingerprint. If anyone had edited it afterwards, the check fails.

What that gives each person:

| Who | What they get |
| --- | --- |
| A customer | Proof that her receipt was not quietly changed after she paid. |
| A champion or rider | Proof of what they delivered and what they earned, which no single admin can rewrite later. |
| A donor or NGO | Evidence they can check themselves, not a spreadsheet they have to trust. |
| An investor | An audit trail that is tamper-evident by construction, at almost no cost. |
| The founders | Protection against the accusation "you changed the numbers". |

### 1.3 What it does *not* prove (said out loud, on purpose)

It proves a record **has not changed since it was published**. It does not
prove the event was true in the first place: if someone typed something
false, the fingerprint faithfully preserves something false. Truth comes
from the other layers: the mobile-money provider is the only one who can
confirm a payment, both people confirm every hand-over, two admins approve
anything important, and the provider's monthly statements are reconciled
against the app. The public site already says this ("does not prove the
event itself was true"), and a test forbids the phrase "guaranteed by
blockchain" (ADR-005).

### 1.4 Why this design and not "everything on-chain"

- **Privacy.** In a small village, even scrambled phone numbers on a public
  chain can be traced back to people. Only salted fingerprints go on-chain;
  nothing on it identifies anyone (ADR-004).
- **Cost and simplicity.** One tiny contract (about 90 lines, fully tested)
  receives one fingerprint per hour: cents per month, one thing to audit.
- **No wallets for users.** Nobody has to manage keys, seed phrases or
  crypto; they use the phone and mobile money they already have (ADR-006).
- **Payments never wait for the chain.** If the chain is slow or down, the
  app keeps working; fingerprints queue up and are published later.

### 1.5 Where it stands

| Piece | State |
| --- | --- |
| Record book (ledger events), salted fingerprints, Merkle tree | built, tested |
| `LedgerAnchor` contract (Solidity), Foundry tests, deploy script | built, tested |
| Hourly anchoring job, public record page with "Show technical proof" | built, tested |
| Preview | **off** — no signing key or contract address set, so pages say "Waiting to be recorded on the public ledger" |
| Mainnet | gated: third-party contract audit, a 2-of-3 Safe as contract admin, a key held in a cloud KMS (GO_LIVE G4, G5) |

### 1.6 Prompt — make the blockchain visible and honest in the demo

1. **Turn it on for the preview** (testnet only): deploy `LedgerAnchor` to
   Celo's current testnet (verify the name on docs.celo.org), set
   `ANCHOR_SIGNER_KEY` (testnet key, Preview only; production refuses env
   keys), record the deployment, fund the writer from a faucet. The hourly
   job and the simulator's "one day" then anchor; record pages show
   "Recorded on the public ledger" with a link to the transaction.
2. **One plain-language card** on the landing page and in the demo guide:
   the exam-book story of §1.2 in three sentences, with §1.3's limit in the
   same card. Same text in Swahili.
3. **A "check it yourself" step** in the demo script (§4 of Prompt D, beat 6):
   open a receipt's record page, press "Show technical proof", follow the
   transaction link to the public explorer.
4. **Tests:** the landing card never says "guaranteed"; the verify page
   shows the transaction link only when an anchor exists; the anvil
   integration test keeps passing.
5. **Founders' decisions:** (a) switch testnet anchoring on for the preview
   now or after the demo; (b) the mainnet timeline (audit, Safe, KMS).

---

## Part 2 — A version without logins

### 2.1 Response

Built, with guard-rails, as an **open demo**: a public `/demo` page with one
button per role (founder, second founder, supplier, boss rider, hub
manager, field champion). One click and you are in that role on the
fictional district — no phone, passphrase, code or PIN. The real sign-in
stays exactly as it is for everything else.

It exists only when **all three** hold, so it cannot leak into real use:

1. the environment is not production (fail-closed, ADR-023);
2. `DEMO_OPEN_ACCESS=true` is set for that environment in Vercel;
3. the database was filled by our own seed (fictional people marked TEST,
   fake phone numbers).

Everyone with the link shares one district, so open-demo sessions cannot:
wipe the dataset, export data, register passkeys, or store a phone number
outside the fake range (+255 700 00x xxx) — a visitor cannot put a real
person's number into the system. Every entry is logged ("Open demo
entered" in the live feed). Turn it off by removing the variable and
redeploying. ADR-033.

Found and fixed on the way: field actions picked "whoever is signed in"
and preferred an admin session, so a browser holding both (founders testing
both apps; switching role in the demo) had its field forms refused. Field
actions now read only the field session, admin actions only the admin
session.

### 2.2 How to switch it on (preview)

1. Vercel → Settings → Environment Variables → add `DEMO_OPEN_ACCESS` =
   `true`, scope **Preview** only.
2. Redeploy the branch.
3. Open the preview's home page → **Try the demo — no sign-in**.

### 2.3 Acceptance (implemented)

- `/demo` is 404 unless all three conditions hold (unit, integration, e2e).
- Entry per role creates a session marked `OPEN_DEMO` (migration `0005`);
  admins arrive with the second step complete, at the demo guide.
- Refused for open-demo sessions: reset, CSV export (403), passkey
  registration; real phone numbers in customer, stakeholder, supplier and
  organisation forms (`open_demo_fake_phone`).
- Rate limit 40 entries per 10 minutes per address; `OPEN_DEMO_ENTRY`
  security event per entry.
- "Switch role" link in both apps for open-demo sessions.

---

## Part 3 — A clean, uncrowded interface

### 3.1 What was crowded (found on the demo dataset)

The bird's-eye page stacked a header, three rows of large filter buttons,
13 attention chips (most reading "0"), the map, an always-open table twin,
50 feed items, 11 money rows (mostly zero), a system panel and three long
tables. Everything had the same visual weight, so nothing stood out.

### 3.2 Best practices applied

| Practice | What changed |
| --- | --- |
| **Answer first, detail on demand** (progressive disclosure) | Four headline numbers at the top: units in the district, confirmed payments in the window, active plans, needs attention. Detail sits below or behind a click. |
| **Show only what needs action** | Attention chips appear only when their count is above zero (or when selected); the rest fold into "N checks all clear". An all-clear district shows one green "All clear". |
| **One thing at a time** | Hubs, champions and open orders are tabs; the tab follows the attention chip (a payment chip opens the orders tab). |
| **Group related controls; make them small on desktop** | Window and area/hub filters are compact segmented controls on one line. Field screens keep their 48 px targets. |
| **A legend you can read at a glance** | One-line map key (ladder, direct, the four payment colours, motorbike, padlock, live dot); the long explanation folds under "How to read the map". |
| **Hide the machine room** | System health is one line ("Jobs ran on time" / "N jobs need a look") with details folded; the table twin of the map is folded (still there for screen readers and phones). |
| **Numbers over noise** | Money shows the total, then only the paths that actually moved money. The feed shows 12 items, "Show N more" for the rest. |
| **Live, but calm** | A green dot pulses on every place active in the last hour; "N events in the last hour" beside the map title; markers creep along the road on each refresh; all motion stops under reduced-motion. |
| **Consistency** | One colour meaning everywhere (grey pending, green confirmed, amber review, red hold), icon *and* text for every state, the same chip for test names. |
| **Honesty stays visible** | The demo banner, the "(TEST)" chip and the "does not prove" copy remain on every relevant screen. |

### 3.3 Acceptance (implemented)

- e2e: four headline numbers; chips are focusable; the active chip always
  shows and outlines exactly its tiles; tables switch by tab; axe clean at
  phone and desktop width.
- Unit: a place is "live" only for activity within the hour before the
  snapshot, never for future timestamps.
- Screens regenerated with `npm run demo:screens`.

### 3.4 Next, if wanted

- The same "answer first" treatment for the admin home (priorities) and
  the orders list.
- Swahili copy review of the new strings (G6).

---

## Review log

| Finding | Decision |
| --- | --- |
| "Is it blockchain?" | **Answered**: a public notary for record fingerprints on Celo; payments and people stay off-chain; off in the preview until testnet anchoring is configured (§1.6). |
| No-login version | **Implemented as an open demo**, gated to non-production + explicit switch + fictional data; destructive and data-leaving actions refused; ADR-033. |
| Admin session shadowed field actions | **Fixed**: session-specific actor lookups. |
| Crowded bird's-eye view | **Fixed** per §3.2. |
