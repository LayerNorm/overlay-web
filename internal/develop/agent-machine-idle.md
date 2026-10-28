# When an agent machine goes idle

An Overlay Cloud agent's machine stops **10 minutes after its last run ends** (`MANAGED_SANDBOX_IDLE_TIMEOUT_MS`), then wakes on the next message. It is event-based, with the sweep as a safety net.

## The timer (primary)

- A run ending (`ManagedAgentSandboxBilling.settle`) calls `patchSandboxLeaseUsage` with `idleCheckInMs`. The Convex mutation writes a fresh `usage.idleToken` and `usage.idleCheckAt` on the lease and schedules `agents/idleStop:runIdleCheck(workspaceId, leaseId, token)` for then.
- A new run (`reserve`) patches `idleToken: null`, which makes any pending timer stale; nothing is deleted. Waking a machine for something other than a run (resume, applying a profile) and creating one also start a timer.
- When the timer fires, `runIdleCheck` calls the BFF reconcile route with `{ idleCheck }` (provider credentials stay in the BFF). `idleCheck` does nothing if the token is not the lease's current one. If there was activity since it was set, it reschedules to the end of the window. If a run is still going, it does nothing (that run's end sets the next timer). Otherwise it final-meters and stops the machine; the lease stays `running` and the next message resumes it.

## The sweep (fallback)

The meter pass (`operations/reconcile`, called by the Convex cron every minute for billing and run supervision) is also the reconciler, but its idle part runs only once every 10 minutes: on the ticks in the first 90 seconds of each 10-minute block (`idleFallbackDue`). Between those, a machine with a lost timer can overstay by up to ~10 minutes plus the grace, which is the price of keeping the safety net cheap. For each running lease it (a) starts a timer when none is live (none, or one more than 2 minutes overdue, i.e. presumed lost) and no run is going, and (b) stops a machine that is idle more than the window plus a 2-minute grace, which covers a timer that was scheduled but never delivered. It does not idle-stop at the instant a run settles (`idleStop: 'none'`).

## "A run is going"

`environmentHasActiveRunsByServer`: an `agentRemoteSessions` row for the environment in `starting`, `running`, `waiting_for_approval`, `waiting_for_input`, `recovering`, `needs_attention`, or `cancelling`. This replaces trusting `usage.activeUntil` (a run's maximum duration, up to 24 hours), so a run that never settles no longer pins a machine; healthy human waits are protected through their hard deadline; v2 runs use canonical process observations and explicit stop/attention phases instead of the legacy abandonment decision, and a failed lookup counts as "running" (keep it up, retry next pass). `activeUntil` is still written but no longer decides idleness.

## Notes

- The window is `min(lease.usage.idleTimeoutMs, default)`, so leases created under the old 15-minute default also use 10.
- Cost: one scheduled function per run end, one Convex query per idle-window check, and the existing sweep; nothing per agent that is stopped.

Quiet transcript output is not proof of process loss. A healthy pending approval keeps the machine active; automatic parking requires proven durable approval restoration and is not enabled. V2 attention/cancellation keeps execution protected until the old writer is proven stopped. Idle checks remain the existing timer/meter path after terminal settlement.

Lifecycle-v2 runs awaiting cancellation remain unresolved until a host stop or
provider isolation is confirmed. A disconnected host exceeding a grace period
cannot be treated as stopped; its execution and billing hold may still be active.

The host's thirty-second environment heartbeat runs independently of command polling,
including hydration and provider startup. Concurrent heartbeat requests coalesce, and
shutdown clears the timer and drains a request already in flight. This reports host
connectivity; it does not claim that a provider process is live before it starts.

Graceful host shutdown stops intake, confirms adapter termination, settles prompt callbacks,
flushes buffered text, and drains existing drive work before releasing cache ownership. The
state store closes only after outstanding upload acknowledgements settle. Unconfirmed stops
retain ownership and require inspection; they cannot authorize a replacement writer. This
shutdown ordering does not replace lifecycle-v2 process fencing or provider isolation proof.

## Protected Preview acceptance

Scheduled idle-stop and meter fallback callbacks use the shared `fetchAppCallback`
bridge. Preview requires its exact PR app origin and existing hosting bypass
credential in addition to application authentication; cross-PR/production targets
and redirects are refused. Enable Preview background jobs only with isolated
providers and verified callback configuration. Prove the actual timer and sweep
rather than inferring idle-stop from provider timeout or a successful UI open.
