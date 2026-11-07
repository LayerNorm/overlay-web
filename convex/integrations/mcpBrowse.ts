import { v } from 'convex/values'
import { query } from '../_generated/server'
import { nativeViewer, requireNativeWorkspace } from '../lib/nativeViewer'
import { requireNativeCapability } from '../lib/nativeCapabilities'
import { listScopedRows, scopeContextLoader } from '../lib/resourceScope'
import { mcpServerSummary } from './mcpServers'

/** A URL without credentials or query string, for members who may use a shared server but not edit it. */
function publicUrl(url: string | undefined): string | undefined {
  if (!url) return url
  try {
    const parsed = new URL(url)
    return `${parsed.origin}${parsed.pathname}`
  } catch {
    return undefined
  }
}

/**
 * The MCP servers a member can see in a view, live: configuration, connection state and tool catalog status, never
 * credentials. Only people who can edit a server see its full URL (it may carry a key). Null without `mcp.use`.
 */
export const servers = query({
  args: { workspaceId: v.string(), view: v.optional(v.union(v.literal('personal'), v.literal('workspace'), v.literal('archived'))) },
  handler: async (ctx, { workspaceId, view }) => {
    let userId: string
    try {
      userId = (await requireNativeWorkspace(ctx, workspaceId)).userId
      await requireNativeCapability(ctx, userId, 'mcp.use')
    } catch {
      return null
    }
    const rows = await listScopedRows(ctx, {
      userId, workspaceId, view,
      fetchMine: async () => (await ctx.db.query('mcpServers').withIndex('by_userId', q => q.eq('userId', userId)).order('desc').collect())
        .filter(row => row.workspaceId === workspaceId),
      fetchShared: async ws => await ctx.db.query('mcpServers')
        .withIndex('by_workspaceId_scope_archivedAt', q => q.eq('workspaceId', ws).eq('scope', 'workspace')).collect(),
    })
    const access = scopeContextLoader(ctx, userId)
    return await Promise.all(rows.map(async row => {
      const canEdit = await access.canEdit(row)
      const summary = mcpServerSummary(row)
      return { ...summary, url: canEdit ? summary.url : publicUrl(summary.url), canEdit }
    }))
  },
})

/** The other AI apps and tokens the signed-in person connected to Overlay's MCP server, live. Tokens never appear. */
export const connections = query({
  args: {},
  handler: async ctx => {
    const viewer = await nativeViewer(ctx)
    if (!viewer) return null
    const now = Date.now()
    const rows = await ctx.db.query('mcpGrants').withIndex('by_userId', q => q.eq('userId', viewer.userId)).take(200)
    return rows
      .filter(row => row.revokedAt === undefined && (row.expiresAt === undefined || row.expiresAt > now))
      .sort((a, b) => b.createdAt - a.createdAt)
      .map(row => ({
        id: String(row._id), name: row.clientName, kind: row.kind, access: row.access, workspaceId: row.workspaceId,
        createdAt: row.createdAt, lastUsedAt: row.lastUsedAt ?? null, expiresAt: row.expiresAt ?? null,
      }))
  },
})
