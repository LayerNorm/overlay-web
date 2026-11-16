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
 * The workspace's connected machines (This Mac), live, for every member. Heartbeats and lifecycle changes re-run the
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
