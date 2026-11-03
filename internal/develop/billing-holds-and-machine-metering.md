# Credit, holds, and agent-machine billing

How displayed credit relates to execution admission, reservations, settlement and shared sandbox lease metering. Historical Cloud-agent billing notes are retained only as records; hosted third-party launches are retired.

## Two separate accounts

- **Boat** (the machine provider) is Overlay's own account. A person's Boat dashboard, if they have one, says nothing about Overlay billing. Overlay pays Boat for machine time.
- **Overlay credit** is the person's allowance (for example $20/month on Pro) plus any top-ups. Machine compute is charged to it by the lease meter (`ManagedAgentSandboxBilling`) at provider cost plus Overlay's markup, per running minute. Boat stopped runtime is unbilled; provider snapshot retention is separate from runtime accounting.

Everything below is about Overlay credit.

## Remaining credit

`remaining = allowance + top-ups − spend − holds`.

A **hold** (a `budgetReservations` row in `reserved` or `reconcile_required`) is credit set aside before a model or provider call and settled afterwards. The sidebar bar and `allowancePercentUsed` show spend only, so while holds exist the bar reads lower than the credit that is actually left. `GET /api/v1/subscription` returns both `budgetUsedCents` and `budgetRemainingCents`; if `total − used ≠ remaining`, holds are outstanding.

Native workspace-agent turns keep one reservation across durable model steps and aggregate the provider-reported token usage. Known, unambiguous usage is settled idempotently on both success and failure; an ambiguous provider outcome or failed settlement keeps the reservation for reconciliation with the observed token totals. A reservation is released only when the provider was not called or confirmed no usage. Transcript finalization is a separate workflow step.
Gateway usage 404s retry with exponential backoff for about ten minutes, then settle from catalog pricing using observed token counts when a rate is available. Non-404 lookup failures and missing catalog rates remain unresolved for reconciliation.

Model admission uses a reservation ceiling, not the headline catalog price. For models marked `varies_by_provider`, the web server loads Gateway's public model-endpoints pricing, caches validated results for five minutes, and reserves at the maximum published provider, tier, regional, fast and peak rates. Missing endpoint pricing blocks admission before inference rather than falling back to a cheaper quote. Both Harness quotes/dispatch and legacy chat reservations use this ceiling. These rates are never used as the actual charge: provider receipts, markup, idempotent settlement and the over-reservation reconciliation guard are unchanged. Existing failed runs and reconciliation rows are not replayed or rewritten by this change.

Harness terminal cancellation and failure may release a zero-cost free-router model hold only when no provider billing reservation exists. Paid, externally billed, nonzero-cost, and provider-started holds remain unresolved until authoritative usage evidence settles them.

## Reconciling held credit

Use the internal reconciliation audit to identify provider-started holds requiring
authoritative cost evidence. Retain financial and customer-specific audit records
in private operator storage. Failed structured-output generation, write conflicts,
missing provider receipts and underestimated reservations can all leave a hold
requiring reconciliation; failure alone does not establish zero provider cost.

### Late provider evidence after release

A released hold is not evidence that the provider incurred no cost. Preserve the customer release and its reconciliation audit; do not release it again or reopen it to debit the wallet. The internal `billing/releasedProviderCosts:recordInternal` operation records receipt-backed provider cost and tokens once, with target/account/model guards and conflicting-replay rejection. It changes no monetary balance or subject limit. The operational report includes this absorbed cost even though the customer charge remains zero. Keep detailed receipts and exact-cost reconciliation in private operator storage.

## Machines and credit

Persistent Computers enforce admission in `ComputerService`, including desktop and tool-driven wakes. `ComputerAdmission` requires a payer whose scope and ID match the workspace, then checks that wallet's paid plan and the same minimum start credit as managed machines. Personal paid credit cannot unlock a free workspace. Stop and delete remain available after downgrade or credit exhaustion. Each Computer has a deterministic `computer:<id>` lease created atomically with its owner claim; the member who starts a session and the `agent:<ownerId>` subject for agent Computers are reserved together before allocation or wake. Boat's weighted counters remain authoritative. Idle, budget, and session-expiry stops pause the provider and retain its disk and Computer row; only explicit deletion removes them, after confirmed stop and final settlement.

Hosted third-party Cloud-agent allocation, workflow wakes, and stopped-execution recovery are retired. Existing usage still settles through the shared lease meter and reaper; confirmed-stopped usage may settle and unused holds may be released. Native Computers and supported sandbox leases retain their own admission and lifecycle rules.

Historical Cloud Agent provisioning records retain allocation keys and provider references for cleanup. The operations reconcile route reclaims stale setup attempts without a matching lease, retains retry state when deletion fails, and never resumes a machine.

## Provider inventory reconciliation

The operations reconcile route scans at most two pages of Boat or E2B inventory every 15 minutes; its connected-agent settlement caller runs every minute on both Preview and Production. It reports old live machines without a matching lease, Cloud Agent provision, or Computer record. This is report-only: an environment match alone is not strong ownership evidence, especially for Boat, and automatically stopping or deleting a machine could destroy a customer's disk. Alert on `[sandbox-inventory] unowned provider machines`.

The Computer integration is one cumulative Phase 2 substep, not completion of Phase 2. The schema changes are additive optional lease fields and indexes. No shared Convex deployment or migration was performed by this code change. Do not roll back lifecycle code or remove its fields while runtime holds, activity tokens, maintenance intents, or cleanup evidence remain unresolved: reconcile and settle them first. Provider allocation retries must use the saved exact recipe and key within Boat's idempotency-retention window; an older ambiguous allocation requires operator reconciliation.

- **Floor.** The meter stops and deletes disposable environment machines whose payer is at or below `OVERLAY_SANDBOX_LOW_BALANCE_CUTOFF_CENTS` (default 100, $1.00) of remaining credit. Persistent Computers pause and retain their disk and row at the same boundary; only explicit deletion removes the provider resource after final settlement.
- **Historical start check.** Before hosted third-party runtimes were retired, Cloud Agent creation required more than the floor (`minimumBudgetToStartMachineCents`, floor + 1¢).
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

When the meter kills a disposable environment lease (`budget_exhausted`, `low_balance`), the Boat machine and lease are deleted while the environment remains. A persistent Computer instead pauses on budget or idle stops and retains its disk and Computer row; only explicit deletion removes it after final settlement.

## Cancellation after spending plan credit

A Stripe subscription deletion switches the workspace to Free and disables
automatic top-ups even after paid usage. The balance retains only enough included
funding for already-used credit and outstanding reservations, after grants and
purchased top-ups. It removes unused plan credit while preserving ledger history
and existing holds; cancellation does not reset a billing period or grant a new
paid allowance. Ordinary active-plan reductions still reject insufficient funding.

The release checkout drill found that zeroing the allowance previously rejected
700 micros of used credit, leaving the app paid after Stripe canceled. Regression
coverage exercises internal/server updates, reservations, grants/top-ups, normal
downgrades and older provider events. Acceptance checks the actual subscription
and balance, in addition to webhook receipt; an event row alone is insufficient.

Canceled-plan funding also shrinks when holds are released or settled below their estimate. The ledger retains only consumed spend and remaining reservations; a finished hold cannot restore unused paid credit. Active paid accounts retain their normal allowance.

## Durable remote tasks

### Provider execution accounting

E2B managed-sandbox create and resume use a four-minute pause-on-timeout safety fence. Only a successful runtime meter transaction renews it, bounded by the lease deadline. A five-minute credit headroom covers the next four minutes plus meter latency; a failed scheduler, provider read or ledger commit does not extend runtime. This requires the existing minute-level meter cron. Computers currently use Boat, not E2B; their lifecycle and accounting use the shared lease meter and Boat-specific counter policy, not the E2B timeout fence.

E2B lifecycle events supply completed execution duration and actual CPU/RAM allocation. The meter keys each generation by sandbox reference and execution start time, persists a frozen compute rate card, and settles completed generations exactly once with the lease meter version. Live wall-clock observations are estimates, not final charges: a durable workspace and spend-subject hold covers observed pending compute plus five minutes of actual-allocation headroom. Each tick atomically replaces that lease's hold without borrowing another operation's reservation. The payer remains bound until the hold settles. Final event duration may be shorter than a live estimate without requiring a credit refund.

Provider observations survive a rejected debit; the billed cursor does not advance. Cleanup must confirm stop and complete final settlement before deleting the provider resource. A stopped final observation can be replayed after a resource disappears. Missing or inconsistent evidence keeps the lease in retryable cleanup rather than releasing it as if no usage occurred. Usage operations retain compute cost, pricing and allocation evidence for audit. Settled executions absent beyond the provider's event retention window can leave the cursor only with a persisted retirement watermark; reappearing old evidence fails closed rather than being charged again.

Boat seconds are already size-weighted billable seconds, not ordinary wall-clock seconds. Its authoritative counters must not be replaced by elapsed-time estimates. E2B paused compute is not charged; Boat stopped runtime is unbilled. Boat snapshot retention (including automatic retention for 14 days) is separate from runtime accounting, as is any separately purchased storage.

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

V2 remote tasks bind reservations to the logical run through `remoteRunId`.
Expired/stale-hold policy preserves a task's hold while execution or terminal
settlement is unresolved. The original hard deadline still triggers stop; it cannot
release unknown consumed credit without usage/termination evidence. Recovery cannot reset that deadline, revive a settled
reservation, reset spend, or reset cumulative machine metering baselines. A new
billable task requires a new idempotent reservation boundary. Cancellation stays
requested until host stop is confirmed; finalization intents retry usage/ordinary
idle cleanup with the existing ledger idempotency keys after terminal ingestion.
Machine time continues during human approval waits and pending stop delivery.
The lifecycle coordinator retries cloud stop-proof checks on its durable timer
while cancelling. A delivered notification does not finish this responsibility:
its first check may precede the healthy-host grace period. Only provider/host
stop proof closes the run and releases its reservation.

A lifecycle-v2 cancellation timeout is not evidence that a disconnected BYO process
stopped. Keep the run and reservation unresolved until host stop/provider isolation
is confirmed; elapsed time must not trigger terminal settlement or release its hold.

### Aggregate Preview provider guard

`OVERLAY_PREVIEW_PROVIDER_BUDGET_CENTS` caps a PR backend's metered commitments
across all wallets (default $5; bounded at $25 for explicitly approved acceptance).
Retail reservations conservatively cover provider cost. Admission counts every
active wallet hold and the durable consumed-spend counter; fixture refills and
billing-period resets cannot erase that counter. New paid reservations and
machine headroom fail closed at the cap. Actual incurred settlement and stop
remain possible after exhaustion, so costs cannot disappear or strand a machine.
The guard does not replace provider account limits for unmetered service fees,
retained storage, or activity outside Overlay. Aggregate multiple PRs at the
provider account when a shared account budget is required.

Usage markup is configured with `OVERLAY_USAGE_MARKUP_BPS` on both Next and the
matching Convex backend; see [Workspace billing](workspace-billing.md#usage-markup-configuration).
Computer bootstrap holds and ongoing usage use this same configured rate.

Memory extraction validation failures with complete non-negative integer SDK token
usage follow normal priced settlement. Provider-started failures without measured
usage remain quarantined; failed output is not itself proof of zero cost.
