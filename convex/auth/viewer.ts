import { query } from '../_generated/server'
import { v } from 'convex/values'
import { nativeViewer, requireNativePersonalChat, requireNativeWorkspace } from '../lib/nativeViewer'

// Authentication only. Resource authorization belongs in each domain operation.
export const current = query({
  args: {},
  returns: v.union(v.null(), v.object({ userId: v.string() })),
  handler: nativeViewer,
})

export const workspace = query({
  args: { workspaceId: v.string() },
  handler: async (ctx, { workspaceId }) => {
    const viewer = await requireNativeWorkspace(ctx, workspaceId)
    return { userId: viewer.userId, workspaceId, principalId: viewer.principal.principalId, role: viewer.membership.role }
  },
})

export const personalChat = query({
  args: { workspaceId: v.string(), conversationId: v.id('conversations') },
  handler: async (ctx, args) => {
    const viewer = await requireNativePersonalChat(ctx, args)
    return { conversationId: viewer.conversation._id, workspaceId: viewer.workspaceId }
  },
})
