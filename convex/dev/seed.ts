import { v } from 'convex/values'
import { internalMutation, type MutationCtx } from '../_generated/server'
import { requireStagingSeedEnvironment } from '../lib/staging'
import { requirePreviewDeployment } from '../lib/preview'
import { ensureEmptyBalance, ensureWorkspaceBillingAccount, uniqueWorkspaceAccount } from '../billing/accountModel'

/** Internal, idempotent fixtures. Identity comes from the sandbox account configuration. */
export const init = internalMutation({
  args: {},
  returns: v.object({ userId: v.string(), workspaceId: v.string() }),
  handler: async (ctx) => {
    requirePreviewDeployment()
    const userId = process.env.PREVIEW_LOGIN_USER_ID?.trim()
    const email = process.env.PREVIEW_LOGIN_EMAIL?.trim()
    if (!userId?.startsWith('user_') || !email) throw new Error('Configure the sandbox preview login identity before seeding')
    const personal = await seedFixtures(ctx, { userId, email, lane: 'preview' })
    await seedComputerWorkspace(ctx, { userId, email })
    return personal
  },
})

/** Synthetic staging fixtures are available only on the pinned staging backend. */
export const initStaging = internalMutation({
  args: {},
  returns: v.object({ userId: v.string(), workspaceId: v.string() }),
  handler: async (ctx) => {
    const identity = requireStagingSeedEnvironment(process.env)
    return seedFixtures(ctx, { ...identity, lane: 'staging' })
  },
})

async function seedComputerWorkspace(ctx: MutationCtx, { userId, email }: { userId: string; email: string }) {
  requirePreviewDeployment()
  const workspaceId = 'preview-computer-qa-' + userId
  const principalId = workspaceId + '-owner'
  const existing = await ctx.db.query('workspaces')
    .withIndex('by_workspaceId', q => q.eq('workspaceId', workspaceId)).unique()
  // Re-seeding must not restore spent credit, reset holds, or undo QA plan changes.
  if (existing) return
  if (await uniqueWorkspaceAccount(ctx, workspaceId)) throw new Error('Preview Computer fixture account already exists')
  const now = Date.now()
  await ctx.db.insert('workspaces', {
    workspaceId, kind: 'organization', name: 'Computer QA', slug: workspaceId,
    status: 'active', createdByPrincipalId: principalId, createdAt: now, updatedAt: now,
  })
  await ctx.db.insert('workspacePrincipals', {
    principalId, workspaceId, type: 'human', userId, email, displayName: 'Preview QA',
    createdAt: now, updatedAt: now,
  })
  await ctx.db.insert('workspaceMemberships', {
    membershipId: workspaceId + '-membership', workspaceId, principalId,
    role: 'owner', status: 'active', joinedAt: now, updatedAt: now,
  })
  const account = await ensureWorkspaceBillingAccount(ctx, { workspaceId, primaryBillingContactUserId: userId })
  const planAmountCents = 500
  await ctx.db.insert('billingAccountSubscriptions', {
    billingAccountId: account.billingAccountId, provider: 'preview-fixture',
    planKind: 'paid', planVersion: 'variable_v2', planAmountCents,
    markupBasisPoints: account.markupBasisPoints, status: 'active',
    autoTopUpEnabled: false, autoTopUpAmountCents: 0,
    currentPeriodStart: now, currentPeriodEnd: now + 30 * 24 * 60 * 60_000,
    createdAt: now, updatedAt: now,
  })
  const balance = await ensureEmptyBalance(ctx, account.billingAccountId)
  await ctx.db.patch(balance._id, { includedMicros: planAmountCents * 10_000, version: balance.version + 1 })
}

async function seedFixtures(
  ctx: MutationCtx,
  { userId, email, lane }: { userId: string; email: string; lane: 'preview' | 'staging' },
) {
  const label = lane === 'preview' ? 'Preview' : 'Staging'
  const now = Date.now()
  const personal = await ctx.db.query('workspaces')
    .withIndex('by_personalOwnerUserId', q => q.eq('personalOwnerUserId', userId)).unique()
  const workspaceId = personal?.workspaceId ?? lane + '-personal-' + userId
  const principalId = lane + '-human-' + userId
  const membershipId = lane + '-membership-' + userId

  const profile = await ctx.db.query('subscriptions')
    .withIndex('by_userId', (q) => q.eq('userId', userId)).unique()
  if (!profile) await ctx.db.insert('subscriptions', {
    userId, email, firstName: label, lastName: 'QA', name: label + ' QA',
    hasSeenOnboarding: true, lastLoginAt: now,
  })

  const workspace = await ctx.db.query('workspaces')
    .withIndex('by_workspaceId', (q) => q.eq('workspaceId', workspaceId)).unique()
  if (!workspace) {
    await ctx.db.insert('workspaces', {
      workspaceId, kind: 'personal', name: 'Personal', slug: workspaceId,
      status: 'active', personalOwnerUserId: userId, createdByPrincipalId: principalId,
      createdAt: now, updatedAt: now,
    })
    await ctx.db.insert('workspacePrincipals', {
      principalId, workspaceId, type: 'human', userId, email, displayName: label + ' QA',
      createdAt: now, updatedAt: now,
    })
    await ctx.db.insert('workspaceMemberships', {
      membershipId, workspaceId, principalId, role: 'owner', status: 'active',
      joinedAt: now, updatedAt: now,
    })
  }

  const conversation = await ctx.db.query('conversations')
    .withIndex('by_userId_clientId', (q) => q.eq('userId', userId).eq('clientId', lane + '-seed-chat-v1')).unique()
  if (!conversation) {
    const conversationId = await ctx.db.insert('conversations', {
      userId, workspaceId, title: label + ' conversation', clientId: lane + '-seed-chat-v1',
      conversationType: 'personal', lastMode: 'ask', askModelIds: ['openrouter/free'],
      actModelId: 'openrouter/free', createdAt: now, lastModified: now,
    })
    await ctx.db.insert('conversationMessages', {
      conversationId, userId, turnId: lane + '-seed-turn-v1', mode: 'ask', contentType: 'text',
      role: 'assistant', content: 'This conversation belongs to this ' + lane + ' backend.',
      status: 'completed', clientNonce: lane + '-seed-message-v1', createdAt: now,
    })
  }

  for (const fixture of [
    { clientId: lane + '-seed-note-v1', name: label + ' note', kind: 'note' as const,
      content: '# ' + label + ' note\n\nEditable synthetic data for this ' + lane + ' backend.' },
    { clientId: lane + '-seed-file-v1', name: lane + '-sample.txt', kind: 'upload' as const,
      content: 'A small synthetic file stored entirely in this ' + lane + ' backend.' },
  ]) {
    const existing = await ctx.db.query('files')
      .withIndex('by_userId_clientId', (q) => q.eq('userId', userId).eq('clientId', fixture.clientId)).unique()
    if (!existing) await ctx.db.insert('files', {
      ...fixture, userId, workspaceId, scope: 'personal', type: 'file',
      textContent: fixture.content, mimeType: 'text/plain', indexable: false,
      createdAt: now, updatedAt: now,
    })
  }
  const automation = await ctx.db.query('automations')
    .withIndex('by_workspaceId_userId_name', (q) => q.eq('workspaceId', workspaceId)
      .eq('userId', userId).eq('name', label + ' automation')).unique()
  if (!automation) {
    await ctx.db.insert('automations', {
      workspaceId, userId, scope: 'personal', name: label + ' automation',
      instructions: 'Sample paused automation for ' + lane + ' UI checks.',
      enabled: false, status: 'paused', createdAt: now, updatedAt: now,
    })
  }
  return { userId, workspaceId }
}
