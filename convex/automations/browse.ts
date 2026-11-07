import { v } from 'convex/values'
import { query, type QueryCtx } from '../_generated/server'
import { requireNativeWorkspace } from '../lib/nativeViewer'
import { requireNativeCapability } from '../lib/nativeCapabilities'
import { getReadableRow } from '../lib/resourceScope'
import { listWorkspaceAutomations } from './automations'

const RUN_HISTORY_LIMIT = 50

/** The signed-in member with `automations.use` and the Automations deployment feature, the checks the routes make. */
async function automationViewerOrNull(ctx: QueryCtx, workspaceId: string) {
  try {
    const viewer = await requireNativeWorkspace(ctx, workspaceId)
    await requireNativeCapability(ctx, viewer.userId, 'automations.use')
    return viewer
  } catch {
    return null
  }
}

/**
 * Automations the member can see in a view, newest first and live: definition, schedule, enabled state and next run.
 * Agent-owned ones are left out unless asked for (they live under their agent). Null without access.
 */
export const list = query({
  args: {
    workspaceId: v.string(),
    view: v.optional(v.union(v.literal('personal'), v.literal('workspace'), v.literal('archived'))),
    includeAgentBound: v.optional(v.boolean()),
  },
  handler: async (ctx, { workspaceId, view, includeAgentBound }) => {
    const viewer = await automationViewerOrNull(ctx, workspaceId)
    if (!viewer) return null
    return (await listWorkspaceAutomations(ctx, { userId: viewer.userId, workspaceId, view }))
      .filter(row => !row.deletedAt && (includeAgentBound || !row.agentId))
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, 100)
  },
})

/** One automation, live; null when it is deleted or the member cannot read it. */
export const get = query({
  args: { workspaceId: v.string(), automationId: v.id('automations') },
  handler: async (ctx, { workspaceId, automationId }) => {
    const viewer = await automationViewerOrNull(ctx, workspaceId)
    if (!viewer) return null
    const row = await getReadableRow(ctx, { row: await ctx.db.get(automationId), userId: viewer.userId, workspaceId })
    return row && !row.deletedAt ? row : null
  },
})

/**
 * An automation's runs, newest first, live through admission, execution, retries and the terminal state. Only its
 * owner sees them, as on the server route.
 */
export const runs = query({
  args: { workspaceId: v.string(), automationId: v.id('automations') },
  handler: async (ctx, { workspaceId, automationId }) => {
    const viewer = await automationViewerOrNull(ctx, workspaceId)
    if (!viewer) return []
    const automation = await ctx.db.get(automationId)
    if (!automation || automation.userId !== viewer.userId || automation.deletedAt || automation.workspaceId !== workspaceId) return []
    return await ctx.db.query('automationRuns')
      .withIndex('by_automationId_createdAt', q => q.eq('automationId', automationId))
      .order('desc')
      .take(RUN_HISTORY_LIMIT)
  },
})
