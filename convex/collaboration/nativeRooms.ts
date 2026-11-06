import { paginationOptsValidator, paginationResultValidator } from 'convex/server'
import { v } from 'convex/values'
import { mutation, query } from '../_generated/server'
import type { QueryCtx } from '../_generated/server'
import type { Id } from '../_generated/dataModel'
import { requireNativeWorkspace } from '../lib/nativeViewer'
import { requireNativeCapability } from '../lib/nativeCapabilities'
import { requireNativeDeploymentFeature } from '../lib/nativeDeploymentPolicy'
import { nativeRoomOrNull, requireNativeRoom } from './nativeRoomAccess'
import { roomDetailValidator, roomMessage, roomMessageValidator, roomSummary, roomSummaryValidator } from './nativeRoomDtos'
import { participantViews, resolvedPrincipalName } from './roomParticipants'
import { createDirectMessageForActor } from './roomDirectMessageCreation'
import { createChannelForActor } from './roomChannelCreation'
import { deleteRoomMessage, editRoomMessage } from './roomMessagePolicy'
import { nativeThreadCompatibility, nativeThreadCompatibilityValidator } from '../lib/nativeThreadCompatibility'

const roomArgs = { workspaceId: v.string(), conversationId: v.id('conversations') }
const messageArgs = { ...roomArgs, messageId: v.id('conversationMessages') }
const pageOpts = (opts: { numItems: number; cursor: string | null }) => ({ ...opts, numItems: Math.max(1, Math.min(100, opts.numItems)) })

export const getExecution = query({
  args: { ...roomArgs, threadRootMessageId: v.optional(v.id('conversationMessages')) },
  returns: v.union(v.null(), v.object({ ...roomArgs, userId: v.string(), threadRootMessageId: v.optional(v.id('conversationMessages')), compatibility: nativeThreadCompatibilityValidator })),
  handler: async (ctx, args) => {
    const access = await nativeRoomOrNull(ctx, args)
    if (!access) return null
    if (args.threadRootMessageId) {
      const root = await ctx.db.get(args.threadRootMessageId)
      if (!root || root.conversationId !== args.conversationId || root.threadRootMessageId || root.deletedAt !== undefined) return null
    }
    return { ...args, userId: access.viewer.userId,
      compatibility: await nativeThreadCompatibility(ctx, access.conversation, args.threadRootMessageId, { runs: 100, roots: 200 }) }
  },
})

async function roomCreator(ctx: Pick<QueryCtx, 'auth' | 'db'>, workspaceId: string) {
  const viewer = await requireNativeWorkspace(ctx, workspaceId)
  await requireNativeDeploymentFeature(ctx, 'chat', workspaceId)
  await requireNativeCapability(ctx, viewer.userId, 'conversations.create')
  return { ...viewer, principal: { ...viewer.principal, displayName: await resolvedPrincipalName(ctx, viewer.principal) } }
}

export const listRooms = query({
  args: { workspaceId: v.string(), kind: v.union(v.literal('direct'), v.literal('channel')), archived: v.boolean(), paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(roomSummaryValidator),
  handler: async (ctx, args) => {
    const viewer = await requireNativeWorkspace(ctx, args.workspaceId)
    await requireNativeDeploymentFeature(ctx, 'chat', args.workspaceId)
    await requireNativeCapability(ctx, viewer.userId, 'conversations.read')
    const page = await ctx.db.query('conversationParticipants')
      .withIndex('by_workspaceId_principalId_status_roomLastModified', q => q.eq('workspaceId', args.workspaceId)
        .eq('principalId', viewer.principal.principalId).eq('status', 'active'))
      .order('desc').paginate(pageOpts(args.paginationOpts))
    const rows = await Promise.all(page.page.map(async participant => {
      const access = await nativeRoomOrNull(ctx, { workspaceId: args.workspaceId, conversationId: participant.conversationId })
      if (!access || Boolean(access.participant.archivedAt !== undefined) !== args.archived
        || access.conversation.agentId || (access.conversation.conversationType === 'channel' ? 'channel' : 'direct') !== args.kind) return null
      if (participant.roomLastModified === undefined) throw new Error('ROOM_RECENCY_NOT_READY')
      return roomSummary(access)
    }))
    return { ...page, page: rows.filter(row => row !== null) }
  },
})

export const getRoom = query({
  args: roomArgs, returns: v.union(v.null(), roomDetailValidator),
  handler: async (ctx, args) => {
    const access = await nativeRoomOrNull(ctx, args)
    if (!access) return null
    const participants = await participantViews(ctx, args.conversationId, 200)
    return {
      ...roomSummary(access), viewerPrincipalId: access.principal.principalId, viewerUserId: access.viewer.userId,
      externalPlatform: access.conversation.externalPlatform, topic: access.conversation.channelTopic?.slice(0, 240),
      visibility: access.conversation.channelVisibility,
      slug: access.conversation.channelSlug, createdAt: access.conversation.createdAt, updatedAt: access.conversation.updatedAt ?? access.conversation.lastModified,
      participants: participants.map(p => ({ ...p, displayName: p.displayName.slice(0, 240),
        photoUrl: p.photoUrl?.slice(0, 4_000), email: p.email?.slice(0, 320) })),
    }
  },
})

async function threadRoot(ctx: Pick<QueryCtx, 'db'>, conversationId: Id<'conversations'>, id: Id<'conversationMessages'>) {
  const root = await ctx.db.get(id)
  return root && root.conversationId === conversationId && !root.threadRootMessageId && root.deletedAt === undefined ? root : null
}

export const listMessages = query({
  args: { ...roomArgs, threadRootMessageId: v.optional(v.id('conversationMessages')), paginationOpts: paginationOptsValidator },
  returns: v.union(v.null(), paginationResultValidator(roomMessageValidator)),
  handler: async (ctx, args) => {
    if (!await nativeRoomOrNull(ctx, args)) return null
    if (args.threadRootMessageId && !await threadRoot(ctx, args.conversationId, args.threadRootMessageId)) return null
    const page = await ctx.db.query('conversationMessages')
      .withIndex('by_conversationId_threadRootMessageId_createdAt', q => q.eq('conversationId', args.conversationId)
        .eq('threadRootMessageId', args.threadRootMessageId))
      .order('desc').paginate(pageOpts(args.paginationOpts))
    return { ...page, page: await Promise.all(page.page.map(row => roomMessage(ctx, row))) }
  },
})

export const getMessageAnchor = query({
  args: messageArgs, returns: v.union(v.null(), v.object({ message: roomMessageValidator, threadRootMessageId: v.optional(v.id('conversationMessages')) })),
  handler: async (ctx, args) => {
    if (!await nativeRoomOrNull(ctx, args)) return null
    const row = await ctx.db.get(args.messageId)
    if (!row || row.conversationId !== args.conversationId || row.deletedAt !== undefined) return null
    if (row.threadRootMessageId && !await threadRoot(ctx, args.conversationId, row.threadRootMessageId)) return null
    return { message: await roomMessage(ctx, row), threadRootMessageId: row.threadRootMessageId }
  },
})

export const createDirectMessage = mutation({
  args: { workspaceId: v.string(), principalIds: v.array(v.string()), title: v.optional(v.string()), sourceConversationId: v.optional(v.id('conversations')) },
  returns: v.object({ conversationId: v.id('conversations'), created: v.boolean() }),
  handler: async (ctx, args) => {
    const viewer = await roomCreator(ctx, args.workspaceId)
    if (args.principalIds.length > 199) throw new Error('ROOM_RELATED_LIMIT_EXCEEDED')
    const result = await createDirectMessageForActor(ctx, { ...args, actorUserId: viewer.userId }, viewer.principal, 200)
    await requireNativeRoom(ctx, { workspaceId: args.workspaceId, conversationId: result.conversationId })
    return { conversationId: result.conversationId, created: result.created }
  },
})

export const createChannel = mutation({
  args: { workspaceId: v.string(), name: v.string(), topic: v.optional(v.string()), principalIds: v.optional(v.array(v.string())), visibility: v.union(v.literal('public'), v.literal('private')) },
  returns: v.object({ conversationId: v.id('conversations') }),
  handler: async (ctx, args) => {
    const viewer = await roomCreator(ctx, args.workspaceId)
    if ((args.principalIds?.length ?? 0) > 199) throw new Error('ROOM_RELATED_LIMIT_EXCEEDED')
    const result = await createChannelForActor(ctx, { ...args, actorUserId: viewer.userId }, viewer.principal, 200)
    return { conversationId: result.conversationId }
  },
})

export const editMessage = mutation({
  args: { ...messageArgs, content: v.string() }, returns: v.boolean(),
  handler: async (ctx, args) => {
    const access = await requireNativeRoom(ctx, args)
    await requireNativeCapability(ctx, access.viewer.userId, 'conversations.edit')
    if (args.content.length > 64_000) throw new Error('ROOM_MESSAGE_LIMIT_EXCEEDED')
    return editRoomMessage(ctx, args, { actor: access.principal, conversation: access.conversation }, 200)
  },
})

export const deleteMessage = mutation({
  args: messageArgs, returns: v.boolean(),
  handler: async (ctx, args) => {
    const access = await requireNativeRoom(ctx, args)
    await requireNativeCapability(ctx, access.viewer.userId, 'conversations.edit')
    return deleteRoomMessage(ctx, args, { actor: access.principal, conversation: access.conversation })
  },
})
