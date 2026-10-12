import { v } from 'convex/values'
import { internalMutation } from '../_generated/server'
import { requirePreviewDeployment } from '../lib/preview'

/** Internal, idempotent fixtures. Identity comes from the sandbox account configuration. */
export const init = internalMutation({
  args: {},
  returns: v.object({ userId: v.string(), workspaceId: v.string() }),
  handler: async (ctx) => {
    requirePreviewDeployment()
    const userId = process.env.PREVIEW_LOGIN_USER_ID?.trim()
    const email = process.env.PREVIEW_LOGIN_EMAIL?.trim()
    if (!userId?.startsWith('user_') || !email) throw new Error('Configure the sandbox preview login identity before seeding')
    const now = Date.now()
    const workspaceId = 'preview-personal-' + userId
    const principalId = 'preview-human-' + userId
    const membershipId = 'preview-membership-' + userId

    const profile = await ctx.db.query('subscriptions')
      .withIndex('by_userId', (q) => q.eq('userId', userId)).unique()
    if (!profile) await ctx.db.insert('subscriptions', {
      userId, email, firstName: 'Preview', lastName: 'QA', name: 'Preview QA',
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
        principalId, workspaceId, type: 'human', userId, email, displayName: 'Preview QA',
        createdAt: now, updatedAt: now,
      })
      await ctx.db.insert('workspaceMemberships', {
        membershipId, workspaceId, principalId, role: 'owner', status: 'active',
        joinedAt: now, updatedAt: now,
      })
    }

    const conversation = await ctx.db.query('conversations')
      .withIndex('by_userId_clientId', (q) => q.eq('userId', userId).eq('clientId', 'preview-seed-chat-v1')).unique()
    if (!conversation) {
      const conversationId = await ctx.db.insert('conversations', {
        userId, workspaceId, title: 'Preview conversation', clientId: 'preview-seed-chat-v1',
        conversationType: 'personal', lastMode: 'ask', askModelIds: ['openrouter/free'],
        actModelId: 'openrouter/free', createdAt: now, lastModified: now,
      })
      await ctx.db.insert('conversationMessages', {
        conversationId, userId, turnId: 'preview-seed-turn-v1', mode: 'ask', contentType: 'text',
        role: 'assistant', content: 'This conversation belongs to this PR preview.',
        status: 'completed', clientNonce: 'preview-seed-message-v1', createdAt: now,
      })
    }

    for (const fixture of [
      { clientId: 'preview-seed-note-v1', name: 'Preview note', kind: 'note' as const,
        content: '# Preview note\n\nThis is editable sample data for this PR.' },
      { clientId: 'preview-seed-file-v1', name: 'preview-sample.txt', kind: 'upload' as const,
        content: 'A small text file stored entirely in this preview backend.' },
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
        .eq('userId', userId).eq('name', 'Preview automation')).unique()
    if (!automation) {
      await ctx.db.insert('automations', {
        workspaceId, userId, scope: 'personal', name: 'Preview automation',
        instructions: 'Sample paused automation for preview UI checks.',
        enabled: false, status: 'paused', createdAt: now, updatedAt: now,
      })
    }
    return { userId, workspaceId }
  },
})
