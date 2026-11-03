import { v } from 'convex/values'
import { internalMutation } from '../_generated/server'
import { requirePreviewDeployment } from '../lib/preview'
import { claimWorkspaceHandle } from '../lib/workspaceHandles'
import { ensureEmptyBalance, ensureWorkspaceBillingAccount, uniqueWorkspaceAccount } from '../billing/accountModel'

/** Fresh low-credit accounts only; never debit existing fixtures or start work. */
export const init = internalMutation({
  args: { fixture: v.union(v.literal('synthetic'), v.literal('stripe-test')) },
  returns: v.object({ userId: v.string(), workspaceId: v.string(), billingAccountId: v.string(), agentId: v.string() }),
  handler: async (ctx, args) => {
    requirePreviewDeployment()
    const userId = process.env.PREVIEW_LOGIN_USER_ID?.trim()
    const email = process.env.PREVIEW_LOGIN_EMAIL?.trim()
    if (!userId?.startsWith('user_') || !email) throw new Error('Configure the sandbox preview login identity before seeding')
    const workspaceId = args.fixture === 'synthetic' ? `preview-funding-qa-${userId}` : `preview-topup-qa-${userId}`
    const principalId = `${workspaceId}-owner`
    const agentId = `${workspaceId}-agent`
    const existing = await ctx.db.query('workspaces').withIndex('by_workspaceId', q => q.eq('workspaceId', workspaceId)).unique()
    const previousAccount = await uniqueWorkspaceAccount(ctx, workspaceId)
    if (existing) {
      if (!previousAccount || existing.createdByPrincipalId !== principalId
        || previousAccount.primaryBillingContactUserId !== userId) throw new Error('Funding QA fixture ownership changed')
      return { userId, workspaceId, billingAccountId: previousAccount.billingAccountId, agentId }
    }
    if (previousAccount) throw new Error('Funding QA fixture account already exists')
    const now = Date.now()
    const slug = `funding-qa-${crypto.randomUUID().replaceAll('-', '').slice(0, 16)}`
    await claimWorkspaceHandle(ctx, { handle: slug, workspaceId, kind: 'canonical', visibility: 'public', now, allowReserved: true })
    await ctx.db.insert('workspaces', {
      workspaceId, kind: 'organization', name: args.fixture === 'synthetic' ? 'Funding QA' : 'Stripe TEST Funding QA',
      slug, status: 'active', createdByPrincipalId: principalId, createdAt: now, updatedAt: now,
    })
    await ctx.db.insert('workspacePrincipals', { principalId, workspaceId, type: 'human', userId, email,
      displayName: 'Preview QA', createdAt: now, updatedAt: now })
    await ctx.db.insert('workspaceMemberships', { membershipId: `${workspaceId}-membership`, workspaceId, principalId,
      role: 'owner', status: 'active', joinedAt: now, updatedAt: now })
    const account = await ensureWorkspaceBillingAccount(ctx, { workspaceId, primaryBillingContactUserId: userId })
    await ctx.db.insert('billingAccountSubscriptions', {
      billingAccountId: account.billingAccountId, provider: 'preview-fixture', planKind: 'paid', planVersion: 'variable_v2',
      planAmountCents: 800, markupBasisPoints: account.markupBasisPoints, status: 'active',
      autoTopUpEnabled: false, autoTopUpAmountCents: 0,
      currentPeriodStart: now, currentPeriodEnd: now + 30 * 86_400_000, createdAt: now, updatedAt: now,
    })
    const balance = await ensureEmptyBalance(ctx, account.billingAccountId)
    await ctx.db.patch(balance._id, { includedMicros: 10_000, version: balance.version + 1, updatedAt: now })
    const agentPrincipalId = `${agentId}-principal`
    await ctx.db.insert('workspacePrincipals', { principalId: agentPrincipalId, workspaceId, type: 'agent', agentId,
      displayName: 'Funding QA Agent', createdByPrincipalId: principalId, createdAt: now, updatedAt: now })
    await ctx.db.insert('workspaceMemberships', { membershipId: `${agentId}:membership`, workspaceId,
      principalId: agentPrincipalId, role: 'member', status: 'active', joinedAt: now, updatedAt: now })
    await ctx.db.insert('workspaceAgentDefinitions', {
      agentId, principalId: agentPrincipalId, workspaceId, name: 'Funding QA Agent',
      instructions: 'You are a synthetic preview QA assistant. Answer briefly. Do not use external tools.',
      harness: 'overlay', modelId: 'minimax/minimax-m3.1-flash', allowedToolIds: [],
      invocationPolicy: 'mention', visibility: 'creator', createdByPrincipalId: principalId,
      avatarColor: 'blue', avatarShape: 'round', teamIds: [], roomCount: 0, createdAt: now, updatedAt: now,
    })
    await ctx.db.insert('workspaceResourceScopes', { workspaceId, resourceType: 'agent', resourceId: agentId, createdAt: now, updatedAt: now })
    await ctx.db.insert('auditEvents', {
      eventId: `preview-funding-qa:${workspaceId}`, actorType: 'system', action: 'preview.qa.funding.seed',
      resourceType: 'workspace', resourceId: workspaceId, outcome: 'success',
      metadataJson: JSON.stringify({ fixture: args.fixture, includedMicros: 10_000, synthetic: true }), createdAt: now,
    })
    return { userId, workspaceId, billingAccountId: account.billingAccountId, agentId }
  },
})
