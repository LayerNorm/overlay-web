import 'server-only'

import type { Computer } from '@overlay/workspace-contracts'
import type { BillingPayerResolver } from '@/server/billing/BillingPayerResolver'
import type { ConnectedAgentRepository, ConnectedAgentSandboxLeasePayer } from '@/server/agents/ConnectedAgentRepository'
import type { ManagedAgentSandboxBilling } from '@/server/agents/ManagedAgentSandboxBilling'
import { EXECUTION_ACCESS_MESSAGES } from '@/shared/billing/execution-access'
import { ComputerServiceError } from './ComputerService'

export const computerLeaseId = (computerId: string) => `computer:${computerId}`

/**
 * A computer is never paid for in advance. Admission (`ComputerAdmission`) checks that the workspace has at least 2%
 * of its budget left; the lease meter then charges observed Boat usage and stops the computer when a charge leaves
 * the workspace under 2% or uses up an admin spend limit.
 */
export class ComputerBilling {
  constructor(private readonly dependencies: {
    repository: Pick<ConnectedAgentRepository, 'getSandboxLease' | 'patchSandboxLeaseUsage'>
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

  /**
   * Records who pays for the session about to start (the member, or `agent:<ownerId>` for an agent's computer) so the
   * meter charges them. Nothing is held. The lifecycle coordinator must hold maintenance ownership before calling this.
   */
  async bindPayer(computer: Computer, actorUserId: string): Promise<void> {
    if (computer.provider !== 'box') throw new Error('COMPUTER_PROVIDER_ACCOUNTING_UNSUPPORTED')
    const payer = await this.payer(computer, actorUserId)
    const lease = await this.lease(computer)
    const patched = await this.dependencies.repository.patchSandboxLeaseUsage({
      workspaceId: computer.workspaceId, leaseId: lease.id, patch: { lastPayer: payer },
      now: (this.dependencies.now ?? Date.now)(),
    })
    if (!patched) throw new Error('COMPUTER_LEASE_MISSING')
  }

  /** Charges observed usage. A running computer whose charge leaves the budget under 2% is refused here. */
  async meter(computer: Computer, stopped = false): Promise<void> {
    const result = await this.dependencies.meter.meterLeaseWithRetry(await this.lease(computer), { idleStop: 'none' })
    if (!result.applied) throw new ComputerServiceError('provider_error', 'Computer usage could not be reconciled.', 503)
    if (stopped) return
    if (result.spendLimitReached) {
      throw new ComputerServiceError('insufficient_credit', 'Your spending limit in this workspace is used up. Ask a workspace admin to raise it.', 402)
    }
    if (result.budgetLow) throw new ComputerServiceError('insufficient_credit', EXECUTION_ACCESS_MESSAGES.budget_exhausted, 402)
  }
}
