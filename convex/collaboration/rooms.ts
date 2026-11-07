import { v } from 'convex/values'
import { paginationOptsValidator } from 'convex/server'
import { mutation, query } from '../_generated/server'
import type { QueryCtx } from '../_generated/server'
import type { Id } from '../_generated/dataModel'
import { hydrateRemoteMessage, hydrateRemoteMessages } from '../lib/remoteMessageText'
import {
  deleteRoomMessage,
  editRoomMessage,
  nativeRoomActor,
  requireConversationAccess,
  roomMessageView,
} from './directMessages'

const roomArgs = { workspaceId: v.string(), conversationId: v.id('conversations') }
const DENIED = new Set(['Unauthorized', 'WORKSPACE_ACCESS_DENIED', 'CONVERSATION_ACCESS_DENIED'])

/** A room the signed-in member may read, or null. Reads never throw for missing access. */
async function readableRoom(ctx: QueryCtx, args: { workspaceId: string; conversationId: Id<'conversations'> }) {
  try {
    const actor = await nativeRoomActor(ctx, args.workspaceId)
    const access = await requireConversationAccess(ctx, { ...actor, conversationId: args.conversationId })
    const type = access.conversation.conversationType ?? 'personal'
    return type === 'dm' || type === 'channel' ? access : null
  } catch (error) {
    if (error instanceof Error && DENIED.has(error.message)) return null
    throw error
  }
}

/** The room's header facts for a member who may read it, or null; drives the unavailable state. */
export const access = query({
  args: roomArgs,
  handler: async (ctx, args) => {
    const room = await readableRoom(ctx, args)
    if (!room) return null
    return {
      title: room.conversation.title,
      conversationType: room.conversation.conversationType as 'dm' | 'channel',
      externalPlatform: room.conversation.externalPlatform ?? null,
    }
  },
})

/**
 * Newest-first room history, either the main timeline or one reply thread. Indexed by
 * thread root, so old roots and replies page in fully instead of falling outside a fixed scan.
 */
export const messages = query({
  args: { ...roomArgs, threadRootMessageId: v.optional(v.id('conversationMessages')), paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    if (!await readableRoom(ctx, args)) return { page: [], isDone: true, continueCursor: '' }
    const result = await ctx.db.query('conversationMessages')
      .withIndex('by_conversationId_threadRootMessageId_createdAt', q => q
        .eq('conversationId', args.conversationId)
        .eq('threadRootMessageId', args.threadRootMessageId))
      .order('desc')
      .paginate({ ...args.paginationOpts, numItems: Math.max(1, Math.min(100, args.paginationOpts.numItems)) })
    return { ...result, page: (await hydrateRemoteMessages(ctx, result.page)).map(roomMessageView) }
  },
})

/** One message in this room, for permalinks and thread roots outside the loaded window. */
export const message = query({
  args: { ...roomArgs, messageId: v.id('conversationMessages') },
  handler: async (ctx, args) => {
    if (!await readableRoom(ctx, args)) return null
    const row = await ctx.db.get(args.messageId)
    if (!row || row.conversationId !== args.conversationId) return null
    return roomMessageView(await hydrateRemoteMessage(ctx, row))
  },
})

export const editMessage = mutation({
  args: { ...roomArgs, messageId: v.id('conversationMessages'), content: v.string() },
  handler: async (ctx, args) => await editRoomMessage(ctx, { ...args, ...await nativeRoomActor(ctx, args.workspaceId) }),
})

export const deleteMessage = mutation({
  args: { ...roomArgs, messageId: v.id('conversationMessages') },
  handler: async (ctx, args) => await deleteRoomMessage(ctx, { ...args, ...await nativeRoomActor(ctx, args.workspaceId) }),
})
