# Credit, holds, and agent-machine billing

How displayed credit relates to execution admission, direct charges and shared sandbox lease metering. Historical Cloud-agent billing notes are retained only as records; hosted third-party launches are retired.

## Two separate accounts

- **Boat** (the machine provider) is Overlay's own account. A person's Boat dashboard, if they have one, says nothing about Overlay billing. Overlay pays Boat for machine time.
- **Overlay credit** is the person's allowance (for example $20/month on Pro) plus any top-ups. Machine compute is charged to it by the lease meter (`ManagedAgentSandboxBilling`) at provider cost plus Overlay's markup, per running minute. Boat stopped runtime is unbilled; provider snapshot retention is separate from runtime accounting.

Everything below is about Overlay credit.

Every paid call is charged once, after it finishes, at the cost known then (provider receipt, or catalog price times reported usage). Nothing corrects a charge later. A charge is capped at what the balance holds, so balances never go negative.

## Remaining credit

`remaining = allowance + top-ups − spend − holds`.

Nothing creates holds any more: chat, connected agents, automations, tools (web search, deep search, web fetch), media, transcription, the agent gateway, embeddings, memory work, computers and managed sandboxes refuse only when the workspace has under 2% left, then charge the actual cost directly (see `workspace-billing.md`, "Check before, charge after"). Holds left from before the change (`budgetReservations` rows in `reserved` or `reconcile_required`, and a lease's legacy `runtimeHoldMicros`) are released, never charged, by the one-time `billing/retireHolds:releaseRetiredHoldsInternal` migration (see "Retired holds" below). Until it has run, `GET /api/v1/subscription` can show `total − used ≠ remaining`.

Connected-agent runs billed to Overlay pass the 2% check when dispatched and hold nothing. When the run ends, whatever its outcome, its reported tokens are charged once under the run's operation id (`workspace-agent:<turnId>`); a run that used no tokens charges nothing. Transcript finalization is a separate workflow step.
Harness model calls settle immediately from catalog pricing using observed token counts, so a run never waits for gateway usage. Calls with no catalog rate wait (about ten minutes of gateway 404 retries) for the exact gateway cost before settling. The former exact-cost correction workflow is deleted: it adjusted a reservation, and charges are now final. The actual charge comes from provider receipts or catalog rates times reported usage, with the usage markup.

Failed, interrupted or malformed responses cannot invent zero-usage receipts. Harness summaries, acknowledgments and progress updates use the selected model and the same direct charge. Transcript storage follows settlement; a storage outage must not drop incurred usage or trigger another work action. An ambiguous thrown tool invocation stops subsequent actions and requires outcome reconciliation. None of these paths bypass paid-workspace admission or switch to a free model.

## Retired holds

The reservation engine (reserve, start, finalize, release, reconcile, the five-minute expiry sweep, the hourly stale-hold sweep, the reconciliation queue and audit script, the released-cost recorder and the operational margin report) is deleted. `convex/billing/retireHolds.ts` releases what it left behind, in bounded batches, without charging anything:

- every `budgetReservations` row still `reserved` or `reconcile_required` becomes `released` with reason `holds_retired`; a workspace hold is subtracted from `billingAccountBalances.reservedMicros` and the matching spend limit's `reservedMicros` (never below 0). Personal holds had no balance behind them, so only the row changes.
- every machine lease with a legacy `runtimeHoldMicros` has it released from the balance and the member/agent spend limits, and cleared. Running leases would release it on their next meter tick anyway; stopped leases are never metered again, so the migration covers all leases.

It is idempotent and schedules itself until done. The `budgetReservations` table stays (with its finalized history, still read by the itemized usage list and growth analytics) until a later change deletes it after the migration has run in production and no open row remains.

## Machines and credit

Persistent Computers enforce admission in `ComputerService`, including desktop and tool-driven wakes. `ComputerAdmission` requires a payer whose scope and ID match the workspace and a paid plan, then runs the same check as every paid call (`ensureProviderBudgetNotLow`): the workspace must have at least 2% of its budget left after one automatic top-up to the 2% line, and the admin spend limit for the member (or `agent:<ownerId>`) must not be used up. There is no fixed-cent start floor and nothing is held. Personal paid credit cannot unlock a free workspace. Stop and delete remain available after downgrade or credit exhaustion. Each Computer has a deterministic `computer:<id>` lease created atomically with its owner claim; before allocation or wake, `ComputerBilling.bindPayer` records the member who starts the session (and the agent subject for agent Computers) as the lease's `lastPayer`, so the meter charges them. Boat's weighted counters remain authoritative. Idle, budget, and session-expiry stops pause the provider and retain its disk and Computer row; only explicit deletion removes them, after confirmed stop and final settlement.

Hosted third-party Cloud-agent allocation, workflow wakes, and stopped-execution recovery are retired. Existing usage still settles through the shared lease meter and reaper. Native Computers and supported sandbox leases retain their own admission and lifecycle rules.

Historical Cloud Agent provisioning records retain allocation keys and provider references for cleanup. The operations reconcile route reclaims stale setup attempts without a matching lease, retains retry state when deletion fails, and never resumes a machine.

## Provider inventory reconciliation

The operations reconcile route scans at most two pages of Boat or E2B inventory every 15 minutes; its connected-agent settlement caller runs every minute on both Preview and Production. It reports old live machines without a matching lease, Cloud Agent provision, or Computer record. This is report-only: an environment match alone is not strong ownership evidence, especially for Boat, and automatically stopping or deleting a machine could destroy a customer's disk. Alert on `[sandbox-inventory] unowned provider machines`.

The Computer integration is one cumulative Phase 2 substep, not completion of Phase 2. The schema changes are additive optional lease fields and indexes. No shared Convex deployment or migration was performed by this code change. Do not roll back lifecycle code or remove its fields while runtime holds, activity tokens, maintenance intents, or cleanup evidence remain unresolved: reconcile and settle them first. Provider allocation retries must use the saved exact recipe and key within Boat's idempotency-retention window; an older ambiguous allocation requires operator reconciliation.

- **The 2% rule.** There is no fixed-cent floor and no per-run cost cap. Each meter tick charges observed usage (`meterSandboxLeaseDebitByServer`), capped at what the workspace holds so balances never go negative, and returns `budgetLow` (under 2% left, the account is not active, or on Preview the provider guard is spent) and `spendLimitReached` (an admin limit for the member or agent is used up). On `budgetLow` the Next meter tries one automatic top-up to the 2% line; if that fails it stops the machine with reason `budget_exhausted`. A used-up spend limit stops it with `spend_limit_exceeded`. Disposable environment machines are deleted; persistent Computers pause and retain their disk and row, and only explicit deletion removes the provider resource after final settlement.
- **Historical status.** Retained Cloud Agent records may show a stopped machine; they cannot be restarted or recreated through the product.
- Leases live in `agentSandboxLeases`; `usage.stopReason` records why one ended.

## Hosts, redirects, and machine-facing URLs

Production's app URL is the apex (`https://getoverlay.io`), which redirects to `https://www.getoverlay.io`. A cross-origin redirect drops the `Authorization` header, so a machine pointed at the apex enrolled (no header) and then got 401 on every signed request. Machine-facing URLs (the host's server URL, the per-run MCP URL, the agent gateway) come from `getAgentFacingBaseUrl()`, which reads `OVERLAY_AGENT_PUBLIC_URL` (production: `https://www.getoverlay.io`) and falls back to the app URL. Set it on any deployment whose app URL redirects. The MCP/OAuth metadata is built from the host the client called instead (`mcpBaseUrl`), and strict OAuth clients must use the `www` address.

## Retired hosted-agent metering

Overlay Cloud third-party runtimes are retired. Do not enable hosted-agent flags,
provision machines, or use provider credentials to test them. Existing leases,
billing settlement, and the shared reaper remain in place for safe cleanup.
Before rollout, follow the [retirement runbook](./retire-overlay-cloud-agents.md)
and verify provider deletion; a released lease alone does not prove charges stopped.


## A machine deleted for lack of credit

When the meter kills a disposable environment lease (`budget_exhausted`, `spend_limit_exceeded`, `paid_plan_required`), the Boat machine and lease are deleted while the environment remains. A persistent Computer instead pauses on budget or idle stops and retains its disk and Computer row; only explicit deletion removes it after final settlement.

## Cancellation after spending plan credit

A Stripe subscription deletion switches the workspace to Free and disables
automatic top-ups even after paid usage. The balance retains only enough included
funding for already-used credit and any legacy holds, after grants and
purchased top-ups. It removes unused plan credit while preserving ledger history
and existing holds; cancellation does not reset a billing period or grant a new
paid allowance. Ordinary active-plan reductions still reject insufficient funding.

The release checkout drill found that zeroing the allowance previously rejected
700 micros of used credit, leaving the app paid after Stripe canceled. Regression
coverage exercises internal/server updates, released holds, grants/top-ups, normal
downgrades and older provider events. Acceptance checks the actual subscription
and balance, in addition to webhook receipt; an event row alone is insufficient.

Canceled-plan funding also shrinks when the retirement migration releases a legacy hold. The ledger retains only consumed spend; a released hold cannot restore unused paid credit. Active paid accounts retain their normal allowance.

## Durable remote tasks

### Provider execution accounting

E2B managed-sandbox create and resume use a four-minute pause-on-timeout safety fence. Only a successful runtime meter transaction renews it, bounded by the lease deadline; a failed scheduler, provider read or ledger commit does not extend runtime. No credit headroom is held for the next interval. This requires the existing minute-level meter cron. Computers currently use Boat, not E2B; their lifecycle and accounting use the shared lease meter and Boat-specific counter policy, not the E2B timeout fence.

E2B lifecycle events supply completed execution duration and actual CPU/RAM allocation. The meter keys each generation by sandbox reference and execution start time and persists a frozen compute rate card. A running generation is charged up to its observed wall time on every tick; its completion event charges any remainder, exactly once per lease meter version. A final duration shorter than what live observations already charged is not refunded (the difference is clock skew between Overlay and E2B, at most seconds).

Provider observations survive a rejected debit; the billed cursor does not advance. Cleanup must confirm stop and complete final settlement before deleting the provider resource. A stopped final observation can be replayed after a resource disappears. Missing or inconsistent evidence keeps the lease in retryable cleanup rather than releasing it as if no usage occurred. Usage operations retain compute cost, pricing and allocation evidence for audit. Settled executions absent beyond the provider's event retention window can leave the cursor only with a persisted retirement watermark; reappearing old evidence fails closed rather than being charged again.

Boat seconds are already size-weighted billable seconds, not ordinary wall-clock seconds. Its authoritative counters must not be replaced by elapsed-time estimates; only their advance is charged, and a counter that stops advancing for two minutes on a running machine stops it (`provider_usage_stalled`). E2B paused compute is not charged; Boat stopped runtime is unbilled. Boat snapshot retention (including automatic retention for 14 days) is separate from runtime accounting, as is any separately purchased storage.

This accounting checkpoint does not complete Phase 2. Scoped provider inventory reconciliation and inventory alerts, storage accounting, recovery of legacy unrecorded Cloud Agent allocations, and Phase 3 harness/preview QA remain follow-up work. Host viewer activity is not supervised by this Computer action-token integration.

Metering alerts are emitted once per sweep for each running lease whose last meter time is older than 15 minutes. Meter tick, idle-stop, pre-delete stop, and cleanup failures also emit alerts. Alert context is restricted to lease, environment, Computer, workspace, provider, and redacted reason fields; Sentry extras contain only identifiers.

### Isolated Computer preview QA

Ordinary Preview seeding retains the free Personal workspace. Shared Preview
defaults include `computer-workspace` in the combined fixture list, running the internal Preview-only
`dev/seed:initComputerQa` and adds a separate
`Computer QA` workspace for the configured sandbox identity. Its workspace account
has $5 of synthetic included credit, no Stripe customer/subscription, and no
automatic top-ups. Re-seeding never restores spent credit or changes an existing
fixture's plan, balance, holds or membership. The seed refuses non-Preview backends.
This is test ledger credit, not a payment or free provider compute.

The shared Preview profile enables Computers and reuses the restricted Preview
Boat credential; no per-feature flag or key is needed. Preserve Production
rollout settings. Test free admission in Personal and funded lifecycle in Computer QA;
allocate at most one small disposable Computer, then stop and delete that resource.
Record its ID, provider reference and operation timestamps for cost reconciliation.
Preview registers the production schedule from its first deployment. Background
callbacks require verified PR configuration and hosting access (see Convex Workflow). The four-minute provider fence
is not proof of Overlay's ten-minute idle supervisor: verify scheduled metering,
idle-stop and settlement through their actual jobs. A successful desktop open
does not establish them. Combine paid and Computer fixtures with a comma-separated
fixture list. The trusted Preview QA Recovery workflow invokes `dev/qa:recover`
for explicit synthetic refills without a VM deploy key. It preserves spend and
holds and cannot raise the real provider cap; rebuilds never refill it.

V2 remote tasks hold nothing. They pass the 2% check when dispatched and charge reported tokens once when they end, whatever the outcome (a cancelled run is charged the tokens it used). The original hard deadline still triggers stop. Recovery cannot reset that deadline, reset spend, or reset cumulative machine metering baselines. Cancellation stays
requested until host stop is confirmed; finalization intents retry usage/ordinary
idle cleanup with the existing ledger idempotency keys after terminal ingestion.
Machine time continues during human approval waits and pending stop delivery.
The lifecycle coordinator retries cloud stop-proof checks on its durable timer
while cancelling. A delivered notification does not finish this responsibility:
its first check may precede the healthy-host grace period. Only provider/host
stop proof closes the run.

A lifecycle-v2 cancellation timeout is not evidence that a disconnected BYO process
stopped. Keep the run unresolved until host stop/provider isolation is confirmed.

### Aggregate Preview provider guard

`OVERLAY_PREVIEW_PROVIDER_BUDGET_CENTS` caps a PR backend's metered spend
across all wallets (default $5; bounded at $25 for explicitly approved acceptance).
Every direct charge adds to a durable consumed-spend counter that fixture refills
and billing-period resets cannot erase. Once recorded spend (plus any legacy holds not yet released)
reaches the cap, every direct charge and machine meter tick reports `budgetLow`, so
the work stops after the current step and machines are stopped. Charges are always
recorded first, so costs cannot disappear or strand a machine. Production never
reads or writes the guard.
The guard does not replace provider account limits for unmetered service fees,
retained storage, or activity outside Overlay. Aggregate multiple PRs at the
provider account when a shared account budget is required.

Usage markup is configured with `OVERLAY_USAGE_MARKUP_BPS` on both Next and the
matching Convex backend; see [Workspace billing](workspace-billing.md#usage-markup-configuration).
Computer usage uses this same configured rate.

Memory extraction validation failures with complete non-negative integer SDK token
usage are charged like successful calls. Failures without measured usage charge
nothing; failed output is not itself proof of zero cost.
