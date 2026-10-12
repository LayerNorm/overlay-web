import type { MutationCtx, QueryCtx } from '../_generated/server'
import { resolveWorkspaceBillingRollout, workspaceBillingRolloutConfigFromEnv } from '../../src/shared/billing/workspace-billing-rollout'

export type PaidWorkspaceAccount = { billingAccountId: string; workspaceId: string; planAmountCents: number }

/**
 * The workspace a person is working in (the one named, else their active workspace), when it has an active paid
 * plan. Plans belong to workspaces, so this is who pays; without one the person is on the workspace's free allowance.
 */
export async function paidWorkspaceAccountFor(
  ctx: QueryCtx | MutationCtx,
  userId: string,
  workspaceId?: string,
): Promise<PaidWorkspaceAccount | null> {
  const target = workspaceId?.trim() || (await ctx.db
    .query('workspaceUserPreferences')
    .withIndex('by_userId', (q) => q.eq('userId', userId))
    .first())?.activeWorkspaceId
  if (!target) return null
  if (!resolveWorkspaceBillingRollout(workspaceBillingRolloutConfigFromEnv(process.env), target).eligible) return null
  const account = await ctx.db
    .query('billingAccounts')
    .withIndex('by_workspaceId', (q) => q.eq('workspaceId', target))
    .unique()
  if (!account || account.status !== 'active') return null
  const plan = await ctx.db
    .query('billingAccountSubscriptions')
    .withIndex('by_billingAccountId', (q) => q.eq('billingAccountId', account.billingAccountId))
    .first()
  if (plan?.planKind !== 'paid') return null
  return { billingAccountId: account.billingAccountId, workspaceId: target, planAmountCents: plan.planAmountCents }
}
