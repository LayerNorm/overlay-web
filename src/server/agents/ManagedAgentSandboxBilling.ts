import 'server-only'

import type { AgentSandboxLease } from '@overlay/workspace-contracts'
import type { SandboxInstance, SandboxLifecycleState, SandboxRuntime, SandboxUsage } from '@overlay/sandbox-runtime'
import type { BoxSandboxRuntime } from '@overlay/sandbox-runtime/box'
import type { Entitlements } from '@/shared/app/app-contracts'
import type { GenerationUsagePolicy } from '@/server/outputs/GenerationUsagePolicy'
import { billableBudgetCentsFromProviderUsd, resolveBillingPayer } from '@/server/billing/billing-runtime'
import { getMarkupBasisPoints } from '@/shared/billing/billing-pricing'
import { logger } from '@/server/observability/logger'
import type {
  ConnectedAgentRepository,
  ConnectedAgentSandboxBilling,
  ConnectedAgentSandboxLeasePayer,
  RemoteAgentUsageSettlement,
} from './ConnectedAgentRepository'
import { MANAGED_SANDBOX_IDLE_TIMEOUT_MS, managedSandboxRuntimeFromEnv } from './managed-sandbox-runtime'

const DEFAULT_RESOURCES = { diskGiB: 10, memoryGiB: 4, vcpus: 2 }
const DEFAULT_LOW_BALANCE_CUTOFF_CENTS = 100
const DEFAULT_BOOTSTRAP_COVERAGE_MS = 10 * 60_000
const DEFAULT_BOOTSTRAP_EGRESS_BYTES = 1 << 30
const DEFAULT_METER_LEASE_LIMIT = 100
const CLEANUP_RETRY_BASE_MS = 60_000
const CLEANUP_RETRY_MAX_MS = 30 * 60_000
const MARKUP_MULTIPLIER = 1 + getMarkupBasisPoints() / 10_000
/** How long past its idle window a machine may run before the sweep (the fallback) stops it itself. */
const IDLE_FALLBACK_GRACE_MS = 2 * 60_000
const ACTIVE_STATUSES = ['reserved', 'provisioning', 'running'] as const
const REAPABLE_STATUSES = ['stopping', 'cleanup_failed'] as const

export type ManagedSandboxMeterTick = {
  leaseId: string
  outcome:
    | 'metered'
    | 'adopted'
    | 'skipped'
    | 'conflict'
    | 'killed'
    | 'released'
    | 'cleanup_failed'
    | 'error'
  chargedCents?: number
  reason?: string
  remainingCents?: number
}

export type ManagedSandboxMeterResult =
  | { applied: true; chargedCents?: number; chargedUsd?: number; remainingCents?: number; usage: SandboxUsage }
  | { applied: false; reason: string; remainingCents?: number }

export class ManagedAgentSandboxBilling {
  constructor(private readonly dependencies: {
    policy: GenerationUsagePolicy
    repository: ConnectedAgentRepository
    runtime?: (provider: string) => SandboxRuntime
    now?: () => number
  }) {}

  // A turn's upfront hold is only a bootstrap: enough to cover the low-balance
  // floor plus a short worst-case coverage window. Real usage is debited by
  // the per-lease meter (`meterLeases`), which runs on a cron tick and keeps a
  // cumulative usage cursor on the lease itself.
  async reserve(args: {
    agentId: string
    entitlements: Entitlements
    environmentId: string
    idempotencyKey: string
    operationId: string
    requestFingerprint: string
    userId: string
    workspaceId: string
    /** The turn may run this long; the idle meter will not stop the machine before then. */
    activeForMs?: number
  }): Promise<ConnectedAgentSandboxBilling> {
    const lease = await this.dependencies.repository.getActiveSandboxLease({
      workspaceId: args.workspaceId,
      environmentId: args.environmentId,
    })
    if (!lease?.providerReference || lease.status !== 'running') throw new Error('MANAGED_SANDBOX_LEASE_UNAVAILABLE')
    const runtime = this.runtime(lease.provider)
    // The lease's sandbox may be gone (idle expiry, reset, provider reclaim) —
    // the turn's acquire step recreates it and repoints this same lease. A
    // dead instance still bills correctly: the recreated sandbox starts at
    // zero usage, so an empty baseline meters its full lifetime. The baseline
    // read must not resume an idle-stopped sandbox — the acquire step owns
    // resumption.
    const baselineUsage = await runtime.reconnect(lease.providerReference, { resume: false })
      .then(async (instance) => await instance.usage())
      .catch((error) => {
        logger.warn('[managed-harness] sandbox baseline unavailable — treating as fresh', {
          environmentId: args.environmentId,
          error: error instanceof Error ? error.message : String(error),
          workspaceId: args.workspaceId,
        })
        return {} as SandboxUsage
      })
    const resources = sandboxResources(lease.usage)
    const coverageUsd = sandboxReservationCostUsd({
      provider: lease.provider,
      resources,
      maxRunTimeMs: sandboxBootstrapCoverageMs(),
      maxSandboxEgressBytes: sandboxBootstrapEgressBytes(),
    })
    if (coverageUsd > sandboxProviderCostLimitUsd()) {
      throw new ManagedAgentSandboxBudgetError(503, 'sandbox_provider_cost_limit')
    }
    // policy.reserve applies the markup to providerCostUsd, so express the
    // bootstrap hold (coverage + low-balance floor) as a provider-cost value.
    const bootstrapCents = billableBudgetCentsFromProviderUsd(coverageUsd) + sandboxLowBalanceCutoffCents()
    const reservation = await this.dependencies.policy.reserve({
      entitlements: args.entitlements,
      idempotencyKey: args.idempotencyKey,
      kind: 'sandbox',
      modelId: `sandbox/${lease.provider}`,
      operationId: args.operationId,
      providerCostUsd: bootstrapCents / (100 * MARKUP_MULTIPLIER),
      requestFingerprint: args.requestFingerprint,
      programmaticSubjectId: `agent:${args.agentId}`,
      userId: args.userId,
      workspaceId: args.workspaceId,
    })
    if (!reservation.ok) throw new ManagedAgentSandboxBudgetError(reservation.status, reservation.code)
    // Persist the billing payer on the lease so the periodic meter debits the
    // same wallet between turns and during approval waits. Best effort: the
    // meter falls back to resolving the environment approver.
    const payer = await resolveBillingPayer({
      programmaticSubjectId: `agent:${args.agentId}`,
      userId: args.userId,
      workspaceId: args.workspaceId,
    }).then((resolved) => sandboxLeasePayer(resolved, args.userId)).catch((_error) => undefined)
    const activityAt = this.now()
    await this.dependencies.repository.patchSandboxLeaseUsage({
      workspaceId: args.workspaceId,
      leaseId: lease.id,
      // A starting turn is activity, and the machine stays up for its whole run.
      // A starting turn cancels the idle timer (a null token makes any pending check stale); the turn's end sets a new one.
      patch: { ...(payer ? { lastPayer: payer } : {}), lastActiveAt: activityAt, activeUntil: activityAt + Math.max(0, args.activeForMs ?? 0), idleToken: null, idleCheckAt: null },
      now: this.now(),
    }).catch((error) => {
      logger.warn('[managed-harness] sandbox lease payer write failed', {
        environmentId: args.environmentId,
        error: error instanceof Error ? error.message : String(error),
      })
    })
    return {
      baselineUsage: serializableUsage(baselineUsage),
      leaseId: lease.id,
      provider: lease.provider,
      providerReference: lease.providerReference,
      reservationId: reservation.reservationId,
      resources,
      startedAt: this.now(),
    }
  }

  async release(args: { billing?: ConnectedAgentSandboxBilling; userId: string; reason: string }) {
    await this.dependencies.policy.release({
      reservationId: args.billing?.reservationId,
      userId: args.userId,
      reason: args.reason,
    })
  }

  // Periodic driver: meter every active lease and reap leases whose stop was
  // requested (low balance, environment revocation) or whose cleanup failed.
  async meterLeases(args?: { limit?: number }): Promise<{ disabled?: boolean; ticks: ManagedSandboxMeterTick[] }> {
    if (sandboxMeterDisabled()) return { disabled: true, ticks: [] }
    const limit = Math.max(1, Math.min(500, args?.limit ?? sandboxMeterLeaseLimit()))
    const [active, reapable] = await Promise.all([
      this.dependencies.repository.listSandboxLeases({ statuses: [...ACTIVE_STATUSES], limit }),
      this.dependencies.repository.listSandboxLeases({ statuses: [...REAPABLE_STATUSES], cleanupBefore: this.now(), limit }),
    ])
    const ticks: ManagedSandboxMeterTick[] = [
      ...(await Promise.all(active.map((lease) => this.tickLease(lease)))),
      ...(await Promise.all(reapable.map((lease) => this.reapLease(lease)))),
    ]
    // Fleet-level signal once per sweep when box leases exist: box bills from
    // a shared account pool, so `canStart`/`remainingSeconds` exhaustion would
    // stall every box environment at once.
    if (active.concat(reapable).some((lease) => lease.provider === 'box')) {
      await this.probeBoxLimits()
    }
    return { ticks }
  }

  /**
   * The idle timer fired (Convex scheduled it when a run ended). Ignored when the token is no longer the lease's
   * current one (a newer message or timer replaced it). Otherwise the machine is stopped if nothing has happened for
   * the whole idle window and no run is going; if there was activity since, the check moves to the end of the window.
   */
  async idleCheck(args: { workspaceId: string; leaseId: string; token: string }): Promise<{
    outcome: 'gone' | 'stale' | 'rescheduled' | 'busy' | 'checked'
  }> {
    const lease = await this.dependencies.repository.getSandboxLease({ workspaceId: args.workspaceId, leaseId: args.leaseId })
    if (!lease || lease.status !== 'running') return { outcome: 'gone' }
    const usage = lease.usage ?? {}
    if (usage.idleToken !== args.token) return { outcome: 'stale' }
    const now = this.now()
    const remainingMs = idleActivityTimestamp(usage, lease, now) + idleWindowMs(usage) - now
    if (remainingMs > 0) {
      await this.dependencies.repository.patchSandboxLeaseUsage({
        workspaceId: lease.workspaceId, leaseId: lease.id, patch: {}, now, idleCheckInMs: remainingMs,
      })
      return { outcome: 'rescheduled' }
    }
    // A run is going: its end sets the next timer, so nothing to do now.
    if (await this.environmentHasActiveRuns(lease)) return { outcome: 'busy' }
    await this.meterLeaseWithRetry(lease, { idleStop: 'timer' })
    return { outcome: 'checked' }
  }

  /** True when a run on the lease's environment has not finished. A failed lookup counts as running (keep it up, retry). */
  private async environmentHasActiveRuns(lease: AgentSandboxLease): Promise<boolean> {
    const repository = this.dependencies.repository
    if (typeof repository.environmentHasActiveRuns !== 'function') return finiteNumber(lease.usage?.activeUntil) > this.now()
    return await repository.environmentHasActiveRuns({ environmentId: lease.environmentId }).catch((_error) => true)
  }

  /** Nothing has happened for the whole idle window (plus `graceMs`) and no run is going. */
  private async leaseIsIdle(lease: AgentSandboxLease, now: number, graceMs: number): Promise<boolean> {
    const usage = lease.usage ?? {}
    if (now - idleActivityTimestamp(usage, lease, now) <= idleWindowMs(usage) + graceMs) return false
    return !(await this.environmentHasActiveRuns(lease))
  }

  // One atomic meter tick for a lease: read the provider's cumulative usage,
  // compute the delta against the persisted cursor, and commit debit + cursor
  // in a single transaction on the repository side. A lease whose usage was
  // never metered adopts its current counters as the cursor (no charge) —
  // billing starts from the first metered read, and freshly provisioned leases
  // seed an empty cursor so their full lifetime is billed.
  async meterLease(lease: AgentSandboxLease, options?: { minRemainingCents?: number; idleStop?: 'timer' | 'sweep' | 'none' }): Promise<ManagedSandboxMeterResult> {
    const now = this.now()
    const usage = lease.usage ?? {}
    const storedCursor = usage.meteredUsage && typeof usage.meteredUsage === 'object'
      ? usage.meteredUsage as Record<string, unknown>
      : undefined
    const expectedMeterVersion = typeof usage.meterVersion === 'number' ? usage.meterVersion : 0
    const stopping = lease.status === 'stopping' || lease.status === 'cleanup_failed'

    let effectiveLease = lease
    let probe = lease.providerReference
      ? await this.instanceProbe(lease.provider, lease.providerReference)
      : null
    if (probe === null && lease.providerReference) {
      // The acquire step may have recreated the sandbox and repointed the
      // lease since this snapshot was read — follow the repoint once.
      const current = await this.dependencies.repository.getActiveSandboxLease({
        workspaceId: lease.workspaceId,
        environmentId: lease.environmentId,
      }).catch((_error) => null)
      if (current && current.id === lease.id && current.providerReference && current.providerReference !== lease.providerReference) {
        const probeAfterRepoint = await this.instanceProbe(current.provider, current.providerReference)
        if (probeAfterRepoint) {
          probe = probeAfterRepoint
          effectiveLease = current
        }
      }
    }
    if (probe === null) return { applied: false, reason: 'usage_unavailable' }

    const cursorReference = typeof usage.meteredProviderReference === 'string' ? usage.meteredProviderReference : undefined
    const activeReference = effectiveLease.providerReference
    const legacyCursor = storedCursor === undefined
    const staleCursor = !legacyCursor && cursorReference !== undefined && activeReference !== undefined && cursorReference !== activeReference
    const baseline = legacyCursor || staleCursor ? {} : storedCursor
    // A repointed sandbox starts its counters at zero — bill the new
    // instance's full lifetime. A legacy (never-metered) cursor instead
    // adopts current counters without charging pre-meter history.
    const chargeEnabled = !legacyCursor
    const meteredAt = finiteNumber(usage.meteredAt) || effectiveLease.runtimeStartedAt || now
    const elapsedMs = stopping ? 0 : Math.max(0, now - meteredAt)
    // Meter reads never resume a stopped session. Some providers only publish
    // cumulative counters after a session ends, so a stopped instance is
    // billed from its real counters while a running one falls back to elapsed
    // wall-clock — see usageDelta for the virtual-cursor rule that keeps the
    // final post-stop total from double-charging.
    const instanceRunning = probe.status !== 'stopped' && probe.status !== 'archived' && probe.status !== 'deleted' && probe.status !== 'failed'
    let idleStoppedNow = false
    // Provider-side idle-stop: Box has no idle timer, so Overlay stops idle machines itself, the lease stays
    // 'running', and the next turn's acquire resumes it. The primary trigger is the idle timer (`idleCheck`, set when
    // a run ends); this sweep is the fallback for a timer that never fired, so it waits a grace period past the
    // window. The tick still bills the elapsed window it ran through.
    if (!stopping && instanceRunning && typeof probe.instance.stop === 'function' && options?.idleStop !== 'none'
      && await this.leaseIsIdle(effectiveLease, now, options?.idleStop === 'timer' ? 0 : IDLE_FALLBACK_GRACE_MS)) {
      const idleForMs = now - idleActivityTimestamp(usage, effectiveLease, now)
      await probe.instance.stop().then(() => {
        idleStoppedNow = true
        logger.info('Managed sandbox idle-stopped', {
          environmentId: effectiveLease.environmentId,
          idleForMs,
          trigger: options?.idleStop === 'timer' ? 'timer' : 'sweep',
          leaseId: effectiveLease.id,
          workspaceId: effectiveLease.workspaceId,
        })
      }).catch((error) => {
        logger.warn('Managed sandbox idle-stop failed', {
          environmentId: effectiveLease.environmentId,
          error: error instanceof Error ? error.message : String(error),
          leaseId: effectiveLease.id,
        })
      })
    }
    // Fallback for a missing or overdue idle timer (a lost scheduled job, a run that ended without one): start it.
    if (!stopping && instanceRunning && effectiveLease.status === 'running' && !idleStoppedNow && options?.idleStop !== 'none'
      && !idleTimerIsLive(usage, now)
      && !(await this.environmentHasActiveRuns(effectiveLease))) {
      const remainingMs = idleActivityTimestamp(usage, effectiveLease, now) + idleWindowMs(usage) - now
      await this.dependencies.repository.patchSandboxLeaseUsage({
        workspaceId: effectiveLease.workspaceId,
        leaseId: effectiveLease.id,
        patch: {},
        now,
        idleCheckInMs: Math.max(1_000, remainingMs),
      }).catch((_error) => undefined)
    }
    if (probe.usage === null) {
      // Stopped instance with unreadable counters (a provider that does not
      // report metrics for a stopped sandbox): advance the meter window without charging so the
      // stopped span is never billed as elapsed on the next running tick. A
      // never-metered lease has no window to advance — its first successful
      // read adopts counters instead.
      if (!instanceRunning && storedCursor !== undefined) {
        const bumped = await this.dependencies.repository.meterSandboxLease({
          workspaceId: effectiveLease.workspaceId,
          leaseId: effectiveLease.id,
          now,
          expectedMeterVersion,
          meteredUsage: baseline,
          meteredProviderReference: activeReference,
          meteredAt: now,
          minRemainingCents: Math.max(0, options?.minRemainingCents ?? sandboxLowBalanceCutoffCents()),
        })
        if (!bumped.applied) return bumped
        return { applied: true, usage: {} }
      }
      return { applied: false, reason: 'usage_unavailable' }
    }
    const currentUsage = probe.usage
    const delta = usageDelta(baseline, currentUsage, instanceRunning ? elapsedMs : 0)
    const baselineWallMs = finiteNumber(baseline.wallTimeMs)
    const virtualWallApplied = currentUsage.wallTimeMs !== undefined
      && currentUsage.wallTimeMs <= baselineWallMs
      && instanceRunning
      && elapsedMs > 0
    const resources = sandboxResources(usage)
    const providerCostUsd = chargeEnabled ? sandboxCostUsd({
      provider: effectiveLease.provider,
      resources,
      usage: delta,
    }) : 0
    const costCents = chargeEnabled ? billableBudgetCentsFromProviderUsd(providerCostUsd) : 0
    const payer = await this.resolveLeasePayer(effectiveLease)
    if (costCents > 0 && !payer) {
      logger.warn('Managed sandbox meter skipped — no billing payer resolved', {
        environmentId: effectiveLease.environmentId,
        leaseId: effectiveLease.id,
        workspaceId: effectiveLease.workspaceId,
      })
      return { applied: false, reason: 'no_payer' }
    }
    // The stored cursor records what has been *billed through*, not what the
    // provider last reported: when a provider hides counters mid-session, the
    // cursor advances by the elapsed estimate so the post-stop real total
    // nets out instead of double-charging the whole session.
    const cursorUsage = {
      ...serializableUsage(currentUsage),
      ...(currentUsage.wallTimeMs === undefined
        ? {}
        : { wallTimeMs: Math.max(currentUsage.wallTimeMs, baselineWallMs + (virtualWallApplied ? elapsedMs : 0)) }),
    }
    const result = await this.dependencies.repository.meterSandboxLease({
      workspaceId: effectiveLease.workspaceId,
      leaseId: effectiveLease.id,
      now,
      expectedMeterVersion,
      meteredUsage: cursorUsage,
      meteredProviderReference: activeReference,
      meteredAt: now,
      ...(payer ? { payer } : {}),
      ...(costCents > 0 ? {
        charge: {
          costCents,
          durationSeconds: (delta.wallTimeMs ?? 0) / 1_000,
          modelId: `sandbox/${effectiveLease.provider}`,
          providerCostUsd,
          metadata: {
            environmentId: effectiveLease.environmentId,
            provider: effectiveLease.provider,
            providerReference: activeReference ?? null,
            meterTick: true,
          },
        },
      } : {}),
      minRemainingCents: Math.max(0, options?.minRemainingCents ?? sandboxLowBalanceCutoffCents()),
    })
    if (!result.applied) return result
    return {
      applied: true,
      usage: currentUsage,
      ...(costCents > 0 ? { chargedCents: costCents, chargedUsd: providerCostUsd } : {}),
      ...(result.remainingCents === undefined ? {} : { remainingCents: result.remainingCents }),
    }
  }

  async settle(settlement: RemoteAgentUsageSettlement): Promise<void> {
    const billing = settlement.sandboxBilling
    if (!billing || !settlement.userId) return
    const lease = await this.dependencies.repository.getSandboxLease({
      workspaceId: settlement.workspaceId,
      leaseId: billing.leaseId,
    }).catch((_error) => null)
    if (lease && hasMeterCursor(lease.usage)) {
      try {
        // Turn end is just the final meter tick: bill usage since the last
        // periodic read, then release the bootstrap hold.
        // A run just ended: bill it, but do not idle-stop here (the idle window starts now, via the timer set below).
        const tick = await this.meterLeaseWithRetry(lease, { minRemainingCents: 0, idleStop: 'none' })
        if (!tick.applied && tick.reason === 'insufficient_budget') {
          await this.killLease(lease, 'budget_exhausted').catch((_error) => undefined)
        }
        if (billing.reservationId) {
          await this.dependencies.policy.release({
            reservationId: billing.reservationId,
            userId: settlement.userId,
            reason: 'sandbox_metered',
          })
          await this.dependencies.repository.markSandboxSettlementComplete({
            workspaceId: settlement.workspaceId,
            reservationId: billing.reservationId,
            settledAt: this.now(),
          }).catch((_error) => false)
        }
        await this.dependencies.repository.patchSandboxLeaseUsage({
          workspaceId: settlement.workspaceId,
          leaseId: billing.leaseId,
          patch: {
            lastActiveAt: this.now(),
            activeUntil: 0,
            lastSettlement: {
              agentId: settlement.agentId,
              environmentId: settlement.environmentId,
              runId: settlement.runId,
              reservationId: billing.reservationId,
              providerCostUsd: tick.applied ? tick.chargedUsd ?? 0 : 0,
              settledAt: this.now(),
            },
          },
          now: this.now(),
          // The run is over: the machine stops one idle window from now unless something else starts first.
          idleCheckInMs: idleWindowMs(lease.usage),
        })
        return
      } catch (error) {
        await this.dependencies.policy.markForReconcile({
          reservationId: billing.reservationId,
          userId: settlement.userId,
          errorMessage: error instanceof Error ? `managed_sandbox_settlement:${error.message}` : 'managed_sandbox_settlement_failed',
        }).catch((_error) => undefined)
        throw error
      }
    }
    if (!billing.reservationId) return
    try {
      const runtime = this.runtime(billing.provider)
      // The lease's providerReference may have been repointed mid-turn when
      // the acquire step recreated an expired sandbox — settle against the
      // lease's current reference, not the dispatch-time snapshot. The read
      // must not resume an idle-stopped sandbox.
      const providerReference = lease?.providerReference ?? billing.providerReference
      const instance = await runtime.reconnect(providerReference, { resume: false })
      const currentUsage = await instance.usage()
      const usage = usageDelta(billing.baselineUsage, currentUsage, this.now() - billing.startedAt)
      const providerCostUsd = sandboxCostUsd({ provider: billing.provider, resources: billing.resources, usage })
      if (providerCostUsd >= providerSpendAlertThresholdUsd()) {
        logger.warn('Connected-agent sandbox provider spend alert', {
          workspaceId: settlement.workspaceId,
          agentId: settlement.agentId,
          environmentId: settlement.environmentId,
          runId: settlement.runId,
          providerReference: billing.providerReference,
          reservationId: billing.reservationId,
          providerCostUsd,
        })
      }
      await this.dependencies.policy.finalize({
        actualProviderCostUsd: providerCostUsd,
        events: [{
          type: 'sandbox',
          modelId: `sandbox/${billing.provider}`,
          cost: billableBudgetCentsFromProviderUsd(providerCostUsd),
          durationSeconds: (usage.wallTimeMs ?? 0) / 1_000,
          timestamp: this.now(),
        }],
        reservationId: billing.reservationId,
        userId: settlement.userId,
      })
      // Seed the meter cursor at the charged-through snapshot so a later
      // periodic tick does not double-bill this turn's usage.
      const updatedLease = await this.dependencies.repository.patchSandboxLeaseUsage({
        workspaceId: settlement.workspaceId,
        leaseId: billing.leaseId,
        patch: {
          lastActiveAt: this.now(),
          activeUntil: 0,
          meteredUsage: serializableUsage(currentUsage),
          meteredProviderReference: providerReference,
          meteredAt: this.now(),
          lastSettlement: {
            agentId: settlement.agentId,
            environmentId: settlement.environmentId,
            runId: settlement.runId,
            reservationId: billing.reservationId,
            providerCostUsd,
            wallTimeMs: usage.wallTimeMs ?? 0,
            activeCpuTimeMs: usage.activeCpuTimeMs ?? 0,
            egressBytes: usage.egressBytes ?? 0,
            settledAt: this.now(),
          },
        },
        now: this.now(),
      })
      if (!updatedLease) throw new Error('MANAGED_SANDBOX_LEASE_MISSING')
      const marked = await this.dependencies.repository.markSandboxSettlementComplete({
        workspaceId: settlement.workspaceId,
        reservationId: billing.reservationId,
        settledAt: this.now(),
      })
      // Managed-harness turns never create a settlement marker — only remote
      // (ACP) turns do — so a missing marker is expected, not an error.
      if (!marked) {
        logger.info('Connected-agent sandbox settlement marker absent', {
          reservationId: billing.reservationId,
          workspaceId: settlement.workspaceId,
        })
      }
    } catch (error) {
      await this.dependencies.policy.markForReconcile({
        reservationId: billing.reservationId,
        userId: settlement.userId,
        errorMessage: error instanceof Error ? `managed_sandbox_settlement:${error.message}` : 'managed_sandbox_settlement_failed',
      }).catch((_error) => undefined)
      throw error
    }
  }

  private async tickLease(lease: AgentSandboxLease): Promise<ManagedSandboxMeterTick> {
    try {
      // A running lease past its reserved window has hit the hard runtime
      // limit — reap it (the reap path captures final usage before delete).
      if (lease.status === 'running'
        && typeof lease.reservedUntil === 'number'
        && this.now() > lease.reservedUntil) {
        await this.killLease(lease, 'lease_expired')
        return { leaseId: lease.id, outcome: 'killed', reason: 'lease_expired' }
      }
      const result = await this.meterLease(lease)
      if (!result.applied) {
        if (result.reason === 'insufficient_budget') {
          await this.killLease(lease, 'budget_exhausted')
          return { leaseId: lease.id, outcome: 'killed', reason: 'budget_exhausted', remainingCents: result.remainingCents }
        }
        return {
          leaseId: lease.id,
          outcome: result.reason === 'lease_conflict' ? 'conflict' : 'skipped',
          reason: result.reason,
        }
      }
      if (result.remainingCents !== undefined && result.remainingCents < sandboxLowBalanceCutoffCents()) {
        await this.killLease(lease, 'low_balance')
        return { leaseId: lease.id, outcome: 'killed', reason: 'low_balance', remainingCents: result.remainingCents }
      }
      return {
        leaseId: lease.id,
        outcome: result.chargedCents ? 'metered' : 'adopted',
        ...(result.chargedCents === undefined ? {} : { chargedCents: result.chargedCents }),
        ...(result.remainingCents === undefined ? {} : { remainingCents: result.remainingCents }),
      }
    } catch (error) {
      if (isBillingAccountUnavailableError(error)) {
        // If the payer's wallet can't be debited at all (suspended/missing),
        // stop the lease rather than let unmetered usage accumulate.
        await this.killLease(lease, 'billing_unavailable').catch((_error) => undefined)
        return { leaseId: lease.id, outcome: 'killed', reason: 'billing_unavailable' }
      }
      logger.warn('Managed sandbox meter tick failed', {
        environmentId: lease.environmentId,
        error: error instanceof Error ? error.message : String(error),
        leaseId: lease.id,
        workspaceId: lease.workspaceId,
      })
      return { leaseId: lease.id, outcome: 'error', reason: error instanceof Error ? error.message : String(error) }
    }
  }

  private async killLease(lease: AgentSandboxLease, reason: string) {
    const stopped = await this.dependencies.repository.stopSandboxLease({
      workspaceId: lease.workspaceId,
      leaseId: lease.id,
      reason,
      now: this.now(),
    })
    await this.reapLease(stopped ?? lease)
  }

  private async reapLease(lease: AgentSandboxLease): Promise<ManagedSandboxMeterTick> {
    const reference = lease.providerReference
      ?? (lease.usage && typeof lease.usage.meteredProviderReference === 'string' ? lease.usage.meteredProviderReference : undefined)
    const now = this.now()
    const finish = async (status: 'released' | 'cleanup_failed', cleanupAttempts: number, cleanupAfter?: number) => {
      await this.dependencies.repository.updateSandboxLease({
        workspaceId: lease.workspaceId,
        leaseId: lease.id,
        status,
        runtimeEndedAt: lease.runtimeEndedAt ?? now,
        cleanupAttempts,
        ...(cleanupAfter === undefined ? {} : { cleanupAfter }),
        now,
      }).catch((error) => {
        logger.warn('Managed sandbox lease cleanup write failed', {
          error: error instanceof Error ? error.message : String(error),
          leaseId: lease.id,
        })
      })
      return { leaseId: lease.id, outcome: status } as const
    }
    if (!reference) return await finish('released', lease.cleanupAttempts + 1)
    try {
      // Providers only publish cumulative usage after a session stops, so a
      // still-running sandbox must be stopped before the final meter read —
      // deleting without it would lose the whole session's usage.
      const instance = await this.runtime(lease.provider).reconnect(reference, { resume: false })
      const status = typeof instance.status === 'function'
        ? await instance.status().catch((_error) => undefined)
        : undefined
      if (status !== 'stopped' && status !== 'archived' && status !== 'deleted' && typeof instance.stop === 'function') {
        await instance.stop().catch((stopError) => {
          logger.warn('Managed sandbox stop before cleanup failed', {
            error: stopError instanceof Error ? stopError.message : String(stopError),
            leaseId: lease.id,
            providerReference: reference,
          })
        })
      }
    } catch (error) {
      if (!isMissingSandboxError(error)) {
        const cleanupAttempts = lease.cleanupAttempts + 1
        logger.warn('Managed sandbox pre-delete stop failed — cleanup retried on next pass', {
          cleanupAttempts,
          error: error instanceof Error ? error.message : String(error),
          leaseId: lease.id,
          providerReference: reference,
        })
        return await finish('cleanup_failed', cleanupAttempts, now + cleanupRetryDelayMs(cleanupAttempts))
      }
      // Sandbox already gone — fall through to the final tick and release.
    }
    // A stopped lease gets one final charge-free-of-floor tick so tail usage
    // is still billed before the provider sandbox is deleted.
    await this.meterLease({ ...lease, status: 'stopping' }, { minRemainingCents: 0 }).catch((_error) => undefined)
    try {
      const instance = await this.runtime(lease.provider).reconnect(reference, { resume: false })
      await instance.delete()
      return await finish('released', lease.cleanupAttempts + 1)
    } catch (error) {
      if (isMissingSandboxError(error)) return await finish('released', lease.cleanupAttempts + 1)
      const cleanupAttempts = lease.cleanupAttempts + 1
      logger.warn('Managed sandbox delete failed — cleanup retried on next pass', {
        cleanupAttempts,
        error: error instanceof Error ? error.message : String(error),
        leaseId: lease.id,
        providerReference: reference,
      })
      return await finish('cleanup_failed', cleanupAttempts, now + cleanupRetryDelayMs(cleanupAttempts))
    }
  }

  private async meterLeaseWithRetry(lease: AgentSandboxLease, options?: { minRemainingCents?: number; idleStop?: 'timer' | 'sweep' | 'none' }): Promise<ManagedSandboxMeterResult> {
    const first = await this.meterLease(lease, options)
    if (first.applied || first.reason !== 'lease_conflict') return first
    const fresh = await this.dependencies.repository.getSandboxLease({
      workspaceId: lease.workspaceId,
      leaseId: lease.id,
    }).catch((_error) => null)
    return fresh ? await this.meterLease(fresh, options) : first
  }

  private async resolveLeasePayer(lease: AgentSandboxLease): Promise<ConnectedAgentSandboxLeasePayer | undefined> {
    const payer = lease.usage?.lastPayer
    if (payer && typeof payer === 'object') {
      const value = payer as Record<string, unknown>
      if ((value.scope === 'personal' || value.scope === 'workspace') && typeof value.userId === 'string' && value.userId) {
        return {
          scope: value.scope,
          userId: value.userId,
          ...(typeof value.billingAccountId === 'string' && value.billingAccountId ? { billingAccountId: value.billingAccountId } : {}),
          ...(typeof value.workspaceId === 'string' && value.workspaceId ? { workspaceId: value.workspaceId } : {}),
          ...(value.spendSubjectKind === 'member' || value.spendSubjectKind === 'programmatic' ? { spendSubjectKind: value.spendSubjectKind } : {}),
          ...(typeof value.spendSubjectId === 'string' && value.spendSubjectId ? { spendSubjectId: value.spendSubjectId } : {}),
        }
      }
    }
    const environment = typeof this.dependencies.repository.getEnvironment === 'function'
      ? await this.dependencies.repository.getEnvironment({
        workspaceId: lease.workspaceId,
        environmentId: lease.environmentId,
      }).catch((_error) => null)
      : null
    const userId = environment?.approvedByUserId
    if (!userId) return undefined
    const resolved = await resolveBillingPayer({ userId, workspaceId: lease.workspaceId }).catch((_error) => null)
    return resolved ? sandboxLeasePayer(resolved, userId) : undefined
  }

  private async instanceProbe(
    provider: string,
    providerReference: string,
  ): Promise<{ instance: SandboxInstance; status: SandboxLifecycleState | undefined; usage: SandboxUsage | null } | null> {
    try {
      const instance = await this.runtime(provider).reconnect(providerReference, { resume: false })
      const status = typeof instance.status === 'function'
        ? await instance.status().catch((_error) => undefined)
        : undefined
      const usage = await instance.usage().catch((_error) => null)
      return { instance, status, usage }
    } catch (_error) {
      return null
    }
  }

  private runtime(provider: string) {
    const runtime = this.dependencies.runtime?.(provider) ?? managedSandboxRuntimeFromEnv(provider)
    if (runtime.provider !== provider) throw new Error('MANAGED_SANDBOX_PROVIDER_MISMATCH')
    return runtime
  }

  private async probeBoxLimits() {
    try {
      const runtime = this.runtime('box')
      const limits = typeof (runtime as BoxSandboxRuntime).limits === 'function'
        ? await (runtime as BoxSandboxRuntime).limits()
        : undefined
      if (!limits) return
      if (!limits.canStart || limits.remainingSeconds < boxLowRemainingSeconds()) {
        logger.warn('Box provider balance or capacity low', {
          activeSandboxes: limits.activeSandboxes,
          blockedReason: limits.blockedReason,
          canStart: limits.canStart,
          maxActiveSandboxes: limits.maxActiveSandboxes,
          remainingSeconds: limits.remainingSeconds,
        })
      }
    } catch (error) {
      logger.warn('Box limits probe failed', {
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  private now() { return this.dependencies.now?.() ?? Date.now() }
}

/** Largest provider cost one run may reserve before it is refused. */
export function sandboxProviderCostLimitUsd() {
  const configured = Number(process.env.OVERLAY_SANDBOX_MAX_PROVIDER_COST_USD_PER_RUN?.trim())
  return Number.isFinite(configured) && configured > 0 ? configured : 15
}

export class ManagedAgentSandboxBudgetError extends Error {
  constructor(readonly statusCode: number, readonly code: string) {
    super(code)
    this.name = 'ManagedAgentSandboxBudgetError'
  }
}

const E2B_USD_PER_VCPU_SECOND = 0.000014
const E2B_USD_PER_GIB_SECOND = 0.0000045

export function sandboxCostUsd(args: {
  provider: string
  resources: { diskGiB: number; memoryGiB: number; vcpus: number }
  usage: Pick<SandboxUsage, 'activeCpuTimeMs' | 'egressBytes' | 'wallTimeMs' | 'providerMetrics'>
}) {
  const wallTimeMs = Math.max(0, args.usage.wallTimeMs ?? 0)
  if (args.provider === 'box') {
    // Provider-reported dollars are authoritative — the usage API already
    // applies the size multiplier and list price, so deltas of it bill exact
    // spend. Absent only on responses too old to carry it; then fall back to
    // list price on the metered billable-second delta.
    const reported = providerReportedUsd(args.usage.providerMetrics)
    if (reported !== undefined) return reported
    return wallTimeMs / 1_000 / boxSecondsPerDollar()
  }
  if (args.provider === 'e2b') {
    // E2B bills a running sandbox by the second for its CPUs and memory (list price); a paused one costs nothing here.
    // A self-hosted deployment pays E2B directly, so this is Overlay's metering of its own credit, not E2B's invoice.
    return (wallTimeMs / 1_000) * (args.resources.vcpus * E2B_USD_PER_VCPU_SECOND + args.resources.memoryGiB * E2B_USD_PER_GIB_SECOND)
  }
  throw new Error(`MANAGED_SANDBOX_PROVIDER_UNPRICED:${args.provider}`)
}

function sandboxReservationCostUsd(args: {
  maxRunTimeMs: number
  maxSandboxEgressBytes: number
  provider: string
  resources: { diskGiB: number; memoryGiB: number; vcpus: number }
}) {
  return sandboxCostUsd({
    provider: args.provider,
    resources: args.resources,
    usage: {
      activeCpuTimeMs: args.maxRunTimeMs * args.resources.vcpus,
      egressBytes: args.maxSandboxEgressBytes,
      wallTimeMs: args.maxRunTimeMs,
    },
  })
}

function sandboxLeasePayer(
  payer: { billingAccountId: string; scope: 'personal' | 'workspace'; subject: { id: string; kind: 'member' | 'programmatic' }; workspaceId?: string },
  userId: string,
): ConnectedAgentSandboxLeasePayer {
  return {
    scope: payer.scope,
    billingAccountId: payer.billingAccountId,
    userId,
    ...(payer.workspaceId ? { workspaceId: payer.workspaceId } : {}),
    spendSubjectKind: payer.subject.kind,
    spendSubjectId: payer.subject.id,
  }
}

function hasMeterCursor(usage: Record<string, unknown> | undefined) {
  return Boolean(usage && usage.meteredUsage !== undefined && typeof usage.meteredUsage === 'object')
}

function usageDelta(baseline: Record<string, unknown>, current: SandboxUsage, fallbackWallTimeMs: number): SandboxUsage {
  const baselineWall = finiteNumber(baseline.wallTimeMs)
  const baselineCpu = finiteNumber(baseline.activeCpuTimeMs)
  return {
    // Providers that publish cumulative counters only at session end report a
    // wall time that never advances while running. A stalled counter on a
    // live instance means "unreported", not "zero burn", so fall back to the
    // elapsed window — the cursor accounts for it via virtualWallApplied.
    wallTimeMs: current.wallTimeMs === undefined || current.wallTimeMs <= baselineWall
      ? Math.max(0, fallbackWallTimeMs)
      : current.wallTimeMs - baselineWall,
    activeCpuTimeMs: current.activeCpuTimeMs === undefined ? undefined : Math.max(0, current.activeCpuTimeMs - baselineCpu),
    ingressBytes: current.ingressBytes === undefined ? undefined : Math.max(0, current.ingressBytes - finiteNumber(baseline.ingressBytes)),
    egressBytes: current.egressBytes === undefined ? undefined : Math.max(0, current.egressBytes - finiteNumber(baseline.egressBytes)),
    providerMetrics: providerMetricsDelta(baseline.providerMetrics, current.providerMetrics),
  }
}

/**
 * `reportedUsd` is the provider's cumulative lifetime spend for the sandbox —
 * bill its delta. Other metrics (`secondsPerDollar`, `billingMultiplier`) are
 * rates, not counters, and non-numeric entries (e.g. `running`) carry the
 * current reading through unchanged.
 */
function providerMetricsDelta(
  baseline: unknown,
  current: SandboxUsage['providerMetrics'],
): SandboxUsage['providerMetrics'] {
  if (!current || typeof current !== 'object') return undefined
  const base = baseline && typeof baseline === 'object' ? baseline as Record<string, unknown> : {}
  const delta: Record<string, number | string | boolean | null> = {}
  for (const [key, value] of Object.entries(current)) {
    delta[key] = key === 'reportedUsd' && typeof value === 'number' && Number.isFinite(value)
      ? Math.max(0, value - finiteNumber(base[key]))
      : value
  }
  return delta
}

function sandboxResources(usage: Record<string, unknown>) {
  const stored = usage.resources && typeof usage.resources === 'object'
    ? usage.resources as Record<string, unknown> : {}
  return {
    diskGiB: positiveNumber(stored.diskGiB, DEFAULT_RESOURCES.diskGiB),
    memoryGiB: positiveNumber(stored.memoryGiB, DEFAULT_RESOURCES.memoryGiB),
    vcpus: positiveNumber(stored.vcpus, DEFAULT_RESOURCES.vcpus),
  }
}

function serializableUsage(usage: SandboxUsage): Record<string, unknown> {
  return Object.fromEntries(Object.entries(usage).filter((entry) => entry[1] !== undefined))
}

/** An agent machine's idle window; a lease made under the old 15-minute default also gets the current one. */
function idleWindowMs(usage: Record<string, unknown> | undefined) {
  const stored = finiteNumber(usage?.idleTimeoutMs)
  return stored > 0 ? Math.min(stored, MANAGED_SANDBOX_IDLE_TIMEOUT_MS) : MANAGED_SANDBOX_IDLE_TIMEOUT_MS
}

/** A timer was set and is not long overdue (an overdue one is presumed lost). */
function idleTimerIsLive(usage: Record<string, unknown>, now: number) {
  return typeof usage.idleToken === 'string' && typeof usage.idleCheckAt === 'number'
    && usage.idleCheckAt > now - IDLE_FALLBACK_GRACE_MS
}

function idleActivityTimestamp(usage: Record<string, unknown>, lease: AgentSandboxLease, fallback: number) {
  const lastSettlement = usage.lastSettlement && typeof usage.lastSettlement === 'object'
    ? usage.lastSettlement as Record<string, unknown>
    : {}
  return finiteNumber(usage.lastActiveAt)
    || finiteNumber(lastSettlement.settledAt)
    || lease.runtimeStartedAt
    || lease.createdAt
    || fallback
}

function finiteNumber(value: unknown) { return typeof value === 'number' && Number.isFinite(value) ? value : 0 }
function positiveNumber(value: unknown, fallback: number) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback
}

function isMissingSandboxError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  return /404|not found|does not exist|gone/i.test(message)
}

function isBillingAccountUnavailableError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  return /workspace_billing_account_(missing|mismatch|inactive)|workspace_billing_balance_missing|billing_account_inactive/.test(message)
}

function cleanupRetryDelayMs(attempts: number) {
  return Math.min(CLEANUP_RETRY_BASE_MS * 2 ** Math.max(0, attempts - 1), CLEANUP_RETRY_MAX_MS)
}

/**
 * The least remaining credit a machine can start with: the meter stops any machine whose payer is at or below
 * the low-balance floor, so a machine started under it would be deleted within a minute.
 */
export function minimumBudgetToStartMachineCents(): number {
  return sandboxLowBalanceCutoffCents() + 1
}

function sandboxLowBalanceCutoffCents() {
  const configured = Number(process.env.OVERLAY_SANDBOX_LOW_BALANCE_CUTOFF_CENTS)
  return Number.isFinite(configured) && configured >= 0 ? configured : DEFAULT_LOW_BALANCE_CUTOFF_CENTS
}

function sandboxBootstrapCoverageMs() {
  const configured = Number(process.env.OVERLAY_SANDBOX_BOOTSTRAP_COVERAGE_MS)
  return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_BOOTSTRAP_COVERAGE_MS
}

function sandboxBootstrapEgressBytes() {
  const configured = Number(process.env.OVERLAY_SANDBOX_BOOTSTRAP_EGRESS_BYTES)
  return Number.isFinite(configured) && configured >= 0 ? configured : DEFAULT_BOOTSTRAP_EGRESS_BYTES
}

function sandboxMeterLeaseLimit() {
  const configured = Number(process.env.OVERLAY_SANDBOX_METER_LEASE_LIMIT)
  return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_METER_LEASE_LIMIT
}

function sandboxMeterDisabled() {
  return process.env.OVERLAY_SANDBOX_METER_DISABLED === 'true'
}

function providerSpendAlertThresholdUsd() {
  const configured = Number(process.env.OVERLAY_SANDBOX_PROVIDER_SPEND_ALERT_USD)
  return Number.isFinite(configured) && configured > 0 ? configured : 10
}

const DEFAULT_BOX_SECONDS_PER_DOLLAR = 100_000
const DEFAULT_BOX_LOW_REMAINING_SECONDS = 7_200

/** Billable seconds per dollar at list price (`$20` → `2,000,000` seconds). */
function boxSecondsPerDollar() {
  const configured = Number(process.env.OVERLAY_BOX_SECONDS_PER_DOLLAR)
  return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_BOX_SECONDS_PER_DOLLAR
}

function providerReportedUsd(metrics: SandboxUsage['providerMetrics']) {
  const value = metrics?.reportedUsd
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : undefined
}

/** Warn when the box account can't start sandboxes or is low on machine time. */
function boxLowRemainingSeconds() {
  const configured = Number(process.env.OVERLAY_BOX_LOW_REMAINING_SECONDS)
  return Number.isFinite(configured) && configured >= 0 ? configured : DEFAULT_BOX_LOW_REMAINING_SECONDS
}
