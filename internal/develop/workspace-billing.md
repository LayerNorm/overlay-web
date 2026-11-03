# Workspace billing internals

Maintainer notes for workspace billing: billing accounts, reservations, the activation gate and reconciliation. Moved from the public API guide on 2026-10-22; the public guide is `docs/developer/api/guides/billing.mdx`.

Billing state comes from Stripe webhook processing and Convex-backed entitlement state.

Core web API routes:

```http
GET /api/v1/subscription
GET /api/v1/subscription/settings
POST /api/v1/subscription/settings
```

Checkout, portal, top-up, and webhook endpoints also exist under non-`/api/v1` app routes. They are web-app routes rather than part of the generated public `/api/v1` reference.

For local webhook testing:

```bash
stripe listen --forward-to <selected dev Convex site URL>/stripe/webhook
```

When billing is disabled, pair `billing.provider="none"` with `capabilities.billing=false`.

## Billing accounts

Payment ownership is modeled by a billing account with an explicit `markup_25_v1` pricing version. Every workspace that adds a plan gets a workspace billing account (its Stripe subscription, balance and history). Each person also has a personal billing account, which never holds credit: an account is never free or paid, so it only records free usage and storage. Account-plan endpoints (`/api/checkout`, `/api/checkout/verify`, `/api/topups/checkout`, `/api/topups/verify`, `/api/portal`, and `POST /api/subscription/settings`) answer `410 account_plans_retired`.

## Workspace reservation foundation

Hosted execution requires a workspace wallet with an active account, a paid subscription in its current verified period, and available funds. A missing wallet or unpaid account never falls back to a member's personal payer or free inference. Workspace setup, manual drafts, history, and export remain available before payment. Billing-disabled self-hosted deployments explicitly bypass paid admission and may retain personal bookkeeping. A workspace whose paid wallet is suspended or mismatched fails closed. Every hosted-cost entry point supplies its resource workspace. Shared human actions use a `member` subject, while agents, automations, knowledge indexing, and API keys use a stable `programmatic` subject.

Workspace owners and admins use the authenticated `/api/v1/workspaces/:workspaceId/billing` API family to initialize a wallet, read credit usage, and open Stripe subscription, top-up, portal, or checkout-verification flows. Overlay creates one Stripe customer per workspace billing account. Stripe metadata binds payments to the account and workspace; the initiating admin is an audit actor, not the payment owner. Duplicate webhook deliveries are idempotent and older subscription events cannot overwrite newer account state.

Checkout success/cancel and portal return URLs carry the initiating workspace in
`/app/w/<workspaceId>/settings`. The return must select that workspace before
verification, even if another tab changed the active-workspace cookie during payment.

The Billing settings tab shows the month's credit and top-up balance, the itemized usage for the period (one line per resource), and what happens at $0: a hard stop by default, or automatic top-ups up to a monthly limit an owner or admin sets. Unused credit, including top-ups, does not carry over at renewal. Members have a read-only view.

Billing settings presents uninitialized and initialized-but-unpaid workspaces as Free. Upgrade opens a dialog for the monthly amount and legal acceptance; Continue to payment initializes the wallet if needed, then starts Stripe checkout. The paid billing overview appears only after the workspace has a paid subscription or a top-up balance.

Workspace reservations use the account-keyed balance and optionally a fixed-period subject limit. Subjects are either `member` for human-attributed spend or `programmatic` for shared agents, automations, and service callers. Reservation creation locks the workspace balance and subject limit in one transaction. Finalize, release, expiry, and evidence-based reconciliation update the workspace balance and subject counters together. Wallet creation grants no credits; funding remains an explicit later operation.

New execution admission checks the paid current period and available wallet funds before starting work. Already-created matching holds are replayed before new-spend admission, and settlement, release, and reconciliation remain available after admission closes. Explicit BYO inference still requires a funded workspace, but creates no Overlay model-usage reservation.

The launch coverage gate lives in `src/server/billing/billable-feature-coverage.ts`. Shared conversations/agents, embeddings/search, browser/sandbox, hosted media/transcription, and automation/API provider calls are metered. Workflow runs additionally charge a conservative 20-step estimate at Vercel's Workflow Steps rate ($2.50 per 100,000 steps) with the configured usage markup. Functions, integrations, and MCP tools are bounded to 12 steps per agent turn and 50,000 result characters; file ingestion is bounded to 20 requests per hour and the account storage cap. Keep `npm run check:owner-funded-boundary` and the coverage test passing for every hosted-cost entry point.

The workspace billing contract runs against Convex:

```bash
npm run test:workspace-billing-contract:convex
```

The contract covers empty-wallet hard stops, concurrent account/member limits, account/workspace spoof rejection, removed-member denial, allowance/top-up separation, actual-cost margin reporting, and reconciliation SLA visibility. The Stripe webhook suite separately proves duplicate event no-ops and stale-event ordering.

## Release verification

Workspace billing is always on; the retired wallet activation stages are not a
release lane. Validate billing changes in the PR's isolated Preview, including
shared credit admission, zero-credit hard stops and reservation reconciliation.
Follow the authoritative Development Workflow for integration. Customer Convex
synchronization runs only from clean canonical main after matching production
web is live; never deploy it from a feature worktree.

## Reservation reconciliation

The usage ledger automatically releases expired reservations only when provider work never started. Provider-started reservations are quarantined until authoritative evidence establishes whether to finalize the measured cost or release the reservation.
Harness model reservations are an exception when Gateway usage stays unavailable: after about ten minutes of 404 retries, observed tokens settle at catalog pricing when a rate exists. Non-404 lookup failures and unknown catalog rates remain quarantined.
An operator can record late authoritative provider costs on an already released, provider-started reservation with internal `billing/releasedProviderCosts:recordInternal`. It requires the exact deployment URL, account, model, integer microdollar cost, token count and receipt evidence. Exact repeats are idempotent; conflicting evidence fails closed. This records an absorbed expense without changing the release audit, wallet, subject limits or customer charge. The operational report includes those expenses alongside finalized reservation costs, so released failures cannot inflate reported margin. Retain the exact provider receipt privately; the ledger uses microdollar precision.

Approval-paused SDK steps settle their known model usage before suspension.
WorkflowAgent returns these steps through its end callback without a step-end
callback; the Harness deduplicates callbacks by invocation step number, advances
the receipt identity once, and reserves any later compaction/inference separately.

Inspect the development queue without mutating it:

```bash
npm run billing:audit:reconciliation
```

The audit defaults to the development Convex deployment. Production inspection requires an explicit `--target=prod --allow-prod=true` invocation of the underlying script. Resolution is server-only, requires a non-empty evidence source, evidence reference, and reason, and is idempotent for exact replays. A conflicting second resolution fails closed.

## Post-plan maintenance queue

- [ ] Fix the unrelated on-prem Convex inventory mismatch in the existing chat and auth files.
- [ ] Fix the unrelated conversation smoke-test index mismatch.

## Workspace-funded continuation

Versioned Harness tasks reserve each next call against the workspace wallet instead
of receiving a synthetic lifetime cap. Funding shortfalls pause the same task;
continuation rechecks current membership, paid admission and execution ownership.
BYO credentials do not bypass workspace admission. The selected model is retained;
no budget failure recovers through a free or alternate model.

Automatic top-up claims require the current verified paid period as well as active
billing, explicit off-session consent, the bound customer/payment method and the
monthly ceiling. Pending or ambiguous payments retain one stable payment identity;
retries cannot create another charge or credit the wallet twice. Existing prices,
included credit, configured markup and subscriptions remain unchanged.

## Preview fixture recovery

Paid and Computer fixtures compose through the comma-separated Preview fixture
setting. Internal `dev/qa:recover` accepts only the configured QA identity's known
fixtures on Preview, with an idempotent request ID and audited recovery. Paid
refill accepts only synthetic active plans and preserves consumed spend, live
reservations and provider billing history. Free recovery resets only recent QA
turn/transcription counters. It is separate from normal seeding and never funds
a provider account. Test actual Stripe checkout/events separately from fixtures.

A shared Stripe test account broadcasts events to all registered PR endpoints.
Preview refuses live-mode events and ignores metadata-bound billing events whose
account does not exist on that backend, before recording or applying them.
Production retains its transactional retry behavior for missing-account failures.
Each PR backend needs its own endpoint signing secret; test-key configuration
alone does not establish webhook delivery or payment acceptance.

Preview payment provisioning is part of billing-enabled builds. The scoped helper
reuses a metadata-bound test endpoint, persists its signing secret only on the
owned backend, and repairs event subscriptions. The trusted controller confirms
endpoint deletion before backend cleanup. Test-key mode and endpoint/backend
ownership are independently checked; configuration success is separate from
actual checkout, signed delivery, billing persistence and cancellation acceptance.

The optional `exhausted-workspace` fixture provides a separate Free workspace
whose turn/transcription quota is consumed without provider requests. Explicit
recovery resets only that workspace's counters; rebuilds preserve the result.
Use it to verify the denial and recovery paths without consuming real model runs.

A separate Preview provider guard caps metered commitments across all wallets,
independently of synthetic credits. It defaults to $5 per PR, with an explicit
acceptance override up to $25. Settled cost is durable and all active wallet
reservations count; synthetic refills and period rollovers do not reset the guard.
Actual settlement remains recordable after exhaustion. See Billing Holds and
Machine Metering for provider-account limits and excluded external charges.

Browser interaction is billed through the bound Computer's machine lease and
ordinary model usage. The separate browser-task provider and charge path are
retired; historical browser-task ledger rows remain visible.

Hosted transcription uses the shared quota policy: absent or zero legacy seconds
limits do not block a credit-funded paid workspace. Positive seconds caps, paid
plan admission and provider budget reservation/finalization remain enforced.

The owner-funded boundary guard follows the current Act orchestration, Harness
model dispatch and Convex knowledge payer path. It also rejects retired Postgres
and desktop billing implementations and native client-calculated usage writes.

## Usage markup configuration

`OVERLAY_USAGE_MARKUP_BPS` is required on Next and its matching Convex deployment.
Set it to `2500` to retain the current 25% rate. This controls provider-cost billing
for inference, tools, memory/embeddings and Computer compute; it does not change
Stripe prices, subscription amounts, included credit or existing account records.
Shared pricing helpers require an explicit rate and never read environment values.
Missing, negative or non-integer configuration rejects billing rather than silently
falling back. The historical `markup_25_v1` account identifier is retained for
compatibility; it is not the runtime rate. New accounts record the configured rate.

Before releasing this contract, set and read back the same value in Vercel Preview
and Production, the shared Convex Preview configuration and matching backends.
Configure local engineer-owned Next/Convex environments too. Unit runners use an
explicit test fixture. Do not change the rate independently during active billed
work: reservations and final settlement must use the same policy. A future rate
change requires a coordinated rollout with in-flight reservations settled first.

Background memory extraction settles SDK-reported token usage on structured-output
validation failures using the same pricing and finalizer as successful calls.
Invalid output is never stored. Missing/invalid usage, unknown pricing and failed
settlement retain reconciliation rather than assuming zero provider cost.
