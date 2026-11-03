import 'server-only'

import type { Entitlements } from '@/shared/app/app-contracts'
import type { BillingRepository } from '@/server/billing/BillingRepository'
import { maybeAutoTopUpWorkspaceBudget } from '@/server/billing/stripe-billing'

export type WorkspaceBudgetFundingStatus =
  | 'available' | 'disabled' | 'pending' | 'payment_failed' | 'monthly_limit_reached'
  | 'missing_payment_method' | 'missing_consent' | 'amount_shortfall' | 'not_paid' | 'authorization_changed'

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
}): Promise<{
  entitlements: Entitlements
  remainingCents: number
  requiredCents: number
  autoTopUpStatus: WorkspaceBudgetFundingStatus
  autoTopUpReason?: string
}> {
  const requiredCents = Math.max(1, Math.round(params.minimumRequiredCents ?? 1))
  const remainingCents = deps.remainingCents(params.entitlements)
  if (remainingCents >= requiredCents) {
    return { entitlements: params.entitlements, remainingCents, requiredCents, autoTopUpStatus: 'available' }
  }
  if (!(await deps.billingEnabled())) {
    return { entitlements: params.entitlements, remainingCents, requiredCents, autoTopUpStatus: 'disabled' }
  }
  const repository = await deps.repository()
  const shortfallCents = Math.max(1, requiredCents - remainingCents)
  const topUp = await maybeAutoTopUpWorkspaceBudget({
    actorUserId: params.userId,
    billingAccountId: params.billingAccountId,
    minimumRequiredCents: shortfallCents,
    workspaceId: params.workspaceId,
  }, repository)
  const status = normalizeFundingStatus(topUp.reason, topUp.applied)
  if (!topUp.applied) {
    if (topUp.reason === 'monthly_limit_reached') await notifyLimitReached(params, repository).catch((_error) => undefined)
    return {
      entitlements: params.entitlements, remainingCents, requiredCents,
      autoTopUpStatus: status, autoTopUpReason: topUp.reason,
    }
  }
  const refreshed = await repository.getBillingAccountEntitlementsByServer({
    billingAccountId: params.billingAccountId,
  }) as Entitlements | null
  const entitlements = refreshed ?? params.entitlements
  const updatedRemainingCents = deps.remainingCents(entitlements)
  return {
    entitlements,
    remainingCents: updatedRemainingCents,
    requiredCents,
    autoTopUpStatus: updatedRemainingCents >= requiredCents ? 'available' : 'amount_shortfall',
    autoTopUpReason: topUp.reason,
  }
}

function normalizeFundingStatus(reason: string | undefined, applied: boolean): WorkspaceBudgetFundingStatus {
  if (applied) return 'available'
  if (reason === 'disabled' || reason === 'billing_disabled') return 'disabled'
  if (reason === 'payment_failed') return 'payment_failed'
  if (reason === 'monthly_limit_reached') return 'monthly_limit_reached'
  if (reason === 'missing_payment_method' || reason === 'missing_customer') return 'missing_payment_method'
  if (reason === 'missing_consent') return 'missing_consent'
  if (reason === 'not_paid') return 'not_paid'
  if (reason === 'authorization_changed') return 'authorization_changed'
  if (reason === 'invalid_amount' || reason === 'amount_too_small') return 'amount_shortfall'
  return 'pending'
}

/**
 * Emails each owner and admin once per billing period when automatic top-ups hit the monthly limit. The idempotency
 * key (account + period + recipient) makes repeat shortfalls in the same period a no-op in the email outbox.
 */
async function notifyLimitReached(
  params: { billingAccountId: string; userId: string; workspaceId: string },
  repository: BillingRepository,
): Promise<void> {
  const plan = await repository.getBillingAccountSubscriptionByServer({ billingAccountId: params.billingAccountId })
  if (!plan?.autoTopUpEnabled) return
  const { getOverlayServerContext } = await import('@/server/bootstrap')
  const server = getOverlayServerContext()
  const [members, access] = await Promise.all([
    server.workspaceService.listMembers({ actorUserId: params.userId, workspaceId: params.workspaceId }),
    server.workspaceService.resolveActiveWorkspace(params.userId, params.workspaceId),
  ])
  const recipients = members
    .filter((member) => member.membership.role === 'owner' || member.membership.role === 'admin')
    .flatMap((member) => (member.principal.type === 'human' && member.principal.userId ? [member.principal.userId] : []))
  const period = plan.currentPeriodStart ?? 'current'
  await Promise.all(recipients.map((userId) => server.lifecycleEvents.publish({
    attributes: {
      workspaceId: params.workspaceId,
      workspaceName: access.workspace.name,
      monthlyLimitCents: plan.autoTopUpMonthlyLimitCents ?? 0,
      ...(plan.currentPeriodEnd ? { periodEnd: plan.currentPeriodEnd } : {}),
    },
    idempotencyKey: `billing.auto_topup_limit_reached:${params.billingAccountId}:${period}:${userId}`,
    name: 'billing.auto_topup_limit_reached',
    resource: { id: params.billingAccountId, type: 'billing_account' },
    userId,
  })))
}
