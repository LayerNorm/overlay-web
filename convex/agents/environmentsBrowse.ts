import { v } from 'convex/values'
import { query } from '../_generated/server'
import { requireNativeWorkspace } from '../lib/nativeViewer'

function safe<T extends Record<string, unknown>>(row: T) {
  const { _id, _creationTime, publicKey, ...rest } = row as T & { _id?: unknown; _creationTime?: unknown; publicKey?: unknown }
  void _id
  void _creationTime
  void publicKey
  return rest
}

/**
 * The workspace's connected-agent environments, live, for every member. Heartbeats and lifecycle changes re-run the
 * query; the browser applies the online window to `lastSeenAt` itself (`effectiveAgentEnvironmentStatus`), since a
 * stale heartbeat writes nothing. Public keys and credential hashes never appear; a pending environment carries its
 * verification phrase so the person enrolling can compare it.
 */
export const list = query({
  args: { workspaceId: v.string() },
  handler: async (ctx, { workspaceId }) => {
    try {
      await requireNativeWorkspace(ctx, workspaceId)
    } catch {
      return null
    }
    const rows = await ctx.db.query('agentEnvironments').withIndex('by_workspaceId', q => q.eq('workspaceId', workspaceId)).order('desc').take(200)
    return await Promise.all(rows.map(async row => {
      const environment = { ...safe(row), id: row.environmentId }
      if (row.status !== 'pending') return environment
      const enrollment = await ctx.db.query('agentEnrollmentSessions').withIndex('by_environmentId', q => q.eq('environmentId', row.environmentId)).unique()
      return enrollment ? { ...environment, verificationPhrase: enrollment.verificationPhrase, enrollmentExpiresAt: enrollment.expiresAt } : environment
    }))
  },
})

/** Agent-to-environment bindings, live, for workspace owners and admins (as on the server). Null for others. */
export const bindings = query({
  args: { workspaceId: v.string(), agentId: v.optional(v.string()) },
  handler: async (ctx, { workspaceId, agentId }) => {
    try {
      const viewer = await requireNativeWorkspace(ctx, workspaceId)
      if (viewer.membership.role !== 'owner' && viewer.membership.role !== 'admin') return null
    } catch {
      return null
    }
    const rows = agentId
      ? await ctx.db.query('agentBindings').withIndex('by_workspaceId_agentId', q => q.eq('workspaceId', workspaceId).eq('agentId', agentId)).take(200)
      : await ctx.db.query('agentBindings').withIndex('by_workspaceId', q => q.eq('workspaceId', workspaceId)).take(200)
    return rows.sort((a, b) => b.updatedAt - a.updatedAt).map(row => ({ ...safe(row), id: row.bindingId }))
  },
})
