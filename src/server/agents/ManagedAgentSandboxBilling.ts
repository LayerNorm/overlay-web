import 'server-only'

import type { SandboxRuntime, SandboxUsage } from '@overlay/sandbox-runtime'
import type { Entitlements } from '@/shared/app/app-contracts'
import type { GenerationUsagePolicy } from '@/server/outputs/GenerationUsagePolicy'
import { billableBudgetCentsFromProviderUsd } from '@/server/billing/billing-runtime'
import { computeDaytonaRuntimeCost } from '@/shared/ai/sandbox/daytona-pricing'
import { logger } from '@/server/observability/logger'
import type {
  ConnectedAgentRepository,
  ConnectedAgentSandboxBilling,
  RemoteAgentUsageSettlement,
} from './ConnectedAgentRepository'
import { managedSandboxRuntimeFromEnv } from './ManagedAgentSandboxService'
import {
  calculateVercelSandboxCostUsd,
  estimateVercelSandboxReservationUsd,
  sandboxProviderCostLimitUsd,
} from '@/server/ai/sandbox/vercel-pricing'

const DEFAULT_RESOURCES = { diskGiB: 20, memoryGiB: 4, vcpus: 2 }

export class ManagedAgentSandboxBilling {
  constructor(private readonly dependencies: {
    policy: GenerationUsagePolicy
    repository: ConnectedAgentRepository
    runtime?: (provider: string) => SandboxRuntime
    now?: () => number
  }) {}

  async reserve(args: {
    agentId: string
    entitlements: Entitlements
    environmentId: string
    idempotencyKey: string
    maxRunTimeMs: number
    maxSandboxEgressBytes: number
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
    const instance = await runtime.reconnect(lease.providerReference)
    const baselineUsage = await instance.usage()
    const resources = sandboxResources(lease.usage)
    const estimatedProviderCostUsd = sandboxReservationCostUsd({
      provider: lease.provider,
      resources,
      maxRunTimeMs: args.maxRunTimeMs,
      maxSandboxEgressBytes: args.maxSandboxEgressBytes,
    })
    if (estimatedProviderCostUsd > sandboxProviderCostLimitUsd()) {
      throw new ManagedAgentSandboxBudgetError(503, 'sandbox_provider_cost_limit')
    }
    const reservation = await this.dependencies.policy.reserve({
      entitlements: args.entitlements,
      idempotencyKey: args.idempotencyKey,
      kind: 'sandbox',
      modelId: `sandbox/${lease.provider}`,
      operationId: args.operationId,
      providerCostUsd: estimatedProviderCostUsd,
      requestFingerprint: args.requestFingerprint,
      programmaticSubjectId: `agent:${args.agentId}`,
      userId: args.userId,
      workspaceId: args.workspaceId,
    })
    if (!reservation.ok) throw new ManagedAgentSandboxBudgetError(reservation.status, reservation.code)
    await this.dependencies.policy.markStarted({ reservationId: reservation.reservationId, userId: args.userId })
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

  async settle(settlement: RemoteAgentUsageSettlement): Promise<void> {
    const billing = settlement.sandboxBilling
    if (!billing?.reservationId || !settlement.userId) return
    try {
      const runtime = this.runtime(billing.provider)
      const instance = await runtime.reconnect(billing.providerReference)
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
      const updatedLease = await this.dependencies.repository.updateSandboxLease({
        workspaceId: settlement.workspaceId,
        leaseId: billing.leaseId,
        usage: {
          resources: billing.resources,
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
      if (!marked) throw new Error('MANAGED_SANDBOX_SETTLEMENT_MARKER_MISSING')
    } catch (error) {
      await this.dependencies.policy.markForReconcile({
        reservationId: billing.reservationId,
        userId: settlement.userId,
        errorMessage: error instanceof Error ? `managed_sandbox_settlement:${error.message}` : 'managed_sandbox_settlement_failed',
      }).catch((_error) => undefined)
      throw error
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

function providerSpendAlertThresholdUsd() {
  const configured = Number(process.env.OVERLAY_SANDBOX_PROVIDER_SPEND_ALERT_USD)
  return Number.isFinite(configured) && configured > 0 ? configured : 10
}
