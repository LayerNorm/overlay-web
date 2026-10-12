import 'server-only'

import type { Entitlements } from '@/shared/app/app-contracts'
import type { BillingRepository } from '@/server/billing/BillingRepository'
import { maybeAutoTopUpWorkspaceBudget } from '@/server/billing/stripe-billing'

/**
 * A paid workspace short of credit: try one automatic top-up (when an owner turned them on and the monthly limit
 * allows it); otherwise leave the entitlements as they are, so the caller stops paid work (the hard stop).
 */
export async function ensureWorkspaceBudgetAvailable(params: {
  billingAccountId: string
  entitlements: Entitlements
  minimumRequiredCents?: number
  userId: string
  workspaceId: string
}, deps: {
  billingEnabled: () => Promise<boolean>
  remainingCents: (entitlements: Entitlements) => number
  repository: () => Promise<BillingRepository>
}): Promise<{ entitlements: Entitlements; remainingCents: number }> {
  const minimumRequiredCents = Math.max(1, Math.round(params.minimumRequiredCents ?? 1))
  const remainingCents = deps.remainingCents(params.entitlements)
  if (remainingCents >= minimumRequiredCents || !(await deps.billingEnabled())) {
    return { entitlements: params.entitlements, remainingCents }
  }
  const repository = await deps.repository()
  const topUp = await maybeAutoTopUpWorkspaceBudget({
    actorUserId: params.userId,
    billingAccountId: params.billingAccountId,
    minimumRequiredCents,
    workspaceId: params.workspaceId,
  }, repository)
  if (!topUp.applied) return { entitlements: params.entitlements, remainingCents }
  const refreshed = await repository.getBillingAccountEntitlementsByServer({
    billingAccountId: params.billingAccountId,
  }) as Entitlements | null
  const entitlements = refreshed ?? params.entitlements
  return { entitlements, remainingCents: deps.remainingCents(entitlements) }
}
