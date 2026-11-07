import { v } from 'convex/values'
import { mutation, query } from '../_generated/server'
import { conversationListVersion } from '../lib/conversationListVersion'
import { requireNativeWorkspace } from '../lib/nativeViewer'
import { listNotificationRows, markNotificationsReadFor, nativeRoomActor } from './directMessages'

const DENIED = new Set(['Unauthorized', 'UNAUTHENTICATED', 'WORKSPACE_ACCESS_DENIED'])

/** The signed-in member's newest notifications, live. Null for a caller without workspace access. */
export const notifications = query({
  args: { workspaceId: v.string() },
  handler: async (ctx, args) => {
    try {
      return await listNotificationRows(ctx, { ...await nativeRoomActor(ctx, args.workspaceId), filter: 'all', limit: 100 })
    } catch (error) {
      if (error instanceof Error && DENIED.has(error.message)) return null
      throw error
    }
  },
})

/** Changes whenever a DM or channel list in this workspace changes, so the room lists know to refresh. */
export const listVersion = query({
  args: { workspaceId: v.string() },
  handler: async (ctx, args) => {
    try {
      await requireNativeWorkspace(ctx, args.workspaceId)
    } catch (error) {
      if (error instanceof Error && DENIED.has(error.message)) return null
      throw error
    }
    return await conversationListVersion(ctx, { workspaceId: args.workspaceId })
  },
})

/**
 * Marks read only the notifications named, or one room's. Callers pass what the member has seen, so a
 * notification that arrives while marking stays unread. Already-read rows keep their first read time.
 */
export const markRead = mutation({
  args: {
    workspaceId: v.string(),
    notificationIds: v.optional(v.array(v.string())),
    conversationId: v.optional(v.id('conversations')),
  },
  handler: async (ctx, args) => {
    if (!args.notificationIds && !args.conversationId) return 0
    return await markNotificationsReadFor(ctx, { ...args, ...await nativeRoomActor(ctx, args.workspaceId) })
  },
})
