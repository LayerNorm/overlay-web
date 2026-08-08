import { v } from 'convex/values'
import { mutation, query } from '../_generated/server'
import { requireAccessToken, validateServerSecret } from '../lib/auth'

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

export const listByWorkspace = query({
  args: {
    workspaceId: v.string(),
    userId: v.string(),
    accessToken: v.optional(v.string()),
    serverSecret: v.optional(v.string()),
  },
  handler: async (ctx, { workspaceId, userId, accessToken, serverSecret }) => {
    await authorizeUserAccess({ userId, accessToken, serverSecret })
    const all = await ctx.db
      .query('workspaceConnectors')
      .withIndex('by_workspaceId', (q) => q.eq('workspaceId', workspaceId))
      .collect()
    return all.filter((row) => row.userId === userId)
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
    await authorizeUserAccess({ userId, accessToken, serverSecret })
    const now = Date.now()
    const rows = await ctx.db
      .query('workspaceConnectors')
      .withIndex('by_workspaceId_providerKey', (q) =>
        q.eq('workspaceId', workspaceId).eq('providerKey', providerKey),
      )
      .collect()
    const existing = rows.find((row) => row.userId === userId)
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
    await authorizeUserAccess({ userId, accessToken, serverSecret })
    const rows = await ctx.db
      .query('workspaceConnectors')
      .withIndex('by_workspaceId_providerKey', (q) =>
        q.eq('workspaceId', workspaceId).eq('providerKey', providerKey),
      )
      .collect()
    const existing = rows.find((row) => row.userId === userId)
    if (existing) {
      await ctx.db.delete(existing._id)
    }
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
