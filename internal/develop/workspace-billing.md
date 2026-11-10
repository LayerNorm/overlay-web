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

## Billing in the browser

The browser reads billing live from Convex, never over HTTP:

- `billing/browse:workspaceSummary({ workspaceId })` feeds Workspace → Billing and the onboarding payment step. Any active member can read it.
- `billing/browse:entitlements({ workspaceId })` feeds the chat composer gates, model pickers, agent editors and sidebar meters.

Both are built by the same shared code the routes use: `src/shared/billing/workspace-billing-summary.ts` and `src/shared/billing/app-subscription.ts`. The live views and `GET /api/v1/workspaces/[id]/billing` and `/api/v1/subscription` therefore cannot disagree.

**Rules the queries enforce:**
- Owners and admins manage. Members may top up only when `usageTopUpBy` is `members`.
- Provider customer, subscription and payment IDs never leave Convex.
- `entitlements` is null when billing is off on the deployment; the app then uses the entitlements it booted with.

**What this replaced:**
- The sidebar's 60-second poll.
- The refetch after every chat turn. `loadSubscription` now returns the live snapshot and makes no request.
- The onboarding step's 3-second poll after checkout. It now verifies the session once (again on **Check payment**), and the webhook-confirmed payment arrives live.

**Refused agent turns.** When admission refuses an agent turn for billing, the failed reply names the problem and who can fix it.
- Sources: `WorkspaceExecutionError` with its `state` and `recovery`, or Convex's bare `workspace_execution_required`.
- The reply text comes from `agentStartFailureMessage` in `src/server/app-api/v1/conversations/message/agent-start-failure.ts`.
- `agentStartFailureReason` stores a short reason as a `data-native-agent-error` part. That replaces the generic "No failure reason is available" line.

Checkout, top-ups, the portal, verification and automatic top-ups still run on the server, because they call Stripe. The summary's itemized usage reads up to the charge cap per refresh. Only the Billing tab and onboarding subscribe to it; the frequent consumers use the light `entitlements` query.

## Workspace reservation foundation

Hosted execution requires a workspace wallet with an active account, a paid subscription in its current verified period, and available funds. A missing wallet or unpaid account never falls back to a member's personal payer or free inference. Workspace setup, manual drafts, history, and export remain available before payment. Billing-disabled self-hosted deployments explicitly bypass paid admission and may retain personal bookkeeping. A workspace whose paid wallet is suspended or mismatched fails closed. Every hosted-cost entry point supplies its resource workspace. Shared human actions use a `member` subject, while agents, automations, knowledge indexing, and API keys use a stable `programmatic` subject.

Workspace owners and admins use the authenticated `/api/v1/workspaces/:workspaceId/billing` API family to initialize a wallet, read credit usage, and open Stripe subscription, top-up, portal, or checkout-verification flows. Overlay creates one Stripe customer per workspace billing account. Stripe metadata binds payments to the account and workspace; the initiating admin is an audit actor, not the payment owner. Duplicate webhook deliveries are idempotent and older subscription events cannot overwrite newer account state.

Checkout success/cancel and portal return URLs carry the initiating workspace in
`/app/w/<workspaceId>/settings`. The return must select that workspace before
verification, even if another tab changed the active-workspace cookie during payment.

The Billing settings tab shows the month's credit and top-up balance, the itemized usage for the period (one line per resource), and what happens at $0: a hard stop by default, or automatic top-ups up to a monthly limit an owner or admin sets. Unused credit, including top-ups, does not carry over at renewal. Members have a read-only view.

Billing settings presents uninitialized and initialized-but-unpaid workspaces as Free. Upgrade opens a dialog for the monthly amount and legal acceptance; Continue to payment initializes the wallet if needed, then starts Stripe checkout. The paid billing overview appears only after the workspace has a paid subscription or a top-up balance.

The workspace balance is the only automatic spending limit, plus an optional fixed-period subject limit an admin sets. Subjects are either `member` for human-attributed spend or `programmatic` for shared agents, automations, and service callers. Wallet creation grants no credits; funding remains an explicit later operation.

**Check before, charge after.** Model calls, tools, media, transcription, connected agents, automations, embeddings and memory work never estimate, reserve or hold what a call will cost:

- Before a paid call, `ensureProviderBudgetNotLow` (`src/server/billing/billing-runtime.ts`) reads the real balance. Under 2% left, it tries one automatic top-up to the 2% line (`workspaceBudgetStopLineCents`) and refuses with `402 insufficient_budget` only if the workspace is still under 2%. It also refuses when the subject's spend limit is used up. Convex background work (embeddings, memory extraction, memory profiles) uses `billing/providerBudget:providerBudgetGate`, which applies the same check without a top-up.
- After a successful call, the actual cost (provider receipt, or catalog price times reported usage, or a known per-item price for media) is charged directly with `recordBatch`, keyed by a unique operation id. The charge is capped at what the balance holds, and it counts against the subject's spend limit (`programmaticSubjectId` selects a program's limit). A failed call charges nothing.
- `recordBatch` returns `budgetLow`. A loop (the notebook agent) stops taking steps when a charge leaves the workspace under 2%.

Explicit BYO inference still requires a workspace that is not under 2%, and charges no Overlay model usage. Computers and managed sandboxes still hold funds until the workspace-budget-only plan's phase 4.

The launch coverage gate lives in `src/server/billing/billable-feature-coverage.ts`. Shared conversations/agents, embeddings/search, browser/sandbox, hosted media/transcription, and automation/API provider calls are metered. Each automation run is also charged a flat 20 Workflow Steps at Vercel's rate ($2.50 per 100,000 steps) with the configured usage markup, after the run. Functions, integrations, and MCP tools are bounded to 12 steps per agent turn and 50,000 result characters; file ingestion is bounded to 20 requests per hour and the account storage cap. Keep `npm run check:owner-funded-boundary` and the coverage test passing for every hosted-cost entry point.

The workspace billing contract runs against Convex:

```bash
npm run test:workspace-billing-contract:convex
```

The contract covers empty-wallet hard stops, concurrent account/member limits, account/workspace spoof rejection, removed-member denial, allowance/top-up separation, actual-cost margin reporting, and reconciliation SLA visibility. The Stripe webhook suite separately proves duplicate event no-ops and stale-event ordering.

## Release verification

Workspace billing is always on; the retired wallet activation stages are not a
release lane. Validate billing changes in the PR's isolated Preview, including
shared credit admission, the 2% stop and direct charges.
Follow the authoritative Development Workflow for integration. Customer Convex
synchronization runs only from clean canonical main after matching production
web is live; never deploy it from a feature worktree.

## Reservation reconciliation

Only computers, managed sandboxes and reservations created before the workspace-budget-only change still use this path.
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
A typed payment-verification-pending result may keep an already owned funding
wait paused; it cannot renew a lease or admit a model/tool call. Other billing
errors and ownership changes remain fail-closed.
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
Actual settlement remains recordable after exhaustion. Direct charges (chat,
tools, media, background work) count toward the guard, but only new holds
(computers) are refused by it; refusing direct-charge work in Preview is not yet
wired. See Billing Holds and Machine Metering for provider-account limits and
excluded external charges.

Browser interaction is billed through the bound Computer's machine lease and
ordinary model usage. The separate browser-task provider and charge path are
retired; historical browser-task ledger rows remain visible.

Hosted transcription uses the shared quota policy: absent or zero legacy seconds
limits do not block a credit-funded paid workspace. Positive seconds caps, paid
plan admission, the 2% check and the direct charge of the reported duration
remain enforced.

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
