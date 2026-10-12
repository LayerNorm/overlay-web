# Credit, holds, and agent-machine billing

How the credit a person sees relates to what Overlay enforces, and how Overlay Cloud agent machines are billed. Written after a production check where a person saw 36.8% of their allowance used but only $0.99 left.

## Two separate accounts

- **Boat** (the machine provider) is Overlay's own account. A person's Boat dashboard, if they have one, says nothing about Overlay billing. Overlay pays Boat for machine time.
- **Overlay credit** is the person's allowance (for example $20/month on Pro) plus any top-ups. Machine compute is charged to it by the lease meter (`ManagedAgentSandboxBilling`) at provider cost plus Overlay's markup, per running minute. Paused machines cost storage only.

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

- **Floor.** The meter stops and deletes any machine whose payer is at or below `OVERLAY_SANDBOX_LOW_BALANCE_CUTOFF_CENTS` (default 100, $1.00) of remaining credit. A deleted machine takes its disk with it.
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

When the meter kills a lease (`budget_exhausted`, `low_balance`) the Boat machine and lease are deleted but the agent keeps its environment and a `ready` provision record. The agent page derives `unavailable` (`deriveCloudAgentState`: provision `ready`, no machine) and offers **Start a new machine**, which POSTs `/api/v1/agent-environments/cloud` again; `CloudAgentMachineService.reviveIfMachineGone` then revokes the old environment and clears the record so the normal provisioning runs (it still needs the $1 floor). A message to such an agent fails with the `machine_gone` start-failure message.
