import 'server-only'

import { getBudgetTotals, isPaidPlan } from '@/server/billing/billing-runtime'
import { minimumBudgetToStartMachineCents } from '@/server/agents/ManagedAgentSandboxBilling'
import type { Entitlements } from '@/shared/app/app-contracts'
import type { BillingPayerResolver } from '@/server/billing/BillingPayerResolver'
import { ComputerServiceError } from './ComputerService'

export class ComputerAdmission {
  constructor(private readonly dependencies: {
    payerResolver: Pick<BillingPayerResolver, 'resolve'>
    getEntitlements(billingAccountId: string): Promise<Entitlements | null>
  }) {}

  async assertCanRun(input: { workspaceId: string; userId: string; agentId?: string }): Promise<void> {
    const payer = await this.dependencies.payerResolver.resolve({
      workspaceId: input.workspaceId,
      userId: input.userId,
      ...(input.agentId ? { programmaticSubjectId: `agent:${input.agentId}` } : {}),
    })
    if (payer.scope !== 'workspace' || payer.workspaceId !== input.workspaceId) {
      throw new ComputerServiceError('paid_plan_required', 'Computers require a paid workspace.', 403)
    }
    const entitlements = await this.dependencies.getEntitlements(payer.billingAccountId)
    if (!entitlements || !isPaidPlan(entitlements)) {
      throw new ComputerServiceError('paid_plan_required', 'Computers require a paid workspace.', 403)
    }
    const remaining = getBudgetTotals(entitlements).remainingCents
    if (!Number.isFinite(remaining) || remaining < minimumBudgetToStartMachineCents()) {
      throw new ComputerServiceError('insufficient_credit', 'Add workspace credit before starting this computer.', 402)
    }
  }
}
