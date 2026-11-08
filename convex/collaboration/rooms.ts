import { v } from 'convex/values'
import { paginationOptsValidator } from 'convex/server'
import { mutation, query } from '../_generated/server'
import type { QueryCtx } from '../_generated/server'
import type { Id } from '../_generated/dataModel'
import { hydrateRemoteMessage, hydrateRemoteMessages } from '../lib/remoteMessageText'
import { nativeThreadCompatibility } from '../lib/nativeThreadCompatibility'
import {
  addParticipantFor,
  deleteRoomMessage,
  editRoomMessage,
  listParticipantsFor,
  listPresenceFor,
  listThreadFollowsFor,
  nativeRoomActor,
  removeParticipantFor,
  requireConversationAccess,
  roomMessageView,
  setThreadFollowFor,
  updateParticipantStateFor,
  upsertPresenceFor,
} from './directMessages'
import {
  listPinsFor,
  listReactionsFor,
  listSavedMessagesFor,
  setPinnedFor,
  setReactionFor,
  setSavedFor,
} from './channels'

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

/** A readable room's type and scope, so a chat link can be routed to the right view. Null without access. */
export const scope = query({
  args: roomArgs,
  handler: async (ctx, args) => {
    const room = await readableRoom(ctx, args)
    if (!room) return null
    const conversationType = room.conversation.conversationType === 'channel' ? 'channel' as const : 'dm' as const
    return { conversationType, scope: room.conversation.scope === 'personal' ? 'personal' as const : 'workspace' as const }
  },
})

/**
 * Whether new messages may be posted to this conversation or one of its threads, live. Send still
 * enforces it on the server; this lets the composer reflect it without a request per open or focus.
 * Null when the member cannot access the conversation.
 */
export const compatibility = query({
  args: { ...roomArgs, threadRootMessageId: v.optional(v.id('conversationMessages')) },
  handler: async (ctx, args) => {
    try {
      const actor = await nativeRoomActor(ctx, args.workspaceId)
      const access = await requireConversationAccess(ctx, { ...actor, conversationId: args.conversationId })
      return {
        compatibility: await nativeThreadCompatibility(ctx, access.conversation, args.threadRootMessageId),
        agentId: access.conversation.agentId ?? null,
      }
    } catch (error) {
      if (error instanceof Error && (DENIED.has(error.message) || error.message === 'INVALID_THREAD_ROOT')) return null
      throw error
    }
  },
})

/**
 * A remote agent run's liveness in a room the member may read, live: the heartbeat and open tools the agent host
 * reports, without the run's transcript or another room's runs. Null without access or before the first heartbeat.
 */
export const runLiveness = query({
  args: { ...roomArgs, runId: v.string() },
  handler: async (ctx, args) => {
    if (args.runId.length > 200) return null
    const room = await readableRoom(ctx, args)
    if (!room) return null
    const run = await ctx.db.query('conversationAgentRuns').withIndex('by_externalRunId', q => q.eq('externalRunId', args.runId)).unique()
    return run?.conversationId === args.conversationId ? run.liveness ?? null : null
  },
})

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

/**
 * Everything collaborative about one room, live: participants, reactions, pins, the member's saved
 * messages and followed threads in it, and presence. Null when the member cannot read the room, so a
 * removed participant loses the room in every open client.
 */
export const state = query({
  args: roomArgs,
  handler: async (ctx, args) => {
    const room = await readableRoom(ctx, args)
    if (!room) return null
    const proof = { ...args, ...await nativeRoomActor(ctx, args.workspaceId) }
    const [participants, reactions, pins, saved, follows, presence] = await Promise.all([
      listParticipantsFor(ctx, proof),
      listReactionsFor(ctx, proof),
      listPinsFor(ctx, proof),
      listSavedMessagesFor(ctx, { actorUserId: proof.actorUserId, workspaceId: proof.workspaceId, native: true }),
      listThreadFollowsFor(ctx, proof),
      listPresenceFor(ctx, proof),
    ])
    const conversation = room.conversation
    return {
      currentPrincipalId: room.actor.principalId,
      channel: conversation.conversationType === 'channel'
        ? {
            conversationId: conversation._id,
            workspaceId: args.workspaceId,
            name: conversation.title,
            slug: conversation.channelSlug ?? '',
            topic: conversation.channelTopic,
            visibility: conversation.channelVisibility ?? 'public',
            participantCount: participants.length,
            createdAt: conversation.createdAt,
            updatedAt: conversation.updatedAt ?? conversation.lastModified,
          }
        : null,
      participants,
      reactions,
      pins,
      saved: saved.filter(row => row.conversationId === args.conversationId),
      follows,
      presence,
    }
  },
})

const messageArgs = { ...roomArgs, messageId: v.id('conversationMessages') }

export const setReaction = mutation({
  args: { ...messageArgs, emoji: v.string(), enabled: v.boolean() },
  handler: async (ctx, args) => {
    await setReactionFor(ctx, { ...args, ...await nativeRoomActor(ctx, args.workspaceId) })
    return null
  },
})

export const setPinned = mutation({
  args: { ...messageArgs, pinned: v.boolean() },
  handler: async (ctx, args) => await setPinnedFor(ctx, { ...args, ...await nativeRoomActor(ctx, args.workspaceId) }),
})

export const setSaved = mutation({
  args: { ...messageArgs, saved: v.boolean() },
  handler: async (ctx, args) => await setSavedFor(ctx, { ...args, ...await nativeRoomActor(ctx, args.workspaceId) }),
})

export const setThreadFollow = mutation({
  args: { ...roomArgs, threadRootMessageId: v.id('conversationMessages'), followed: v.boolean() },
  handler: async (ctx, args) => await setThreadFollowFor(ctx, { ...args, ...await nativeRoomActor(ctx, args.workspaceId) }),
})

/** The member's own room state: archive, mute level and read position. */
export const updateMyState = mutation({
  args: {
    ...roomArgs,
    archived: v.optional(v.boolean()),
    markRead: v.optional(v.boolean()),
    markUnread: v.optional(v.boolean()),
    readSequence: v.optional(v.number()),
    notificationLevel: v.optional(v.union(v.literal('all'), v.literal('mentions'), v.literal('muted'))),
  },
  handler: async (ctx, args) => await updateParticipantStateFor(ctx, { ...args, ...await nativeRoomActor(ctx, args.workspaceId) }),
})

export const addParticipant = mutation({
  args: { ...roomArgs, principalId: v.string() },
  handler: async (ctx, args) => await addParticipantFor(ctx, { ...args, ...await nativeRoomActor(ctx, args.workspaceId) }),
})

export const removeParticipant = mutation({
  args: { ...roomArgs, principalId: v.string() },
  handler: async (ctx, args) => await removeParticipantFor(ctx, { ...args, ...await nativeRoomActor(ctx, args.workspaceId) }),
})

/** Presence heartbeat. Rows expire by `lastSeenAt`; the room state query drops stale ones. */
export const heartbeat = mutation({
  args: {
    ...roomArgs,
    sessionId: v.string(),
    status: v.union(v.literal('online'), v.literal('away'), v.literal('offline')),
    typing: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    await upsertPresenceFor(ctx, { ...args, ...await nativeRoomActor(ctx, args.workspaceId) })
    return null
  },
})
