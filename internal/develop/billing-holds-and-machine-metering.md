# Credit, holds, and agent-machine billing

How the credit a person sees relates to what Overlay enforces, and how Overlay Cloud agent machines are billed. Written after a production check where a person saw 36.8% of their allowance used but only $0.99 left.

## Two separate accounts

- **Boat** (the machine provider) is Overlay's own account. A person's Boat dashboard, if they have one, says nothing about Overlay billing. Overlay pays Boat for machine time.
- **Overlay credit** is the person's allowance (for example $20/month on Pro) plus any top-ups. Machine compute is charged to it by the lease meter (`ManagedAgentSandboxBilling`) at provider cost plus Overlay's markup, per running minute. Boat stopped runtime is unbilled; provider snapshot retention is separate from runtime accounting.

Everything below is about Overlay credit.

## Remaining credit

`remaining = allowance + top-ups − spend − holds`.

A **hold** (a `budgetReservations` row in `reserved` or `reconcile_required`) is credit set aside before a model or provider call and settled afterwards. The sidebar bar and `allowancePercentUsed` show spend only, so while holds exist the bar reads lower than the credit that is actually left. `GET /api/v1/subscription` returns both `budgetUsedCents` and `budgetRemainingCents`; if `total − used ≠ remaining`, holds are outstanding.

## Stuck holds (fixed 2026-10-02)

A call that failed, or finished costing more than was held, used to leave its reservation in `reconcile_required`, waiting for "provider evidence" that nothing supplied, and it counted as held forever. One account had 356 of them, $11.66 of a $20 allowance.

`settleStaleBudgetReservationsInternal` (`convex/platform/usage.ts`, hourly cron `stale usage hold settlement`, batches of 8 that reschedule themselves) settles any hold older than 6 hours through the same audited path as the ops mutation (`applyReservationReconciliation`; evidence source `system:stale-hold-policy`, reference = the reservation id):

| Hold's error | Settled as | Why |
| --- | --- | --- |
| `actual_cost_exceeds_reservation` | **Finalized** at the held amount | The work finished and cost more than was held; the ledger refused to record it, so spend was understated. |
| anything else (provider error, schema mismatch, lost outcome) | **Released** | The person is not charged for work they did not get. |

The first run on the affected account charged 122 finished agent runs ($8.63) and released 234 failed calls ($3.03): usage went from 36.8% to 80.1%, remaining from $0.99 to $3.98, and remaining now equals allowance minus spend.

Known sources of failed holds, still open (see the follow-up task): `knowledge.compile-memory-profile` failing with "No object generated: response did not match schema" on `gemini-2.5-flash-lite` (a new hold on every run), billing document write conflicts ("Documents read from or written to the billing…"), a provider path returning not found, and agent reservations that are estimated lower than real cost.

To look at a person's holds in production: `CONVEX_DEPLOYMENT=prod:colorful-chickadee-419 npx convex data budgetReservations --limit 5000 --order desc --format jsonLines`, filter by `userId` and `status`.

## Machines and credit

Persistent Computers enforce admission in `ComputerService`, including desktop and tool-driven wakes. `ComputerAdmission` requires a payer whose scope and ID match the workspace, then checks that wallet's paid plan and the same minimum start credit as managed machines. Personal paid credit cannot unlock a free workspace. Stop and delete remain available after downgrade or credit exhaustion. Each Computer has a deterministic `computer:<id>` lease created atomically with its owner claim; the member who starts a session and the `agent:<ownerId>` subject for agent Computers are reserved together before allocation or wake. Boat's weighted counters remain authoritative. Idle, budget, and session-expiry stops pause the provider and retain its disk and Computer row; only explicit deletion removes them, after confirmed stop and final settlement.

Cloud-agent machine allocation, explicit resume/restart controls, workflow wakes, and stopped-execution recovery recheck paid-workspace and finite-credit admission using the authenticated actor or the remote run's stored actor and agent. Pause, status, stop, and teardown remain available after downgrade. Missing actor or agent identity on a remote run fails closed before machine or recovery work. Remote resume, retry and start-fresh controls on Overlay Cloud check admission before recording the control, so a refused workspace does not queue work. Every machine meter tick also rechecks the workspace plan in the ledger mutation: once a workspace is no longer paid, ticks that would keep a running machine alive, add a hold, or charge without confirmed-stopped provider evidence return \`paid_plan_required\`, and the scheduler stops the machine (Computers keep their disk). Final settlement of confirmed-stopped usage and release of an unused hold remain allowed. This admission recheck is not a pre-allocation cloud hold or durable allocation, and does not solve orphan reconciliation.

The Computer integration is one cumulative Phase 2 substep, not completion of Phase 2. The schema changes are additive optional lease fields and indexes. No shared Convex deployment or migration was performed by this code change. Do not roll back lifecycle code or remove its fields while runtime holds, activity tokens, maintenance intents, or cleanup evidence remain unresolved: reconcile and settle them first. Provider allocation retries must use the saved exact recipe and key within Boat's idempotency-retention window; an older ambiguous allocation requires operator reconciliation.

- **Floor.** The meter stops and deletes disposable environment machines whose payer is at or below `OVERLAY_SANDBOX_LOW_BALANCE_CUTOFF_CENTS` (default 100, $1.00) of remaining credit. Persistent Computers pause and retain their disk and row at the same boundary; only explicit deletion removes the provider resource after final settlement.
- **Start check.** Creating a cloud agent now needs more than the floor (`minimumBudgetToStartMachineCents`, floor + 1¢) and answers `402 insufficient_credit` otherwise; before this, a machine started under the floor was deleted about a minute later (`stopReason: budget_exhausted` on its lease).
- **What the person sees.** The agent page says "Machine stopped" with an explanation when the machine is gone. There is no automatic top-up for machines; the person adds credit and recreates the agent.
- Leases live in `agentSandboxLeases`; `usage.stopReason` records why one ended.

## Hosts, redirects, and machine-facing URLs

Production's app URL is the apex (`https://getoverlay.io`), which redirects to `https://www.getoverlay.io`. A cross-origin redirect drops the `Authorization` header, so a machine pointed at the apex enrolled (no header) and then got 401 on every signed request. Machine-facing URLs (the host's server URL, the per-run MCP URL, the agent gateway) come from `getAgentFacingBaseUrl()`, which reads `OVERLAY_AGENT_PUBLIC_URL` (production: `https://www.getoverlay.io`) and falls back to the app URL. Set it on any deployment whose app URL redirects. The MCP/OAuth metadata is built from the host the client called instead (`mcpBaseUrl`), and strict OAuth clients must use the `www` address.

## Production environment for Overlay Cloud agents

Flags (all set on production): `OVERLAY_FEATURE_CONNECTED_AGENT_CONTROL_PLANE`, `OVERLAY_FEATURE_REMOTE_AGENT_RUNS`, `OVERLAY_FEATURE_OVERLAY_CLOUD_ENVIRONMENTS`, `OVERLAY_CONNECTED_AGENTS_ROLLOUT_STAGE` (`internal` limits cloud agents to `OVERLAY_CONNECTED_AGENTS_INTERNAL_WORKSPACE_IDS`), `OVERLAY_HOSTED_PROVIDER_ACCESS_ENABLED=1` (without it tool assembly throws the hosted-provider kill-switch error), `BOX_API_KEY` or `BOAT_API_KEY`, `OVERLAY_AGENT_PUBLIC_URL`. The machine image is the Boat snapshot `overlay-agent-v5` (`OVERLAY_CLOUD_AGENT_IMAGE` overrides it).

## Checking production by hand

- Everything a signed-in person can do is available to test through their own browser session: calls from the page need `x-overlay-workspace-id` set (the personal workspace id looks like `personal-xxxxxxx`).
- A Boat machine's state, its host log (`~/.overlay/agent-host.log`), and whether the host is checking in can be read through the Boat API with the same key the app uses.
- The in-app browser renders only while its pane is shown (a hidden or wedged tab sits on the loading shell); open a fresh tab with `preview_start`.
- Real model runs need a real credential entered by the owner; never type credentials into production on their behalf.


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

This accounting checkpoint does not complete Phase 2. Scoped provider inventory reconciliation and alerts, storage accounting, legacy `CloudAgentMachineService` pre-enrollment allocation recovery, and Phase 3 harness/preview QA remain follow-up work. Host viewer activity is not supervised by this Computer action-token integration.

### Isolated Computer preview QA

The internal Preview seed retains the free Personal workspace and adds a separate
`Computer QA` workspace for the configured sandbox identity. Its workspace account
has $5 of synthetic included credit, no Stripe customer/subscription, and no
automatic top-ups. Re-seeding never restores spent credit or changes an existing
fixture's plan, balance, holds or membership. The seed refuses non-Preview backends.
This is test ledger credit, not a payment or free provider compute.

Enable `OVERLAY_FEATURE_COMPUTERS=1` only on the feature's Preview branch, reusing
the shared Preview Boat credential. Keep production and other Preview branches
unchanged. Test free admission in Personal and funded lifecycle in Computer QA;
allocate at most one small disposable Computer, then stop and delete that resource.
Record its ID, provider reference and operation timestamps for cost reconciliation.
Preview registers no Convex crons: the four-minute provider fence is not proof of
Overlay's ten-minute idle supervisor. Scheduled metering/idle acceptance requires
separate controlled supervision; do not claim it from a successful desktop open.

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
