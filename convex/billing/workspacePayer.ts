import type { MutationCtx, QueryCtx } from '../_generated/server'
import { workspaceTrialActive } from '../../src/shared/billing/execution-access'

export type PaidWorkspaceAccount = { billingAccountId: string; workspaceId: string; planAmountCents: number }

/**
 * The workspace a person is working in (the one named, else their active workspace), when it has an active paid
 * plan. Plans belong to workspaces, so this is who pays; without one there is no hosted execution allowance.
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

/**
 * Like `paidWorkspaceAccountFor`, but a workspace in its free trial also pays for usage, from the trial credit.
 * Only usage charging and the provider budget gate use this: paid features (automations, storage) still need a plan.
 */
export async function fundedWorkspaceAccountFor(
  ctx: QueryCtx | MutationCtx,
  userId: string,
  workspaceId?: string,
): Promise<PaidWorkspaceAccount | null> {
  const paid = await paidWorkspaceAccountFor(ctx, userId, workspaceId)
  if (paid) return paid
  const target = workspaceId?.trim() || (await ctx.db
    .query('workspaceUserPreferences')
    .withIndex('by_userId', (q) => q.eq('userId', userId))
    .first())?.activeWorkspaceId
  if (!target) return null
  const account = await ctx.db.query('billingAccounts').withIndex('by_workspaceId', (q) => q.eq('workspaceId', target)).unique()
  if (!account || account.status !== 'active') return null
  const plan = await ctx.db.query('billingAccountSubscriptions')
    .withIndex('by_billingAccountId', (q) => q.eq('billingAccountId', account.billingAccountId)).first()
  if (!plan || !workspaceTrialActive(plan, Date.now())) return null
  return { billingAccountId: account.billingAccountId, workspaceId: target, planAmountCents: 0 }
}
