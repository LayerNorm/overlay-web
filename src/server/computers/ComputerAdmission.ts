import 'server-only'

import { isPaidPlan } from '@/server/billing/billing-runtime'
import type { Entitlements } from '@/shared/app/app-contracts'
import type { BillingPayerResolver } from '@/server/billing/BillingPayerResolver'
import { ComputerServiceError } from './ComputerService'

/** The budget check before a computer starts or wakes; the same one every paid call uses (`ensureProviderBudgetNotLow`). */
export type ComputerBudgetCheck = (input: {
  entitlements: Entitlements
  userId: string
  workspaceId: string
  programmaticSubjectId?: string
}) => Promise<{ ok: true } | { ok: false; payload?: Record<string, unknown> }>

/**
 * A computer starts or wakes only from a paid workspace that has at least 2% of its budget left (after one automatic
 * top-up to the 2% line) and whose admin spend limit for this member or agent is not used up. Nothing is held: the
 * lease meter charges observed usage afterwards and stops the computer when the workspace drops under 2%.
 */
export class ComputerAdmission {
  constructor(private readonly dependencies: {
    payerResolver: Pick<BillingPayerResolver, 'resolve'>
    getEntitlements(billingAccountId: string): Promise<Entitlements | null>
    ensureBudgetNotLow: ComputerBudgetCheck
  }) {}

  async assertCanRun(input: { workspaceId: string; userId: string; agentId?: string }): Promise<void> {
    const programmaticSubjectId = input.agentId ? `agent:${input.agentId}` : undefined
    const payer = await this.dependencies.payerResolver.resolve({
      workspaceId: input.workspaceId,
      userId: input.userId,
      ...(programmaticSubjectId ? { programmaticSubjectId } : {}),
    })
    if (payer.scope !== 'workspace' || payer.workspaceId !== input.workspaceId) {
      throw new ComputerServiceError('paid_plan_required', 'Computers require a paid workspace.', 403)
    }
    const entitlements = await this.dependencies.getEntitlements(payer.billingAccountId)
    if (!entitlements || !isPaidPlan(entitlements)) {
      throw new ComputerServiceError('paid_plan_required', 'Computers require a paid workspace.', 403)
    }
    const budget = await this.dependencies.ensureBudgetNotLow({
      entitlements,
      userId: input.userId,
      workspaceId: input.workspaceId,
      ...(programmaticSubjectId ? { programmaticSubjectId } : {}),
    })
    if (!budget.ok) {
      const message = typeof budget.payload?.message === 'string'
        ? budget.payload.message
        : 'Your workspace has less than 2% of its budget left. Add budget before starting this computer.'
      throw new ComputerServiceError('insufficient_credit', message, 402)
    }
  }
}
