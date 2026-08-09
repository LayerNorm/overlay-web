import { v } from 'convex/values'
import type { MutationCtx, QueryCtx } from '../_generated/server'
import { mutation, query } from '../_generated/server'
import { requireAccessToken, validateServerSecret } from '../lib/auth'

type ConnectorDatabaseContext = { db: QueryCtx['db'] | MutationCtx['db'] }

async function authorizeUserAccess(params: {
  accessToken?: string
  serverSecret?: string
  userId: string
}) {
  if (validateServerSecret(params.serverSecret)) {
    return
  }
  await requireAccessToken(params.accessToken ?? '', params.userId)
}

async function requireActiveWorkspaceMembership(
  ctx: ConnectorDatabaseContext,
  workspaceId: string,
  userId: string,
) {
  const principal = await ctx.db
    .query('workspacePrincipals')
    .withIndex('by_workspaceId_userId', (q) => q.eq('workspaceId', workspaceId).eq('userId', userId))
    .unique()
  if (!principal || principal.archivedAt) throw new Error('WORKSPACE_ACCESS_DENIED')

  const membership = await ctx.db
    .query('workspaceMemberships')
    .withIndex('by_workspaceId_principalId', (q) =>
      q.eq('workspaceId', workspaceId).eq('principalId', principal.principalId))
    .unique()
  if (!membership || membership.status !== 'active') throw new Error('WORKSPACE_ACCESS_DENIED')
}

async function authorizeWorkspaceUserAccess(
  ctx: ConnectorDatabaseContext,
  params: {
    accessToken?: string
    serverSecret?: string
    userId: string
    workspaceId: string
  },
) {
  await authorizeUserAccess(params)
  await requireActiveWorkspaceMembership(ctx, params.workspaceId, params.userId)
}

export const listByWorkspace = query({
  args: {
    workspaceId: v.string(),
    userId: v.string(),
    accessToken: v.optional(v.string()),
    serverSecret: v.optional(v.string()),
  },
  handler: async (ctx, { workspaceId, userId, accessToken, serverSecret }) => {
    await authorizeWorkspaceUserAccess(ctx, { workspaceId, userId, accessToken, serverSecret })
    return await ctx.db
      .query('workspaceConnectors')
      .withIndex('by_workspaceId_userId_providerKey', (q) =>
        q.eq('workspaceId', workspaceId).eq('userId', userId))
      .collect()
  },
})

export const listByUser = query({
  args: {
    userId: v.string(),
    accessToken: v.optional(v.string()),
    serverSecret: v.optional(v.string()),
  },
  handler: async (ctx, { userId, accessToken, serverSecret }) => {
    await authorizeUserAccess({ userId, accessToken, serverSecret })
    return await ctx.db
      .query('workspaceConnectors')
      .withIndex('by_userId', (q) => q.eq('userId', userId))
      .collect()
  },
})

export const insert = mutation({
  args: {
    workspaceId: v.string(),
    userId: v.string(),
    providerKey: v.string(),
    connectedAccountId: v.string(),
    accessToken: v.optional(v.string()),
    serverSecret: v.optional(v.string()),
  },
  handler: async (ctx, { workspaceId, userId, providerKey, connectedAccountId, accessToken, serverSecret }) => {
    await authorizeWorkspaceUserAccess(ctx, { workspaceId, userId, accessToken, serverSecret })
    const now = Date.now()
    const rows = await ctx.db
      .query('workspaceConnectors')
      .withIndex('by_workspaceId_userId_providerKey', (q) =>
        q.eq('workspaceId', workspaceId).eq('userId', userId).eq('providerKey', providerKey))
      .collect()
    if (rows.length > 1) throw new Error('WORKSPACE_CONNECTOR_DUPLICATE')
    const existing = rows[0]
    if (existing) {
      await ctx.db.patch(existing._id, { connectedAccountId, updatedAt: now })
      return existing._id
    }
    return await ctx.db.insert('workspaceConnectors', {
      workspaceId,
      userId,
      providerKey,
      connectedAccountId,
      createdAt: now,
      updatedAt: now,
    })
  },
})

export const remove = mutation({
  args: {
    workspaceId: v.string(),
    providerKey: v.string(),
    userId: v.string(),
    accessToken: v.optional(v.string()),
    serverSecret: v.optional(v.string()),
  },
  handler: async (ctx, { workspaceId, providerKey, userId, accessToken, serverSecret }) => {
    await authorizeWorkspaceUserAccess(ctx, { workspaceId, userId, accessToken, serverSecret })
    const rows = await ctx.db
      .query('workspaceConnectors')
      .withIndex('by_workspaceId_userId_providerKey', (q) =>
        q.eq('workspaceId', workspaceId).eq('userId', userId).eq('providerKey', providerKey))
      .collect()
    for (const row of rows) await ctx.db.delete(row._id)
  },
})

export const removeByUser = mutation({
  args: {
    userId: v.string(),
    serverSecret: v.optional(v.string()),
    accessToken: v.optional(v.string()),
  },
  handler: async (ctx, { userId, serverSecret, accessToken }) => {
    await authorizeUserAccess({ userId, accessToken, serverSecret })
    const rows = await ctx.db
      .query('workspaceConnectors')
      .withIndex('by_userId', (q) => q.eq('userId', userId))
      .collect()
    for (const row of rows) {
      await ctx.db.delete(row._id)
    }
    return rows.length
  },
})
