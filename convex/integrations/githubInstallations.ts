import { ConvexError, v } from 'convex/values'
import { mutation, query } from '../_generated/server'
import { requireServerSecret } from '../lib/auth'
import { requireNativeWorkspace } from '../lib/nativeViewer'

/**
 * GitHub App installations connected to a workspace (internal/develop/thread-folders.md). The server adds one
 * only after GitHub confirms the person connecting it can see the installation.
 */

export const list = query({
  args: { workspaceId: v.string() },
  handler: async (ctx, args) => {
    try {
      await requireNativeWorkspace(ctx, args.workspaceId)
    } catch {
      return []
    }
    const rows = await ctx.db.query('githubInstallations').withIndex('by_workspaceId', q => q.eq('workspaceId', args.workspaceId)).collect()
    return rows.filter(row => row.removedAt === undefined).map(row => ({
      installationId: row.installationId, accountLogin: row.accountLogin, accountType: row.accountType, createdAt: row.createdAt,
    }))
  },
})

export const listByServer = query({
  args: { serverSecret: v.string(), workspaceId: v.string() },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const rows = await ctx.db.query('githubInstallations').withIndex('by_workspaceId', q => q.eq('workspaceId', args.workspaceId)).collect()
    return rows.filter(row => row.removedAt === undefined).map(row => ({ installationId: row.installationId, accountLogin: row.accountLogin }))
  },
})

export const addByServer = mutation({
  args: {
    serverSecret: v.string(), workspaceId: v.string(), installationId: v.number(), accountLogin: v.string(),
    accountType: v.string(), connectedByUserId: v.string(), repositorySelection: v.optional(v.string()),
  },
  handler: async (ctx, { serverSecret, ...args }) => {
    requireServerSecret(serverSecret)
    const now = Date.now()
    const existing = await ctx.db.query('githubInstallations')
      .withIndex('by_workspaceId_installationId', q => q.eq('workspaceId', args.workspaceId).eq('installationId', args.installationId)).unique()
    if (existing) {
      await ctx.db.patch(existing._id, { ...args, updatedAt: now, removedAt: undefined })
      return null
    }
    await ctx.db.insert('githubInstallations', { ...args, createdAt: now, updatedAt: now })
    return null
  },
})

/**
 * The person who connected an installation, or a workspace owner or admin, can disconnect it. GitHub still holds
 * the app until it is uninstalled there.
 */
export const remove = mutation({
  args: { workspaceId: v.string(), installationId: v.number() },
  handler: async (ctx, args) => {
    const viewer = await requireNativeWorkspace(ctx, args.workspaceId)
    const existing = await ctx.db.query('githubInstallations')
      .withIndex('by_workspaceId_installationId', q => q.eq('workspaceId', args.workspaceId).eq('installationId', args.installationId)).unique()
    if (!existing || existing.removedAt !== undefined) return null
    const manager = viewer.membership.role === 'owner' || viewer.membership.role === 'admin'
    if (existing.connectedByUserId !== viewer.userId && !manager) throw new ConvexError('GITHUB_INSTALLATION_FORBIDDEN')
    await ctx.db.patch(existing._id, { removedAt: Date.now(), updatedAt: Date.now() })
    return null
  },
})
