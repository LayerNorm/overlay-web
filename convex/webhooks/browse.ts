import { v } from 'convex/values'
import type { QueryCtx } from '../_generated/server'
import { query } from '../_generated/server'
import { requireNativeWorkspace } from '../lib/nativeViewer'
import { requireNativeCapability } from '../lib/nativeCapabilities'

const MAX_SUBSCRIPTIONS = 200

/** The viewer, if they may manage webhooks in this workspace on this deployment; null otherwise. */
async function managerFor(ctx: Pick<QueryCtx, 'auth' | 'db'>, workspaceId: string) {
  try {
    const viewer = await requireNativeWorkspace(ctx, workspaceId)
    await requireNativeCapability(ctx, viewer.userId, 'webhooks.manage')
    return viewer
  } catch {
    return null
  }
}

async function ownSubscriptions(ctx: Pick<QueryCtx, 'db'>, userId: string, workspaceId: string) {
  return await ctx.db.query('webhookSubscriptions')
    .withIndex('by_workspaceId_userId', q => q.eq('workspaceId', workspaceId).eq('userId', userId))
    .order('desc')
    .take(MAX_SUBSCRIPTIONS)
}

/**
 * The viewer's webhooks in this workspace, live: an endpoint added, edited, disabled or removed in any tab shows at
 * once. Signing secrets are never returned (they appear only once, when created or rotated).
 */
export const subscriptions = query({
  args: { workspaceId: v.string() },
  handler: async (ctx, { workspaceId }) => {
    const viewer = await managerFor(ctx, workspaceId)
    if (!viewer) return null
    const rows = await ownSubscriptions(ctx, viewer.userId, workspaceId)
    return rows.map(row => ({
      _id: row._id,
      url: row.url,
      events: row.events,
      enabled: row.enabled,
      description: row.description,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }))
  },
})

/**
 * Recent deliveries to the viewer's webhooks in this workspace, live: pending, delivering, delivered, failed and
 * dead-lettered transitions from the delivery runner show as they happen. Payloads are never returned.
 */
export const deliveries = query({
  args: { workspaceId: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, { workspaceId, limit }) => {
    const viewer = await managerFor(ctx, workspaceId)
    if (!viewer) return null
    const owned = new Set((await ownSubscriptions(ctx, viewer.userId, workspaceId)).map(row => row._id))
    const rows = await ctx.db.query('webhookDeliveries')
      .withIndex('by_userId_createdAt', q => q.eq('userId', viewer.userId))
      .order('desc')
      .take(Math.min(Math.max(limit ?? 100, 1), 250))
    return rows.filter(row => owned.has(row.subscriptionId)).map(row => ({
      _id: row._id,
      attemptCount: row.attemptCount,
      attempts: [],
      createdAt: row.createdAt,
      deliveredAt: row.deliveredAt,
      eventId: row.eventId,
      eventType: row.eventType,
      lastError: row.lastError,
      lastStatusCode: row.lastStatusCode,
      status: row.status === 'dead' ? 'dead_letter' as const : row.status,
      subscriptionId: row.subscriptionId,
      updatedAt: row.updatedAt,
    }))
  },
})
