import { paginationOptsValidator } from 'convex/server'
import { v } from 'convex/values'
import { mutation, query, type MutationCtx, type QueryCtx } from '../_generated/server'
import { nativePersonalChatScope, requireNativePersonalChat, requireNativeWorkspace } from '../lib/nativeViewer'
import { recordConversationEvent } from '../collaboration/events'
import { sanitizeChatTitle } from '@/shared/chat/chat-title'
import { requireNativeCapability } from '../lib/nativeCapabilities'

const resourceArgs = { workspaceId: v.string(), conversationId: v.id('conversations') }
type Access = Awaited<ReturnType<typeof requireNativePersonalChat>>

async function summary(ctx: QueryCtx, access: Access) {
  const { conversation, participant } = access
  const latest = await ctx.db.query('conversationMessages')
    .withIndex('by_conversationId_createdAt', q => q.eq('conversationId', conversation._id)).order('desc').first()
  return {
    _id: conversation._id,
    workspaceId: access.workspaceId,
    title: conversation.title,
    lastModified: conversation.lastModified,
    createdAt: conversation.createdAt,
    conversationType: 'personal' as const,
    scope: 'personal' as const,
    archivedAt: participant?.archivedAt,
    lastReadAt: participant?.lastReadAt,
    markedUnreadAt: participant?.markedUnreadAt,
    lastMessageId: latest?._id,
    lastMessageAt: latest?.createdAt,
    unread: participant?.markedUnreadAt !== undefined
      || Boolean(latest && latest.role === 'assistant' && latest.createdAt > (participant?.lastReadAt ?? conversation.createdAt)),
  }
}

export const list = query({
  args: { workspaceId: v.string(), archived: v.boolean(), paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    const viewer = await requireNativeWorkspace(ctx, args.workspaceId)
    await requireNativeCapability(ctx, viewer.userId, 'conversations.read')
    const result = await ctx.db.query('conversations')
      .withIndex('by_workspaceId_userId_lastModified', q => q.eq('workspaceId', args.workspaceId).eq('userId', viewer.userId))
      .order('desc').paginate({ ...args.paginationOpts, numItems: Math.max(1, Math.min(100, args.paginationOpts.numItems)) })
    const rows = await Promise.all(result.page.map(async conversation => {
      const access = await nativePersonalChatScope(ctx, viewer, conversation)
      if (!access || (access.participant?.archivedAt !== undefined) !== args.archived) return null
      return summary(ctx, access)
    }))
    return { ...result, page: rows.filter(row => row !== null) }
  },
})

export const getSummary = query({
  args: resourceArgs,
  handler: async (ctx, args) => {
    const viewer = await requireNativeWorkspace(ctx, args.workspaceId)
    await requireNativeCapability(ctx, viewer.userId, 'conversations.read')
    const access = await nativePersonalChatScope(ctx, viewer, await ctx.db.get(args.conversationId))
    return access ? summary(ctx, access) : null
  },
})

// Native writes cannot use the BFF's IP gate; enforce a verified-user budget here.
async function admitWrite(ctx: MutationCtx, userId: string) {
  const bucket = 'personal-chat:write:user'
  const bucketKey = `${bucket}:${userId}`
  const now = Date.now()
  const existing = await ctx.db.query('rateLimitWindows').withIndex('by_bucketKey', q => q.eq('bucketKey', bucketKey)).unique()
  if (existing && existing.resetAt > now && existing.count >= 300) throw new Error('RATE_LIMITED')
  const value = { bucket, bucketKey, count: existing && existing.resetAt > now ? existing.count + 1 : 1,
    resetAt: existing && existing.resetAt > now ? existing.resetAt : now + 600_000, updatedAt: now }
  if (existing) await ctx.db.patch(existing._id, value)
  else await ctx.db.insert('rateLimitWindows', value)
}

async function participantId(ctx: MutationCtx, access: Access) {
  if (access.participant) return access.participant._id
  const now = Date.now()
  return ctx.db.insert('conversationParticipants', {
    conversationId: access.conversation._id, workspaceId: access.workspaceId,
    principalId: access.principal.principalId, principalType: 'human', role: 'moderator',
    status: 'active', notificationLevel: 'all', joinedAt: now, updatedAt: now,
  })
}

export const rename = mutation({
  args: { ...resourceArgs, title: v.string() },
  handler: async (ctx, args) => {
    const access = await requireNativePersonalChat(ctx, args)
    const title = sanitizeChatTitle(args.title, access.conversation.title)
    await requireNativeCapability(ctx, access.userId, 'conversations.edit')
    if (title === access.conversation.title) return
    await admitWrite(ctx, access.userId)
    const now = Date.now()
    await ctx.db.patch(args.conversationId, { title, updatedAt: now, lastModified: now })
    await recordConversationEvent(ctx, { ...args, userId: access.userId, type: 'conversation.updated' })
  },
})

export const setArchived = mutation({
  args: { ...resourceArgs, archived: v.boolean() },
  handler: async (ctx, args) => {
    const access = await requireNativePersonalChat(ctx, args)
    await requireNativeCapability(ctx, access.userId, 'conversations.read')
    if ((access.participant?.archivedAt !== undefined) === args.archived) return
    await admitWrite(ctx, access.userId)
    const now = Date.now()
    await ctx.db.patch(await participantId(ctx, access), { archivedAt: args.archived ? now : undefined, updatedAt: now })
    await recordConversationEvent(ctx, { ...args, userId: access.userId, type: args.archived ? 'conversation.archived' : 'conversation.restored' })
  },
})

export const setRead = mutation({
  args: { ...resourceArgs, unread: v.boolean(), throughMessageId: v.optional(v.id('conversationMessages')) },
  handler: async (ctx, args) => {
    const access = await requireNativePersonalChat(ctx, args)
    const message = args.throughMessageId ? await ctx.db.get(args.throughMessageId) : null
    await requireNativeCapability(ctx, access.userId, 'conversations.read')
    if (args.throughMessageId && (!message || message.conversationId !== args.conversationId)) throw new Error('MESSAGE_ACCESS_DENIED')
    if (!args.unread && !message) return
    if (!args.unread && !access.participant?.markedUnreadAt && (access.participant?.lastReadAt ?? -1) >= message!.createdAt) return
    await admitWrite(ctx, access.userId)
    const now = Date.now()
    await ctx.db.patch(await participantId(ctx, access), {
      markedUnreadAt: args.unread ? now : undefined,
      lastReadAt: args.unread ? access.participant?.lastReadAt : Math.max(access.participant?.lastReadAt ?? 0, message!.createdAt),
      updatedAt: now,
    })
  },
})
