import { paginationOptsValidator } from 'convex/server'
import { v } from 'convex/values'
import type { MutationCtx } from '../_generated/server'
import { mutation, query } from '../_generated/server'
import type { Doc } from '../_generated/dataModel'
import { requireServerSecret } from '../lib/auth'

export const auditBatchByServer = query({
  args: {
    serverSecret: v.string(),
    table: v.union(v.literal('conversations'), v.literal('messages')),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    if (args.table === 'conversations') {
      const page = await ctx.db.query('conversations').paginate(args.paginationOpts)
      let missingResourceScope = 0
      for (const conversation of page.page) {
        const scope = await ctx.db.query('workspaceResourceScopes')
          .withIndex('by_resource', (q) => (
            q.eq('resourceType', 'conversation').eq('resourceId', conversation._id)
          ))
          .unique()
        if (!scope || scope.workspaceId !== conversation.workspaceId) missingResourceScope++
      }
      return {
        rows: page.page.length,
        missingConversationScope: page.page.filter((conversation) => (
          !conversation.workspaceId
          || !conversation.conversationType
          || !conversation.createdByPrincipalId
        )).length,
        missingMessageAuthor: 0,
        missingResourceScope,
        continueCursor: page.continueCursor,
        isDone: page.isDone,
      }
    }
    const page = await ctx.db.query('conversationMessages').paginate(args.paginationOpts)
    return {
      rows: page.page.length,
      missingConversationScope: 0,
      missingMessageAuthor: page.page.filter((message) => (
        !message.authorKind
        || ((message.authorKind === 'human' || message.authorKind === 'agent')
          && !message.authorPrincipalId)
      )).length,
      missingResourceScope: 0,
      continueCursor: page.continueCursor,
      isDone: page.isDone,
    }
  },
})

export const migrateConversationsBatchByServer = mutation({
  args: {
    serverSecret: v.string(),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const page = await ctx.db.query('conversations').paginate(args.paginationOpts)
    let migrated = 0
    let scopesBound = 0
    for (const conversation of page.page) {
      const scope = await ensureLegacyPersonalScope(ctx, conversation.userId)
      if (
        !conversation.workspaceId
        || !conversation.conversationType
        || !conversation.createdByPrincipalId
      ) {
        await ctx.db.patch(conversation._id, {
          workspaceId: conversation.workspaceId ?? scope.workspaceId,
          conversationType: conversation.conversationType ?? 'personal',
          createdByPrincipalId: conversation.createdByPrincipalId ?? scope.principalId,
        })
        migrated++
      }
      const workspaceId = conversation.workspaceId ?? scope.workspaceId
      const existingScope = await ctx.db.query('workspaceResourceScopes')
        .withIndex('by_resource', (q) => (
          q.eq('resourceType', 'conversation').eq('resourceId', conversation._id)
        ))
        .unique()
      if (!existingScope) {
        await ctx.db.insert('workspaceResourceScopes', {
          workspaceId,
          resourceType: 'conversation',
          resourceId: conversation._id,
          createdAt: conversation.createdAt,
          updatedAt: conversation.updatedAt ?? conversation.lastModified,
        })
        scopesBound++
      } else if (existingScope.workspaceId !== workspaceId || !existingScope.updatedAt) {
        await ctx.db.patch(existingScope._id, {
          workspaceId,
          updatedAt: conversation.updatedAt ?? conversation.lastModified,
        })
      }
    }
    return {
      rows: page.page.length,
      migrated,
      scopesBound,
      continueCursor: page.continueCursor,
      isDone: page.isDone,
    }
  },
})

export const migrateMessagesBatchByServer = mutation({
  args: {
    serverSecret: v.string(),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const page = await ctx.db.query('conversationMessages').paginate(args.paginationOpts)
    let migrated = 0
    for (const message of page.page) {
      if (message.authorKind && (
        message.authorKind === 'model'
        || message.authorKind === 'system'
        || message.authorPrincipalId
      )) continue
      const conversation = await ctx.db.get(message.conversationId)
      if (!conversation) continue
      const scope = conversation.createdByPrincipalId
        ? { principalId: conversation.createdByPrincipalId }
        : await ensureLegacyPersonalScope(ctx, conversation.userId)
      await ctx.db.patch(message._id, {
        authorKind: message.role === 'user' ? 'human' : 'model',
        authorPrincipalId: message.role === 'user' ? scope.principalId : undefined,
      })
      migrated++
    }
    return {
      rows: page.page.length,
      migrated,
      continueCursor: page.continueCursor,
      isDone: page.isDone,
    }
  },
})

async function ensureLegacyPersonalScope(ctx: MutationCtx, userId: string) {
  const existingWorkspace = await ctx.db.query('workspaces')
    .withIndex('by_personalOwnerUserId', (q) => q.eq('personalOwnerUserId', userId))
    .unique()
  if (existingWorkspace) {
    const principal = await requireHumanPrincipal(ctx, existingWorkspace.workspaceId, userId)
    return { workspaceId: existingWorkspace.workspaceId, principalId: principal.principalId }
  }
  const now = Date.now()
  const token = stableToken(userId)
  const workspaceId = `personal-${token}`
  const principalId = `human-${token}`
  await ctx.db.insert('workspaces', {
    workspaceId,
    kind: 'personal',
    name: 'Personal',
    slug: `personal-${token}`,
    status: 'active',
    createdByPrincipalId: principalId,
    personalOwnerUserId: userId,
    createdAt: now,
    updatedAt: now,
  })
  await ctx.db.insert('workspacePrincipals', {
    principalId,
    workspaceId,
    type: 'human',
    userId,
    displayName: 'Member',
    createdAt: now,
    updatedAt: now,
  })
  await ctx.db.insert('workspaceMemberships', {
    membershipId: `membership-${token}`,
    workspaceId,
    principalId,
    role: 'owner',
    status: 'active',
    joinedAt: now,
    updatedAt: now,
  })
  const preference = await ctx.db.query('workspaceUserPreferences')
    .withIndex('by_userId', (q) => q.eq('userId', userId))
    .unique()
  if (!preference) {
    await ctx.db.insert('workspaceUserPreferences', {
      userId,
      activeWorkspaceId: workspaceId,
      updatedAt: now,
    })
  }
  return { workspaceId, principalId }
}

async function requireHumanPrincipal(
  ctx: MutationCtx,
  workspaceId: string,
  userId: string,
): Promise<Doc<'workspacePrincipals'>> {
  const principal = await ctx.db.query('workspacePrincipals')
    .withIndex('by_workspaceId_userId', (q) => (
      q.eq('workspaceId', workspaceId).eq('userId', userId)
    ))
    .unique()
  if (!principal || principal.type !== 'human' || principal.archivedAt) {
    throw new Error('PERSONAL_WORKSPACE_PRINCIPAL_MISSING')
  }
  return principal
}

function stableToken(value: string) {
  let hash = 2166136261
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36)
}
