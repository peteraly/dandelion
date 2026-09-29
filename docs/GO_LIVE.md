# Go-live gates — status

Humans sign these off. This file only reports status; nothing here is marked passed by the build.
Building and testing run entirely on mocks and testnet and are not blocked by any gate.

Legend: ⬜ not started · 🟨 in progress / partially prepared · ✅ signed off (by a named founder, with date)

| Gate | Status | What is ready in the app | What the founders must do |
| --- | --- | --- | --- |
| **G1 Payment routing** | ⬜ | Provider-neutral `PaymentIntent` + `PaymentProvider`; `MockProvider` (default); stubs `VodacomMpesaProvider`, `AggregatorProvider`; verification path fully tested against the mock (spoof/duplicate/replay/wrong amount/overpayment/payee mismatch/reversal). | Choose route (a) merchant till per seller, (b) licensed aggregator, or (c) platform collection + disbursement (needs a legal opinion on holding funds). Then: implement the chosen adapter against the provider's sandbox; obtain a legal opinion if (c). See docs/DECISIONS.md ADR-001. |
| **G2 Egress IPs** | ⬜ | Callback protection: secret URL token, optional CIDR allowlist, per-payer rate limit, mandatory direct status query. | Confirm whether the provider whitelists source IPs; pick Vercel Static IPs (verify plan), an egress proxy, or an aggregator; get the IPs whitelisted. ADR-009. |
| **G3 Legal** | ⬜ | Privacy notice in SW/EN (`/privacy`, marked DRAFT); data-minimising schema (forbidden fields test); envelope-encrypted phone numbers; correction/deletion flow; AI off by default. | PDPC registration; transfer impact assessment (Vercel, Neon, SMS gateway, Anthropic); counsel approves the privacy notice; SMS sender ID registration. ADR-011. |
| **G4 Contract** | ⬜ | `contracts/src/LedgerAnchor.sol` with full Foundry tests; anvil integration test; deploy script; `ContractDeployment` history; anchoring skips while paused. Chain id/RPC configurable; **verify the current Celo testnet on docs.celo.org** before deploying. | Third-party audit of `LedgerAnchor`; configure the admin Safe (recommend 2-of-3); deploy to mainnet; fund the writer wallet; confirm the low-balance alert fires. ADR-004, ADR-017. |
| **G5 Security** | ⬜ | Admin passkey registration + TOTP fallback (SMS never a factor); `Signer` and `KeyProvider` interfaces with KMS stubs; production refuses env keys (test); restore-drill runbook in README; verification path has invariant tests. | Enroll passkeys for every admin; choose a KMS, implement `KmsSignClient` / `KmsEncryptClient`, set `KMS_DATA_KEY_ID` and `ANCHOR_KMS_KEY_ID`; run and record a restore drill; commission a penetration test or independent review of `lib/payments/verification.ts` and `lib/payments/callbacks.ts`. ADR-008. |
| **G6 Content** | ⬜ | Every string exists in SW and EN; `messages/sw.json` carries `needs_native_review: true` (CI fails if removed); education/WASH copy is limited to handbook §8E/§11 and marked DRAFT; `content/education/pack.json` (7 sections, all sourced to §8E/§11/§12, `status: DRAFT`) drives the education helper only after an admin approves it in Settings. | Native Swahili speaker reviews `messages/sw.json`, `content/education/pack.json` and `lib/ai/messages.ts` templates and clears the flag; a qualified health advisor approves the referral card, WASH guidance and the pack, then changes its `status` from DRAFT. |
| **G7 Operations** | ⬜ | Daily reconciliation cron; provider statement CSV import + diff; admin priorities, brief, logs; health endpoint. | Complete handbook §20 launch checklist; run the Day 8 dry run on the preview; do the first statement reconciliation during the dry run (USA co-founder). |

## Deployment prerequisites (stop conditions reported during the build)

These need credentials or dashboard actions the build did not have. Exact steps are in README → "Deploy".

1. `vercel login` then `vercel link --scope peteraly` in the repo; record the team plan in docs/DECISIONS.md ADR-019.
2. Vercel dashboard → Storage → add **Neon** (Marketplace) with the branch-per-preview integration; use the **pooled** connection string as `DATABASE_URL`; record region and at-rest encryption status.
3. Vercel → Settings → Deployment Protection → enable for previews.
4. Set the environment variables listed in `.env.example` for preview and production (production has no dev defaults and refuses to start without them).
5. Set `PRODUCTION_DB_HOST` so the seed script can never run against production.
6. Point an external uptime monitor at `/api/health` (see README).

## Signed off

| Gate | Signed by | Date | Evidence |
| --- | --- | --- | --- |
| — | — | — | — |
