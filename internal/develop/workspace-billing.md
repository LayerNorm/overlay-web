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

Plans belong to workspaces, and workspace billing is always on (there is no rollout flag). A workspace with an active wallet on a paid plan is the payer; with no wallet, or a wallet not on a paid plan, it is on the free allowance (counted per workspace). A workspace whose paid wallet is suspended or mismatched fails closed and never spends anything of a member's. Every hosted-cost entry point supplies its resource workspace. Shared human actions use a `member` subject, while agents, automations, knowledge indexing, and API keys use a stable `programmatic` subject.

Workspace owners and admins use the authenticated `/api/v1/workspaces/:workspaceId/billing` API family to initialize a wallet, read credit usage, and open Stripe subscription, top-up, portal, or checkout-verification flows. Overlay creates one Stripe customer per workspace billing account. Stripe metadata binds payments to the account and workspace; the initiating admin is an audit actor, not the payment owner. Duplicate webhook deliveries are idempotent and older subscription events cannot overwrite newer account state.

Checkout success/cancel and portal return URLs carry the initiating workspace in
`/app/w/<workspaceId>/settings`. The return must select that workspace before
verification, even if another tab changed the active-workspace cookie during payment.

The Billing settings tab shows the month's credit and top-up balance, the itemized usage for the period (one line per resource), and what happens at $0: a hard stop by default, or automatic top-ups up to a monthly limit an owner or admin sets. Unused credit, including top-ups, does not carry over at renewal. Members have a read-only view.

Billing settings presents uninitialized and initialized-but-unpaid workspaces as Free. Upgrade opens a dialog for the monthly amount and legal acceptance; Continue to payment initializes the wallet if needed, then starts Stripe checkout. The paid billing overview appears only after the workspace has a paid subscription or a top-up balance.

Workspace reservations use the account-keyed balance and optionally a fixed-period subject limit. Subjects are either `member` for human-attributed spend or `programmatic` for shared agents, automations, and service callers. Reservation creation locks the workspace balance and subject limit in one transaction. Finalize, release, expiry, and evidence-based reconciliation update the workspace balance and subject counters together. Wallet creation grants no credits; funding remains an explicit later operation.

The launch coverage gate lives in `src/server/billing/billable-feature-coverage.ts`. Shared conversations/agents, embeddings/search, browser/sandbox, hosted media/transcription, and automation/API provider calls are metered. Workflow runs additionally charge a conservative 20-step estimate at Vercel's Workflow Steps rate ($2.50 per 100,000 steps) with the same 25% markup. Functions, integrations, and MCP tools are bounded to 12 steps per agent turn and 50,000 result characters; file ingestion is bounded to 20 requests per hour and the account storage cap. Do not enable `workspaceWallets` in a deployment unless `npm run check:owner-funded-boundary` and the coverage test pass.

The workspace billing contract runs against Convex:

```bash
npm run test:workspace-billing-contract:convex
```

The contract covers empty-wallet hard stops, concurrent account/member limits, account/workspace spoof rejection, removed-member denial, allowance/top-up separation, actual-cost margin reporting, and reconciliation SLA visibility. The Stripe webhook suite separately proves duplicate event no-ops and stale-event ordering.

## Production activation gate

Deploy the Convex functions before the matching web release, then keep the rollout stage `off` until all of these checks pass against the same environment:

1. The personal backfill reports balance parity and the read-only Stripe verifier finds exactly six unchanged active subscriptions.
2. Both provider contract suites pass, along with `npm run check:owner-funded-boundary` and the billable-feature coverage test.
3. `npm run billing:audit:reconciliation` reports no item older than the 15-minute SLA.
4. An internal organization workspace is initialized and funded, then smoke-tested for shared chat, agents, files, tools, browser, sandbox, media, and automation usage.
5. Its Billing tab shows actual provider cost, retail credits, realized margin, full cost coverage, and a healthy reconciliation queue.

Advance only one stage at a time: `internal`, then `selected`, then `general`. The kill switch is the master flag or `stage=off`; either restores the personal compatibility path globally and should be used only as a deliberate rollback.

## Reservation reconciliation

The usage ledger automatically releases expired reservations only when provider work never started. Provider-started reservations are quarantined until authoritative evidence establishes whether to finalize the measured cost or release the reservation.
Harness model reservations are an exception when Gateway usage stays unavailable: after about ten minutes of 404 retries, observed tokens settle at catalog pricing when a rate exists. Non-404 lookup failures and unknown catalog rates remain quarantined.

Inspect the development queue without mutating it:

```bash
npm run billing:audit:reconciliation
```

The audit defaults to the development Convex deployment. Production inspection requires an explicit `--target=prod --allow-prod=true` invocation of the underlying script. Resolution is server-only, requires a non-empty evidence source, evidence reference, and reason, and is idempotent for exact replays. A conflicting second resolution fails closed.

## Post-plan maintenance queue

- [ ] Fix the unrelated on-prem Convex inventory mismatch in the existing chat and auth files.
- [ ] Fix the unrelated conversation smoke-test index mismatch.

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
