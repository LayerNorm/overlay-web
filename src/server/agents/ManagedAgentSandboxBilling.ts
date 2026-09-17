import 'server-only'

import type { AgentSandboxLease } from '@overlay/workspace-contracts'
import type { SandboxRuntime, SandboxUsage } from '@overlay/sandbox-runtime'
import type { Entitlements } from '@/shared/app/app-contracts'
import type { GenerationUsagePolicy } from '@/server/outputs/GenerationUsagePolicy'
import { billableBudgetCentsFromProviderUsd, resolveBillingPayer } from '@/server/billing/billing-runtime'
import { getMarkupBasisPoints } from '@/shared/billing/billing-pricing'
import { computeDaytonaRuntimeCost } from '@/shared/ai/sandbox/daytona-pricing'
import { logger } from '@/server/observability/logger'
import type {
  ConnectedAgentRepository,
  ConnectedAgentSandboxBilling,
  ConnectedAgentSandboxLeasePayer,
  RemoteAgentUsageSettlement,
} from './ConnectedAgentRepository'
import { managedSandboxRuntimeFromEnv } from './ManagedAgentSandboxService'
import {
  calculateVercelSandboxCostUsd,
  estimateVercelSandboxReservationUsd,
  sandboxProviderCostLimitUsd,
} from '@/server/ai/sandbox/vercel-pricing'

const DEFAULT_RESOURCES = { diskGiB: 10, memoryGiB: 4, vcpus: 2 }
const DEFAULT_LOW_BALANCE_CUTOFF_CENTS = 100
const DEFAULT_BOOTSTRAP_COVERAGE_MS = 10 * 60_000
const DEFAULT_BOOTSTRAP_EGRESS_BYTES = 1 << 30
const DEFAULT_METER_LEASE_LIMIT = 100
const CLEANUP_RETRY_BASE_MS = 60_000
const CLEANUP_RETRY_MAX_MS = 30 * 60_000
const MARKUP_MULTIPLIER = 1 + getMarkupBasisPoints() / 10_000
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
    // zero usage, so an empty baseline meters its full lifetime.
    const baselineUsage = await runtime.reconnect(lease.providerReference)
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
    if (payer) {
      await this.dependencies.repository.patchSandboxLeaseUsage({
        workspaceId: args.workspaceId,
        leaseId: lease.id,
        patch: { lastPayer: payer },
        now: this.now(),
      }).catch((error) => {
        logger.warn('[managed-harness] sandbox lease payer write failed', {
          environmentId: args.environmentId,
          error: error instanceof Error ? error.message : String(error),
        })
      })
    }
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
    const ticks: ManagedSandboxMeterTick[] = []
    for (const lease of active) ticks.push(await this.tickLease(lease))
    for (const lease of reapable) ticks.push(await this.reapLease(lease))
    return { ticks }
  }

  // One atomic meter tick for a lease: read the provider's cumulative usage,
  // compute the delta against the persisted cursor, and commit debit + cursor
  // in a single transaction on the repository side. A lease whose usage was
  // never metered adopts its current counters as the cursor (no charge) —
  // billing starts from the first metered read, and freshly provisioned leases
  // seed an empty cursor so their full lifetime is billed.
  async meterLease(lease: AgentSandboxLease, options?: { minRemainingCents?: number }): Promise<ManagedSandboxMeterResult> {
    const now = this.now()
    const usage = lease.usage ?? {}
    const storedCursor = usage.meteredUsage && typeof usage.meteredUsage === 'object'
      ? usage.meteredUsage as Record<string, unknown>
      : undefined
    const expectedMeterVersion = typeof usage.meterVersion === 'number' ? usage.meterVersion : 0
    const stopping = lease.status === 'stopping' || lease.status === 'cleanup_failed'

    let effectiveLease = lease
    let currentUsage = lease.providerReference
      ? await this.instanceUsage(lease.provider, lease.providerReference)
      : null
    if (currentUsage === null && lease.providerReference) {
      // The acquire step may have recreated the sandbox and repointed the
      // lease since this snapshot was read — follow the repoint once.
      const current = await this.dependencies.repository.getActiveSandboxLease({
        workspaceId: lease.workspaceId,
        environmentId: lease.environmentId,
      }).catch((_error) => null)
      if (current && current.id === lease.id && current.providerReference && current.providerReference !== lease.providerReference) {
        const usageAfterRepoint = await this.instanceUsage(current.provider, current.providerReference)
        if (usageAfterRepoint) {
          currentUsage = usageAfterRepoint
          effectiveLease = current
        }
      }
    }
    if (currentUsage === null) return { applied: false, reason: 'usage_unavailable' }

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
    const delta = usageDelta(baseline, currentUsage, stopping ? 0 : Math.max(0, now - meteredAt))
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
    const result = await this.dependencies.repository.meterSandboxLease({
      workspaceId: effectiveLease.workspaceId,
      leaseId: effectiveLease.id,
      now,
      expectedMeterVersion,
      meteredUsage: serializableUsage(currentUsage),
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
        const tick = await this.meterLeaseWithRetry(lease, { minRemainingCents: 0 })
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
      // lease's current reference, not the dispatch-time snapshot.
      const providerReference = lease?.providerReference ?? billing.providerReference
      const instance = await runtime.reconnect(providerReference)
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
    // A stopped lease gets one final charge-free-of-floor tick so tail usage
    // is still billed before the provider sandbox is deleted.
    await this.meterLease({ ...lease, status: 'stopping' }, { minRemainingCents: 0 }).catch((_error) => undefined)
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
      const instance = await this.runtime(lease.provider).reconnect(reference)
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

  private async meterLeaseWithRetry(lease: AgentSandboxLease, options?: { minRemainingCents?: number }): Promise<ManagedSandboxMeterResult> {
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
    const environment = await this.dependencies.repository.getEnvironment({
      workspaceId: lease.workspaceId,
      environmentId: lease.environmentId,
    }).catch((_error) => null)
    const userId = environment?.approvedByUserId
    if (!userId) return undefined
    const resolved = await resolveBillingPayer({ userId, workspaceId: lease.workspaceId }).catch((_error) => null)
    return resolved ? sandboxLeasePayer(resolved, userId) : undefined
  }

  private async instanceUsage(provider: string, providerReference: string): Promise<SandboxUsage | null> {
    try {
      const instance = await this.runtime(provider).reconnect(providerReference)
      return await instance.usage()
    } catch (_error) {
      return null
    }
  }

  private runtime(provider: string) {
    const runtime = this.dependencies.runtime?.(provider) ?? managedSandboxRuntimeFromEnv(provider)
    if (runtime.provider !== provider) throw new Error('MANAGED_SANDBOX_PROVIDER_MISMATCH')
    return runtime
  }

  private now() { return this.dependencies.now?.() ?? Date.now() }
}

export class ManagedAgentSandboxBudgetError extends Error {
  constructor(readonly statusCode: number, readonly code: string) {
    super(code)
    this.name = 'ManagedAgentSandboxBudgetError'
  }
}

export function sandboxCostUsd(args: {
  provider: string
  resources: { diskGiB: number; memoryGiB: number; vcpus: number }
  usage: Pick<SandboxUsage, 'activeCpuTimeMs' | 'egressBytes' | 'wallTimeMs'>
}) {
  const wallTimeMs = Math.max(0, args.usage.wallTimeMs ?? 0)
  if (args.provider === 'daytona') return computeDaytonaRuntimeCost({
    cpu: args.resources.vcpus,
    memoryGiB: args.resources.memoryGiB,
    diskGiB: args.resources.diskGiB,
    elapsedSeconds: wallTimeMs / 1_000,
  }).costUsd
  if (args.provider === 'vercel') return calculateVercelSandboxCostUsd({
    memoryGb: args.resources.memoryGiB,
    usage: args.usage,
  })
  throw new Error(`MANAGED_SANDBOX_PROVIDER_UNPRICED:${args.provider}`)
}

function sandboxReservationCostUsd(args: {
  maxRunTimeMs: number
  maxSandboxEgressBytes: number
  provider: string
  resources: { diskGiB: number; memoryGiB: number; vcpus: number }
}) {
  if (args.provider === 'vercel') return estimateVercelSandboxReservationUsd({
    maxEgressBytes: args.maxSandboxEgressBytes,
    maxRunTimeMs: args.maxRunTimeMs,
    memoryGb: args.resources.memoryGiB,
    vcpus: args.resources.vcpus,
  })
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
    wallTimeMs: current.wallTimeMs === undefined ? Math.max(0, fallbackWallTimeMs) : Math.max(0, current.wallTimeMs - baselineWall),
    activeCpuTimeMs: current.activeCpuTimeMs === undefined ? undefined : Math.max(0, current.activeCpuTimeMs - baselineCpu),
    ingressBytes: current.ingressBytes === undefined ? undefined : Math.max(0, current.ingressBytes - finiteNumber(baseline.ingressBytes)),
    egressBytes: current.egressBytes === undefined ? undefined : Math.max(0, current.egressBytes - finiteNumber(baseline.egressBytes)),
  }
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
