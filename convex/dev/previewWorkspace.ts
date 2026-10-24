import type { MutationCtx } from '../_generated/server'
import { ensureWorkspaceBillingAccount, ensureEmptyBalance } from '../billing/accountModel'
import { requirePreviewDeployment } from '../lib/preview'

export async function seedPreviewWorkspace(ctx: MutationCtx, { userId, email }: { userId: string; email: string }) {
  requirePreviewDeployment()
  const now = Date.now()
  const workspaceId = `preview-qa-team-${userId}`
  const ownerId = `${workspaceId}-owner`
  const memberId = `${workspaceId}-member`
  const workspace = await ctx.db.query('workspaces')
    .withIndex('by_workspaceId', q => q.eq('workspaceId', workspaceId)).unique()
  if (!workspace) await ctx.db.insert('workspaces', {
    workspaceId, kind: 'organization', name: 'Preview QA Team', slug: workspaceId,
    status: 'active', createdByPrincipalId: ownerId, createdAt: now, updatedAt: now,
  })

  for (const person of [
    { principalId: ownerId, userId, email, displayName: 'Preview QA', role: 'owner' as const },
    { principalId: memberId, userId: `${workspaceId}-synthetic-user`,
      email: 'preview-qa-long-member-metadata-for-direct-message-containment@example.test',
      displayName: 'Synthetic Preview Collaborator With A Deliberately Long Display Name For Layout QA',
      role: 'member' as const },
  ]) {
    const principal = await ctx.db.query('workspacePrincipals')
      .withIndex('by_principalId', q => q.eq('principalId', person.principalId)).unique()
    if (!principal) await ctx.db.insert('workspacePrincipals', {
      principalId: person.principalId, userId: person.userId, email: person.email,
      displayName: person.displayName, workspaceId, type: 'human', createdAt: now, updatedAt: now,
    })
    const membership = await ctx.db.query('workspaceMemberships')
      .withIndex('by_workspaceId_principalId', q => q.eq('workspaceId', workspaceId).eq('principalId', person.principalId)).unique()
    if (!membership) await ctx.db.insert('workspaceMemberships', {
      membershipId: `${person.principalId}-membership`, workspaceId, principalId: person.principalId,
      role: person.role, status: 'active', joinedAt: now, updatedAt: now,
    })
  }

  const account = await ensureWorkspaceBillingAccount(ctx, { workspaceId, primaryBillingContactUserId: userId })
  const subscription = await ctx.db.query('billingAccountSubscriptions')
    .withIndex('by_billingAccountId', q => q.eq('billingAccountId', account.billingAccountId)).unique()
  if (!subscription) {
    await ctx.db.insert('billingAccountSubscriptions', {
      billingAccountId: account.billingAccountId, provider: 'preview-fixture', planKind: 'paid',
      planVersion: 'variable_v2', planAmountCents: 100, markupBasisPoints: account.markupBasisPoints,
      status: 'active', autoTopUpEnabled: false, autoTopUpAmountCents: 0,
      createdAt: now, updatedAt: now,
    })
    const balance = await ensureEmptyBalance(ctx, account.billingAccountId)
    // One dollar of synthetic allowance, never replenished by rerunning the seed.
    await ctx.db.patch(balance._id, { includedMicros: 1_000_000, version: balance.version + 1, updatedAt: now })
  }

  for (const fixture of [
    { suffix: 'personal', name: 'QA Personal Agent', creator: ownerId, visibility: 'creator' as const },
    { suffix: 'workspace', name: 'QA Workspace Agent', creator: memberId, visibility: 'workspace' as const },
  ]) {
    const agentId = `${workspaceId}-${fixture.suffix}-agent`
    const principalId = `${agentId}-principal`
    const agent = await ctx.db.query('workspaceAgentDefinitions')
      .withIndex('by_agentId', q => q.eq('agentId', agentId)).unique()
    if (agent) continue
    await ctx.db.insert('workspacePrincipals', {
      principalId, workspaceId, type: 'agent', agentId, displayName: fixture.name,
      createdByPrincipalId: fixture.creator, createdAt: now, updatedAt: now,
    })
    await ctx.db.insert('workspaceMemberships', {
      membershipId: `${agentId}:membership`, workspaceId, principalId,
      role: 'member', status: 'active', joinedAt: now, updatedAt: now,
    })
    await ctx.db.insert('workspaceAgentDefinitions', {
      agentId, principalId, workspaceId, name: fixture.name,
      instructions: 'You are a synthetic preview QA assistant. Answer briefly. Do not use external tools.',
      harness: 'overlay', modelId: 'openai/gpt-4o-mini', allowedToolIds: [],
      invocationPolicy: 'mention', visibility: fixture.visibility, createdByPrincipalId: fixture.creator,
      avatarColor: 'blue', avatarShape: 'round', teamIds: [], roomCount: 0,
      createdAt: now, updatedAt: now,
    })
    await ctx.db.insert('workspaceResourceScopes', {
      workspaceId, resourceType: 'agent', resourceId: agentId, createdAt: now, updatedAt: now,
    })
  }
  return { userId, workspaceId }
}
