# When an agent machine goes idle

An Overlay Cloud agent's machine stops **10 minutes after its last run ends** (`MANAGED_SANDBOX_IDLE_TIMEOUT_MS`), then wakes on the next message. It is event-based, with the sweep as a safety net.

## The timer (primary)

- A run ending (`ManagedAgentSandboxBilling.settle`) calls `patchSandboxLeaseUsage` with `idleCheckInMs`. The Convex mutation writes a fresh `usage.idleToken` and `usage.idleCheckAt` on the lease and schedules `agents/idleStop:runIdleCheck(workspaceId, leaseId, token)` for then.
- A new run (`reserve`) patches `idleToken: null`, which makes any pending timer stale; nothing is deleted. Waking a machine for something other than a run (resume, applying a profile) and creating one also start a timer.
- When the timer fires, `runIdleCheck` calls the BFF reconcile route with `{ idleCheck }` (provider credentials stay in the BFF). `idleCheck` does nothing if the token is not the lease's current one. If there was activity since it was set, it reschedules to the end of the window. If a run is still going, it does nothing (that run's end sets the next timer). Otherwise it final-meters and stops the machine; the lease stays `running` and the next message resumes it.

## The sweep (fallback)

The per-minute meter pass (`operations/reconcile`, called by the Convex cron) is also the reconciler. For each running lease it (a) starts a timer when none is live (none, or one more than 2 minutes overdue, i.e. presumed lost) and no run is going, and (b) stops a machine that is idle more than the window plus a 2-minute grace, which covers a timer that was scheduled but never delivered. It does not idle-stop at the instant a run settles (`idleStop: 'none'`).

## "A run is going"

`environmentHasActiveRunsByServer`: an `agentRemoteSessions` row for the environment in `starting`, `running`, `waiting_for_approval`, or `recovering`. This replaces trusting `usage.activeUntil` (a run's maximum duration, up to 24 hours), so a run that never settles no longer pins a machine; abandoned runs are failed by the supervisor after 15 minutes, and a failed lookup counts as "running" (keep it up, retry next pass). `activeUntil` is still written but no longer decides idleness.

## Notes

- The window is `min(lease.usage.idleTimeoutMs, default)`, so leases created under the old 15-minute default also use 10.
- Cost: one scheduled function per run end, one Convex query per idle-window check, and the existing sweep; nothing per agent that is stopped.
