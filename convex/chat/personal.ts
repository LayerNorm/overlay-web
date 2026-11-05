import { paginationOptsValidator, paginationResultValidator } from 'convex/server'
import { convexToJson, v } from 'convex/values'
import { mutation, query, type MutationCtx, type QueryCtx } from '../_generated/server'
import { nativePersonalChatScope, requireNativePersonalChat, requireNativeWorkspace } from '../lib/nativeViewer'
import { recordConversationEvent } from '../collaboration/events'
import { sanitizeChatTitle } from '@/shared/chat/chat-title'
import { requireNativeCapability } from '../lib/nativeCapabilities'
import { hydrateRemoteMessage, hydrateRemoteMessages } from '../lib/remoteMessageText'
import { DEFAULT_MODEL_ID } from '@/shared/ai/gateway/model-types'
import { buildPersistedMessageContent, sanitizeMessagePartsForPersistence } from '@/shared/chat/chat-message-persistence'
import type { Id } from '../_generated/dataModel'
import { internal } from '../_generated/api'
import { userMessageMetadata } from '../lib/userMessageMetadata'
import { assertNativeThreadWritable } from '../lib/nativeThreadCompatibility'

const resourceArgs = { workspaceId: v.string(), conversationId: v.id('conversations') }
type Access = Awaited<ReturnType<typeof requireNativePersonalChat>>

const summaryValidator = v.object({
  _id: v.id('conversations'), workspaceId: v.string(), title: v.string(),
  lastModified: v.number(), createdAt: v.number(),
  askModelIds: v.array(v.string()), actModelId: v.string(), lastMode: v.union(v.literal('ask'), v.literal('act')),
  conversationType: v.literal('personal'), scope: v.literal('personal'),
  archivedAt: v.optional(v.number()), lastReadAt: v.optional(v.number()),
  markedUnreadAt: v.optional(v.number()), lastMessageId: v.optional(v.id('conversationMessages')),
  lastMessageAt: v.optional(v.number()), unread: v.boolean(),
})

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
    askModelIds: conversation.askModelIds,
    actModelId: conversation.actModelId,
    lastMode: conversation.lastMode,
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
  returns: paginationResultValidator(summaryValidator),
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
  returns: v.union(v.null(), summaryValidator),
  handler: async (ctx, args) => {
    const viewer = await requireNativeWorkspace(ctx, args.workspaceId)
    await requireNativeCapability(ctx, viewer.userId, 'conversations.read')
    const access = await nativePersonalChatScope(ctx, viewer, await ctx.db.get(args.conversationId))
    return access ? summary(ctx, access) : null
  },
})

export const getMessages = query({
  args: { ...resourceArgs, paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    const access = await requireNativePersonalChat(ctx, args)
    await requireNativeCapability(ctx, access.userId, 'conversations.read')
    const result = await ctx.db.query('conversationMessages')
      .withIndex('by_conversationId_createdAt', q => q.eq('conversationId', args.conversationId))
      .order('desc').paginate({ ...args.paginationOpts, numItems: Math.max(1, Math.min(100, args.paginationOpts.numItems)) })
    const messages = await hydrateRemoteMessages(ctx, result.page)
    const presentUsers = new Set(messages.filter(message => message.role === 'user').map(message => message.turnId))
    const missingTurns = [...new Set(messages.filter(message => message.role === 'assistant'
      && !presentUsers.has(message.turnId)).map(message => message.turnId))]
    const contextUsers = new Map(await Promise.all(missingTurns.map(async turnId => {
      const user = await ctx.db.query('conversationMessages')
        .withIndex('by_conversationId_turnId_role', q => q.eq('conversationId', args.conversationId).eq('turnId', turnId).eq('role', 'user'))
        .first()
      return [turnId, user ? await hydrateRemoteMessage(ctx, user) : null] as const
    })))
    const outputs = await personalOutputs(ctx, args, access.userId, [...new Set(messages.map(message => message.turnId))])
    return { ...result, page: messages.map(message => ({
      message,
      contextUser: contextUsers.get(message.turnId) ?? null,
      outputs: outputs.get(message.turnId) ?? [],
    })) }
  },
})

async function canReadOutputs(ctx: QueryCtx, userId: string) {
  try {
    await requireNativeCapability(ctx, userId, 'files.read')
    return true
  } catch (error) {
    if (error instanceof Error && ['CAPABILITY_ACCESS_DENIED', 'DEPLOYMENT_FEATURE_ACCESS_DENIED',
      'NATIVE_POLICY_SOURCE_UNAVAILABLE', 'NATIVE_POLICY_SOURCE_INVALID'].includes(error.message)) return false
    throw error
  }
}

async function personalOutputs(
  ctx: QueryCtx,
  args: { workspaceId: string; conversationId: Id<'conversations'> },
  userId: string,
  turnIds: string[],
) {
  const allowed = await canReadOutputs(ctx, userId)
  return new Map(await Promise.all((allowed ? turnIds : []).map(async turnId => {
    const files = await ctx.db.query('files').withIndex('by_userId_conversationId_turnId', q =>
      q.eq('userId', userId).eq('conversationId', args.conversationId).eq('turnId', turnId)).take(101)
    if (files.length > 100) throw new Error('PERSONAL_TURN_OUTPUT_LIMIT')
    const outputs = files.filter(file => file.kind === 'output' && file.scope !== 'workspace'
      && (!file.workspaceId || file.workspaceId === args.workspaceId)
      && file.deletedAt === undefined && file.archivedAt === undefined).map(file => ({
      _id: file._id, type: file.outputType ?? 'document', status: file.outputStatus ?? 'completed',
      prompt: file.prompt ?? '', modelId: file.modelId ?? '', createdAt: file.createdAt, turnId,
      url: file.storageId || file.r2Key ? `/api/v1/files/${encodeURIComponent(file._id)}/content` : undefined,
    }))
    return [turnId, outputs] as const
  })))
}

const preferenceArgs = {
  askModelIds: v.array(v.string()),
  actModelId: v.string(),
  lastMode: v.union(v.literal('ask'), v.literal('act')),
}

function preferences(args: { askModelIds: string[]; actModelId: string; lastMode: 'ask' | 'act' }) {
  const askModelIds = [...new Set(args.askModelIds.map(id => id.trim()).filter(Boolean))].slice(0, 4)
  if (!askModelIds.length) askModelIds.push(DEFAULT_MODEL_ID)
  return { askModelIds, actModelId: args.actModelId.trim() || askModelIds[0]!, lastMode: args.lastMode }
}

async function createPersonalConversation(ctx: MutationCtx, args: {
  workspaceId: string; clientId: string; title: string
  askModelIds: string[]; actModelId: string; lastMode: 'ask' | 'act'
}) {
    const viewer = await requireNativeWorkspace(ctx, args.workspaceId)
    await requireNativeCapability(ctx, viewer.userId, 'conversations.create')
    const clientId = args.clientId.trim()
    if (!clientId || clientId.length > 200) throw new Error('INVALID_CLIENT_ID')
    const existing = await ctx.db.query('conversations')
      .withIndex('by_userId_clientId', q => q.eq('userId', viewer.userId).eq('clientId', clientId)).first()
    if (existing) {
      if (!await nativePersonalChatScope(ctx, viewer, existing)) throw new Error('CONVERSATION_ACCESS_DENIED')
      return existing._id
    }
    await admitWrite(ctx, viewer.userId)
    const now = Date.now()
    const conversationId = await ctx.db.insert('conversations', {
      workspaceId: viewer.workspaceId, userId: viewer.userId, clientId,
      title: sanitizeChatTitle(args.title, 'New conversation'), ...preferences(args),
      conversationType: 'personal', scope: 'personal', createdByPrincipalId: viewer.principal.principalId,
      createdAt: now, updatedAt: now, lastModified: now,
    })
    await recordConversationEvent(ctx, { conversationId, workspaceId: viewer.workspaceId,
      userId: viewer.userId, type: 'conversation.created' })
    return conversationId
}

export const create = mutation({
  args: { workspaceId: v.string(), clientId: v.string(), title: v.string(), ...preferenceArgs },
  handler: createPersonalConversation,
})

const userPart = v.union(
  v.object({ type: v.literal('text'), text: v.string() }),
  v.object({ type: v.literal('file'), url: v.string(), mediaType: v.optional(v.string()), fileName: v.optional(v.string()) }),
)

export const submit = mutation({
  args: {
    workspaceId: v.string(), conversationId: v.optional(v.id('conversations')),
    clientId: v.optional(v.string()), title: v.optional(v.string()), turnId: v.string(),
    mode: v.union(v.literal('ask'), v.literal('act')), modelId: v.string(),
    contentType: v.union(v.literal('text'), v.literal('image'), v.literal('video')),
    parts: v.array(userPart), attachmentNames: v.optional(v.array(v.string())),
    userMetadata: v.optional(userMessageMetadata),
    replyToTurnId: v.optional(v.string()), replySnippet: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const turnId = args.turnId.trim()
    if (!turnId || turnId.length > 200) throw new Error('INVALID_TURN_ID')
    const conversationId = args.conversationId ?? await createPersonalConversation(ctx, {
      workspaceId: args.workspaceId, clientId: args.clientId ?? turnId, title: args.title ?? 'New conversation',
      askModelIds: [args.modelId], actModelId: args.modelId, lastMode: args.mode,
    })
    const access = await requireNativePersonalChat(ctx, { workspaceId: args.workspaceId, conversationId })
    await requireNativeCapability(ctx, access.userId, 'conversations.edit')
    await assertNativeThreadWritable(ctx, access.conversation)
    const options = { attachmentNames: args.attachmentNames }
    const sanitizedParts = sanitizeMessagePartsForPersistence(args.parts, options)
    const text = args.parts.filter(part => part.type === 'text').map(part => part.text).join('')
    const hasDocuments = args.userMetadata?.indexedAttachments?.some(attachment => attachment.fileIds.length > 0)
    const content = buildPersistedMessageContent(text, args.parts, options) || (hasDocuments ? '[Attached documents]' : '')
    const parts = sanitizedParts ?? (content ? [{ type: 'text' as const, text: content }] : undefined)
    if (!content && !parts?.length) throw new Error('EMPTY_MESSAGE')
    const existing = await ctx.db.query('conversationMessages')
      .withIndex('by_conversationId_turnId_role', q => q.eq('conversationId', conversationId).eq('turnId', turnId).eq('role', 'user')).first()
    if (existing) {
      if (existing.content !== content
        || JSON.stringify(convexToJson(existing.parts ?? null)) !== JSON.stringify(convexToJson(parts ?? null))
        || existing.mode !== args.mode || existing.contentType !== args.contentType || existing.modelId !== args.modelId
        || existing.deletedAt !== undefined || existing.replyToTurnId !== args.replyToTurnId
        || existing.replySnippet !== args.replySnippet
        || JSON.stringify(convexToJson(existing.userMetadata ?? null)) !== JSON.stringify(convexToJson(args.userMetadata ?? null))) throw new Error('TURN_ID_REUSED')
      return { conversationId, messageId: existing._id }
    }
    await admitWrite(ctx, access.userId)
    const now = Date.now()
    const messageId = await ctx.db.insert('conversationMessages', {
      conversationId, userId: access.userId, turnId, clientNonce: turnId, role: 'user',
      nativeSubmittedAt: now,
      mode: args.mode, modelId: args.modelId, contentType: args.contentType, content, parts,
      userMetadata: args.userMetadata,
      replyToTurnId: args.replyToTurnId, replySnippet: args.replySnippet, createdAt: now, updatedAt: now,
    })
    await ctx.db.patch(conversationId, { lastModified: now, updatedAt: now })
    await recordConversationEvent(ctx, { conversationId, workspaceId: access.workspaceId, userId: access.userId,
      type: 'message.created', messageId, payload: { turnId } })
    await ctx.scheduler.runAfter(0, internal.knowledge.knowledge.reindexMessageInternal, { messageId })
    return { conversationId, messageId }
  },
})

export const setPreferences = mutation({
  args: { ...resourceArgs, ...preferenceArgs },
  handler: async (ctx, args) => {
    const access = await requireNativePersonalChat(ctx, args)
    await requireNativeCapability(ctx, access.userId, 'conversations.edit')
    const next = preferences(args)
    const current = access.conversation
    if (current.actModelId === next.actModelId && current.lastMode === next.lastMode
      && JSON.stringify(current.askModelIds) === JSON.stringify(next.askModelIds)) return
    await admitWrite(ctx, access.userId)
    await ctx.db.patch(args.conversationId, { ...next, updatedAt: Date.now() })
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
