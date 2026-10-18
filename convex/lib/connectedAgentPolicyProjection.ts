import type { QueryCtx } from '../_generated/server'
import type { Entitlements } from '../../src/shared/app/app-contracts'
import { uniquePersonalAccount, uniqueWorkspaceAccount } from '../billing/accountModel'

/** Read the current policy inputs, without loading usage or top-up history. */
export async function connectedAgentPolicyProjection(ctx: QueryCtx, input: {
  workspaceId: string; userId: string
}): Promise<Pick<Entitlements, 'planKind' | 'tier'> | null | undefined> {
  try {
    const [workspace, principal] = await Promise.all([
      ctx.db.query('workspaces').withIndex('by_workspaceId', q => q.eq('workspaceId', input.workspaceId)).unique(),
      ctx.db.query('workspacePrincipals').withIndex('by_workspaceId_userId', q =>
        q.eq('workspaceId', input.workspaceId).eq('userId', input.userId)).unique(),
    ])
    if (!workspace || workspace.status !== 'active' || !principal || principal.archivedAt) return null
    const membership = await ctx.db.query('workspaceMemberships').withIndex('by_workspaceId_principalId', q =>
      q.eq('workspaceId', input.workspaceId).eq('principalId', principal.principalId)).unique()
    if (membership?.status !== 'active') return null
    const account = await uniqueWorkspaceAccount(ctx, input.workspaceId)
    const subscription = account ? await ctx.db.query('billingAccountSubscriptions')
      .withIndex('by_billingAccountId', q => q.eq('billingAccountId', account.billingAccountId)).unique() : null
    if (account && subscription?.planKind === 'paid') {
      if (account.status !== 'active') return null
      const balance = await ctx.db.query('billingAccountBalances').withIndex('by_billingAccountId', q =>
        q.eq('billingAccountId', account.billingAccountId)).unique()
      return balance ? {planKind: 'paid', tier: 'pro'} : null
    }
    const personal = await uniquePersonalAccount(ctx, input.userId)
    // Preserve the legacy resolver's wallet/balance initialization when needed.
    if (!personal) return undefined
    if (personal.status !== 'active') return null
    const balance = await ctx.db.query('billingAccountBalances').withIndex('by_billingAccountId', q =>
      q.eq('billingAccountId', personal.billingAccountId)).unique()
    return balance ? {planKind: 'free', tier: 'free'} : undefined
  } catch (error) {
    // Preserve Stop reads for known wallet inconsistencies without hiding backend faults.
    if (error instanceof Error && ['duplicate_workspace_billing_accounts',
      'duplicate_personal_billing_accounts', 'billing_account_owner_mismatch'].includes(error.message)) return null
    throw error
  }
}
