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
  if (!topUp.applied) {
    if (topUp.reason === 'monthly_limit_reached') await notifyLimitReached(params, repository).catch((_error) => undefined)
    return { entitlements: params.entitlements, remainingCents }
  }
  const refreshed = await repository.getBillingAccountEntitlementsByServer({
    billingAccountId: params.billingAccountId,
  }) as Entitlements | null
  const entitlements = refreshed ?? params.entitlements
  return { entitlements, remainingCents: deps.remainingCents(entitlements) }
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
