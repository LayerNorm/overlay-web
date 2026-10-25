import 'server-only'

import type { Computer } from '@overlay/workspace-contracts'
import type { SandboxUsage } from '@overlay/sandbox-runtime'
import type { BillingPayerResolver } from '@/server/billing/BillingPayerResolver'
import { billableBudgetCentsFromProviderUsd } from '@/server/billing/billing-runtime'
import type { ConnectedAgentRepository, ConnectedAgentSandboxLeasePayer } from '@/server/agents/ConnectedAgentRepository'
import { ManagedAgentSandboxBilling, sandboxLowBalanceCutoffCents } from '@/server/agents/ManagedAgentSandboxBilling'
import { boatAllocationHoldUsd } from '@/server/agents/sandbox-boat-accounting'
import { ComputerServiceError } from './ComputerService'

export const computerLeaseId = (computerId: string) => `computer:${computerId}`
const SIZE_VCPUS = { small: 2, default: 4, large: 8 } as const

export class ComputerBilling {
  constructor(private readonly dependencies: {
    repository: Pick<ConnectedAgentRepository, 'getSandboxLease' | 'meterSandboxLease'>
    payerResolver: Pick<BillingPayerResolver, 'resolve'>
    meter: Pick<ManagedAgentSandboxBilling, 'meterLeaseWithRetry'>
    now?: () => number
  }) {}

  async payer(computer: Computer, userId: string): Promise<ConnectedAgentSandboxLeasePayer> {
    const payer = await this.dependencies.payerResolver.resolve({
      userId, workspaceId: computer.workspaceId,
      ...(computer.ownerType === 'agent' ? { programmaticSubjectId: `agent:${computer.ownerId}` } : {}),
    })
    if (payer.scope !== 'workspace' || payer.workspaceId !== computer.workspaceId) {
      throw new ComputerServiceError('paid_plan_required', 'Computers require a paid workspace.', 403)
    }
    return {
      scope: 'workspace', workspaceId: computer.workspaceId, billingAccountId: payer.billingAccountId,
      userId, spendSubjectKind: payer.subject.kind, spendSubjectId: payer.subject.id,
    }
  }

  async lease(computer: Computer) {
    const lease = await this.dependencies.repository.getSandboxLease({ workspaceId: computer.workspaceId, leaseId: computerLeaseId(computer.id) })
    if (!lease) throw new Error('COMPUTER_LEASE_MISSING')
    return lease
  }

  /** The lifecycle coordinator must hold maintenance ownership before calling this. */
  async reserve(computer: Computer, actorUserId: string, stoppedUsage?: SandboxUsage): Promise<void> {
    if (computer.provider !== 'box') throw new Error('COMPUTER_PROVIDER_ACCOUNTING_UNSUPPORTED')
    if (computer.providerRef && stoppedUsage?.providerMetrics?.running !== false) throw new Error('COMPUTER_RESERVATION_REQUIRES_STOPPED_USAGE')
    const quotedCents = billableBudgetCentsFromProviderUsd(boatAllocationHoldUsd(SIZE_VCPUS[computer.size], stoppedUsage))
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const lease = await this.lease(computer)
      const usage = lease.usage ?? {}
      const previousHoldMicros = typeof usage.runtimeHoldMicros === 'number' ? usage.runtimeHoldMicros : 0
      if (!Number.isSafeInteger(previousHoldMicros) || previousHoldMicros < 0) throw new Error('COMPUTER_RUNTIME_HOLD_INVALID')
      const payer = previousHoldMicros > 0
        ? usage.runtimeHoldPayer as ConnectedAgentSandboxLeasePayer | undefined
        : await this.payer(computer, actorUserId)
      if (!payer) throw new Error('COMPUTER_RUNTIME_HOLD_PAYER_MISSING')
      const now = (this.dependencies.now ?? Date.now)()
      const result = await this.dependencies.repository.meterSandboxLease({
        workspaceId: computer.workspaceId, leaseId: lease.id, now,
        expectedMeterVersion: typeof usage.meterVersion === 'number' ? usage.meterVersion : 0,
        meteredUsage: usage.meteredUsage && typeof usage.meteredUsage === 'object' ? usage.meteredUsage as Record<string, unknown> : {},
        meteredAt: now,
        meteredProviderReference: lease.providerReference,
        runtimeHoldCents: Math.max(quotedCents, previousHoldMicros / 10_000),
        minRemainingCents: sandboxLowBalanceCutoffCents(), payer,
      })
      if (result.applied) return
      if (result.reason !== 'lease_conflict') throw new ComputerServiceError('insufficient_credit', 'Workspace or member credit cannot cover this computer.', 402)
    }
    throw new ComputerServiceError('provider_error', 'The computer is busy. Try again.', 409)
  }

  async releaseReservation(computer: Computer): Promise<void> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const lease = await this.lease(computer)
      const usage = lease.usage ?? {}
      if (computer.providerRef || lease.providerReference
        || typeof usage.requestedAt === 'number'
        || typeof usage.allocationKey === 'string'
        || typeof usage.allocationRecipe === 'string'
        || typeof usage.meteredProviderReference === 'string') {
        throw new Error('COMPUTER_ALLOCATION_REQUIRES_RECONCILIATION')
      }
      const previousHoldMicros = typeof usage.runtimeHoldMicros === 'number' ? usage.runtimeHoldMicros : 0
      if (!Number.isSafeInteger(previousHoldMicros) || previousHoldMicros < 0) {
        throw new Error('COMPUTER_RUNTIME_HOLD_INVALID')
      }
      if (previousHoldMicros === 0) return
      const payer = usage.runtimeHoldPayer as ConnectedAgentSandboxLeasePayer | undefined
      if (!payer) throw new Error('COMPUTER_RUNTIME_HOLD_PAYER_MISSING')
      const now = (this.dependencies.now ?? Date.now)()
      const result = await this.dependencies.repository.meterSandboxLease({
        workspaceId: computer.workspaceId,
        leaseId: lease.id,
        now,
        expectedMeterVersion: typeof usage.meterVersion === 'number' ? usage.meterVersion : 0,
        meteredUsage: usage.meteredUsage && typeof usage.meteredUsage === 'object'
          ? usage.meteredUsage as Record<string, unknown>
          : {},
        meteredAt: typeof usage.meteredAt === 'number' ? usage.meteredAt : now,
        meteredProviderReference: lease.providerReference,
        runtimeHoldCents: 0,
        minRemainingCents: 0,
        payer,
      })
      if (result.applied) return
      if (result.reason !== 'lease_conflict') throw new Error('COMPUTER_RESERVATION_RELEASE_FAILED')
    }
    throw new Error('COMPUTER_RESERVATION_RELEASE_CONFLICT')
  }

  async meter(computer: Computer, stopped = false): Promise<void> {
    const result = await this.dependencies.meter.meterLeaseWithRetry(await this.lease(computer), {
      idleStop: 'none', minRemainingCents: stopped ? 0 : sandboxLowBalanceCutoffCents(),
    })
    if (!result.applied) throw new ComputerServiceError('provider_error', 'Computer usage could not be reconciled.', 503)
  }
}
