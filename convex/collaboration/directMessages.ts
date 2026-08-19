import { v } from 'convex/values'
import { DEFAULT_MODEL_ID } from '../../src/shared/ai/gateway/model-types'
import { mutation, query } from '../_generated/server'
import type { Doc, Id } from '../_generated/dataModel'
import type { MutationCtx, QueryCtx } from '../_generated/server'
import { requireAccessToken, validateServerSecret } from '../lib/auth'
import { recordConversationEvent } from './events'
import { resolveConversationActivityState } from '../../src/shared/chat/conversation-activity-state'

type CollaborationCtx = Pick<QueryCtx, 'db'> | Pick<MutationCtx, 'db'>

const notificationFilterValidator = v.union(
  v.literal('all'),
  v.literal('unread'),
  v.literal('mentions'),
  v.literal('threads'),
  v.literal('reactions'),
)

const notificationValidator = v.object({
  id: v.string(),
  workspaceId: v.string(),
  recipientPrincipalId: v.string(),
  type: v.union(v.literal('mention'), v.literal('thread'), v.literal('message'), v.literal('reaction'), v.literal('participant')),
  conversationId: v.id('conversations'),
  messageId: v.optional(v.id('conversationMessages')),
  actorPrincipalId: v.string(),
  threadRootMessageId: v.optional(v.id('conversationMessages')),
  eventSequence: v.optional(v.number()),
  mentionScope: v.optional(v.union(v.literal('direct'), v.literal('channel'), v.literal('here'))),
  title: v.string(),
  body: v.optional(v.string()),
  createdAt: v.number(),
  readAt: v.optional(v.number()),
  conversationState: v.optional(v.union(v.literal('archived'), v.literal('deleted'))),
})

async function requireActor(
  ctx: CollaborationCtx,
  args: {
    accessToken?: string
    actorUserId: string
    workspaceId: string
    serverSecret?: string
  },
) {
  if (!validateServerSecret(args.serverSecret)) {
    await requireAccessToken(args.accessToken ?? '', args.actorUserId)
  }
  const principal = await ctx.db.query('workspacePrincipals')
    .withIndex('by_workspaceId_userId', (q) => (
      q.eq('workspaceId', args.workspaceId).eq('userId', args.actorUserId)
    ))
    .unique()
  if (!principal || principal.type !== 'human' || principal.archivedAt) {
    throw new Error('WORKSPACE_ACCESS_DENIED')
  }
  const membership = await ctx.db.query('workspaceMemberships')
    .withIndex('by_workspaceId_principalId', (q) => (
      q.eq('workspaceId', args.workspaceId).eq('principalId', principal.principalId)
    ))
    .unique()
  if (!membership || membership.status !== 'active') throw new Error('WORKSPACE_ACCESS_DENIED')
  return principal
}

async function requireWorkspaceOwner(
  ctx: CollaborationCtx,
  args: {
    accessToken?: string
    actorUserId: string
    workspaceId: string
    serverSecret?: string
  },
) {
  const actor = await requireActor(ctx, args)
  const membership = await ctx.db.query('workspaceMemberships')
    .withIndex('by_workspaceId_principalId', (q) => (
      q.eq('workspaceId', args.workspaceId).eq('principalId', actor.principalId)
    ))
    .unique()
  if (membership?.status !== 'active' || membership.role !== 'owner') {
    throw new Error('WORKSPACE_OWNER_REQUIRED')
  }
  return actor
}

async function canAccess(
  ctx: CollaborationCtx,
  args: {
    actorUserId: string
    accessToken?: string
    conversationId: Id<'conversations'>
    workspaceId: string
    serverSecret?: string
  },
) {
  const actor = await requireActor(ctx, args)
  const conversation = await ctx.db.get(args.conversationId)
  if (!conversation || conversation.deletedAt || conversation.workspaceId !== args.workspaceId) {
    return { actor, allowed: false, conversation: null }
  }
  if ((conversation.conversationType ?? 'personal') === 'personal') {
    return { actor, allowed: conversation.userId === args.actorUserId, conversation }
  }
  const participant = await ctx.db.query('conversationParticipants')
    .withIndex('by_conversationId_principalId', (q) => (
      q.eq('conversationId', args.conversationId).eq('principalId', actor.principalId)
    ))
    .unique()
  return {
    actor,
    allowed: participant?.status === 'active',
    conversation,
    participant,
  }
}

async function requireConversationAccess(
  ctx: CollaborationCtx,
  args: {
    actorUserId: string
    accessToken?: string
    conversationId: Id<'conversations'>
    workspaceId: string
    serverSecret?: string
  },
) {
  const access = await canAccess(ctx, args)
  if (!access.allowed || !access.conversation) throw new Error('CONVERSATION_ACCESS_DENIED')
  return access
}

async function getMessageForThread(
  ctx: CollaborationCtx,
  conversationId: Id<'conversations'>,
  messageId: Id<'conversationMessages'>,
) {
  const message = await ctx.db.get(messageId)
  if (!message || message.conversationId !== conversationId || message.deletedAt) {
    throw new Error('Message not found')
  }
  return message
}

async function participantView(
  ctx: CollaborationCtx,
  participant: Doc<'conversationParticipants'>,
) {
  const principal = await ctx.db.query('workspacePrincipals')
    .withIndex('by_principalId', (q) => q.eq('principalId', participant.principalId))
    .unique()
  if (!principal) throw new Error('Participant principal is missing')
  return {
    conversationId: participant.conversationId,
    workspaceId: participant.workspaceId,
    principalId: participant.principalId,
    principalType: participant.principalType,
    displayName: principal.displayName,
    email: principal.email,
    role: participant.role,
    status: participant.status,
    notificationLevel: participant.notificationLevel,
    joinedAt: participant.joinedAt,
    updatedAt: participant.updatedAt,
    removedAt: participant.removedAt,
    lastReadAt: participant.lastReadAt,
    lastReadSequence: participant.lastReadSequence,
    markedUnreadAt: participant.markedUnreadAt,
    archivedAt: participant.archivedAt,
  }
}

async function participantViews(
  ctx: CollaborationCtx,
  conversationId: Id<'conversations'>,
) {
  const rows = await ctx.db.query('conversationParticipants')
    .withIndex('by_conversationId_status', (q) => (
      q.eq('conversationId', conversationId).eq('status', 'active')
    ))
    .collect()
  return await Promise.all(rows.sort((a, b) => a.joinedAt - b.joinedAt).map((row) => participantView(ctx, row)))
}

async function otherParticipantTypes(
  ctx: CollaborationCtx,
  conversationId: Id<'conversations'>,
  actorPrincipalId: string,
): Promise<Array<'human' | 'agent'>> {
  const rows = await ctx.db.query('conversationParticipants')
    .withIndex('by_conversationId_status', (q) => (
      q.eq('conversationId', conversationId).eq('status', 'active')
    ))
    .collect()
  return rows
    .filter((row) => row.principalId !== actorPrincipalId)
    .map((row) => row.principalType)
    .filter((type): type is 'human' | 'agent' => type === 'human' || type === 'agent')
}

export const getAccessibleConversation = query({
  args: {
    actorUserId: v.string(),
    conversationId: v.id('conversations'),
    workspaceId: v.string(),
    serverSecret: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const access = await canAccess(ctx, args)
    const conversation = access.allowed ? access.conversation : null
    if (!conversation) return null
    return {
      _id: conversation._id,
      userId: conversation.userId,
      clientId: conversation.clientId,
      title: conversation.title,
      lastModified: conversation.lastModified,
      createdAt: conversation.createdAt,
      updatedAt: conversation.updatedAt ?? conversation.lastModified,
      deletedAt: conversation.deletedAt,
      lastMode: conversation.lastMode,
      askModelIds: conversation.askModelIds,
      actModelId: conversation.actModelId,
      projectId: conversation.projectId,
      shareVisibility: conversation.shareVisibility,
      shareToken: conversation.shareToken,
      isAutomation: conversation.isAutomation,
      conversationType: conversation.conversationType ?? 'personal',
      otherParticipantTypes: await otherParticipantTypes(ctx, conversation._id, access.actor.principalId),
      workspaceId: conversation.workspaceId,
    }
  },
})

export const listAccessibleConversations = query({
  args: {
    actorUserId: v.string(),
    workspaceId: v.string(),
    serverSecret: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, args)
    const participantRows = await ctx.db.query('conversationParticipants')
      .withIndex('by_workspaceId_principalId_status', (q) => (
        q.eq('workspaceId', args.workspaceId).eq('principalId', actor.principalId).eq('status', 'active')
      ))
      .collect()
    const shared = new Set(participantRows.filter((row) => !row.archivedAt).map((row) => String(row.conversationId)))
    const rows = await ctx.db.query('conversations')
      .withIndex('by_workspaceId_conversationType_lastModified', (q) => q.eq('workspaceId', args.workspaceId))
      .collect()
    const accessible = rows.filter((conversation) => (
      !conversation.deletedAt
      && !conversation.projectId
      && !conversation.isAutomation
      && (
        ((conversation.conversationType ?? 'personal') === 'personal' && conversation.userId === args.actorUserId)
        || shared.has(String(conversation._id))
      )
    )).sort((left, right) => right.lastModified - left.lastModified)
    return await Promise.all(accessible.map(async (conversation) => ({
      _id: conversation._id,
      userId: conversation.userId,
      clientId: conversation.clientId,
      title: conversation.title,
      lastModified: conversation.lastModified,
      createdAt: conversation.createdAt,
      updatedAt: conversation.updatedAt ?? conversation.lastModified,
      deletedAt: conversation.deletedAt,
      lastMode: conversation.lastMode,
      askModelIds: conversation.askModelIds,
      actModelId: conversation.actModelId,
      projectId: conversation.projectId,
      shareVisibility: conversation.shareVisibility,
      shareToken: conversation.shareToken,
      isAutomation: conversation.isAutomation,
      conversationType: conversation.conversationType ?? 'personal',
      otherParticipantTypes: await otherParticipantTypes(ctx, conversation._id, actor.principalId),
      workspaceId: conversation.workspaceId,
    })))
  },
})

/**
 * Conversations the actor archived, newest first.
 *
 * Serves two callers. The conversations list subtracts these ids: archiving
 * writes `archivedAt` on the participant row, but the personal branch of that
 * list keys off `conversations.userId` and never consulted it, so anything the
 * actor created came straight back and archiving looked like a no-op. The
 * Archived view reads the same rows to show what was put away.
 */
export const listArchivedConversations = query({
  args: {
    actorUserId: v.string(),
    workspaceId: v.string(),
    serverSecret: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, args)
    const participantRows = await ctx.db.query('conversationParticipants')
      .withIndex('by_workspaceId_principalId_status', (q) => (
        q.eq('workspaceId', args.workspaceId).eq('principalId', actor.principalId).eq('status', 'active')
      ))
      .collect()
    const archived = new Map(
      participantRows
        .filter((row) => row.archivedAt)
        .map((row) => [String(row.conversationId), row.archivedAt as number]),
    )
    if (archived.size === 0) return []

    const rows = await Promise.all(
      [...archived.keys()].map((id) => ctx.db.get(id as Id<'conversations'>)),
    )
    return rows
      .filter((conversation): conversation is Doc<'conversations'> => (
        !!conversation && !conversation.deletedAt
      ))
      .map((conversation) => ({
        _id: conversation._id,
        userId: conversation.userId,
        clientId: conversation.clientId,
        title: conversation.title,
        lastModified: conversation.lastModified,
        createdAt: conversation.createdAt,
        updatedAt: conversation.updatedAt ?? conversation.lastModified,
        deletedAt: conversation.deletedAt,
        lastMode: conversation.lastMode,
        askModelIds: conversation.askModelIds,
        actModelId: conversation.actModelId,
        projectId: conversation.projectId,
        shareVisibility: conversation.shareVisibility,
        shareToken: conversation.shareToken,
        isAutomation: conversation.isAutomation,
        conversationType: conversation.conversationType ?? 'personal',
        workspaceId: conversation.workspaceId,
        archivedAt: archived.get(String(conversation._id)),
      }))
      .sort((left, right) => (right.archivedAt ?? 0) - (left.archivedAt ?? 0))
  },
})

export const listMessages = query({
  args: {
    actorUserId: v.string(),
    beforeCreatedAt: v.optional(v.number()),
    conversationId: v.id('conversations'),
    limit: v.number(),
    mainOnly: v.optional(v.boolean()),
    messageId: v.optional(v.id('conversationMessages')),
    threadRootMessageId: v.optional(v.id('conversationMessages')),
    workspaceId: v.string(),
    serverSecret: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireConversationAccess(ctx, args)
    const rows = await ctx.db.query('conversationMessages')
      .withIndex('by_conversationId_createdAt', (q) => {
        const conversationRows = q.eq('conversationId', args.conversationId)
        return args.beforeCreatedAt === undefined
          ? conversationRows
          : conversationRows.lt('createdAt', args.beforeCreatedAt)
      })
      .order('desc')
      .take(500)
    return rows
      .filter((message) => args.messageId === undefined || message._id === args.messageId)
      .filter((message) => args.threadRootMessageId === undefined || message.threadRootMessageId === args.threadRootMessageId)
      .filter((message) => args.mainOnly !== true || !message.threadRootMessageId)
      .slice(0, Math.max(1, Math.min(100, Math.floor(args.limit))))
      .reverse()
  },
})

/**
 * Browser-facing room transcript subscription. Convex re-runs this query when
 * any indexed message it depends on changes, so workspace participants receive
 * new messages without polling the Next.js BFF.
 *
 * Auth failures return `{ ok: false }` (not an empty message list) so the
 * client keeps the last valid transcript. Browser tokens must be the HS256
 * tokens from `/api/auth/convex-token` (signed with `INTERNAL_API_SECRET`).
 * WorkOS JWTs cannot be verified inside Convex queries because JWKS uses
 * fetch(), which queries forbid.
 */
export const watchRoomMessages = query({
  args: {
    accessToken: v.string(),
    actorUserId: v.string(),
    conversationId: v.id('conversations'),
    limit: v.number(),
    mainOnly: v.optional(v.boolean()),
    threadRootMessageId: v.optional(v.id('conversationMessages')),
    workspaceId: v.string(),
  },
  handler: async (ctx, args) => {
    try {
      await requireConversationAccess(ctx, args)
    } catch (error) {
      // A stale/refreshing browser token must not throw through React's route
      // boundary. Returning ok:false keeps the last valid transcript mounted
      // while ConvexAuthProvider refreshes authentication.
      if (error instanceof Error && [
        'Unauthorized',
        'WORKSPACE_ACCESS_DENIED',
        'CONVERSATION_ACCESS_DENIED',
      ].includes(error.message)) {
        return { ok: false as const, messages: [] as Array<Record<string, unknown>> }
      }
      throw error
    }
    const rows = await ctx.db.query('conversationMessages')
      .withIndex('by_conversationId_createdAt', (q) => q.eq('conversationId', args.conversationId))
      .order('desc')
      .take(500)
    const messages = rows
      .filter((message) => args.threadRootMessageId === undefined || message.threadRootMessageId === args.threadRootMessageId)
      .filter((message) => args.mainOnly !== true || !message.threadRootMessageId)
      .slice(0, Math.max(1, Math.min(100, Math.floor(args.limit))))
      .reverse()
      .map((message) => ({
        id: message._id,
        turnId: message.turnId,
        authorKind: message.authorKind ?? (message.role === 'assistant' ? 'model' : 'human'),
        authorPrincipalId: message.authorPrincipalId,
        importedAuthorName: message.importedAuthorName,
        importedAuthorEmail: message.importedAuthorEmail,
        importedAuthorStatus: message.importedAuthorStatus,
        content: message.content,
        parts: message.parts,
        createdAt: message.createdAt,
        editedAt: message.editedAt,
        editHistory: message.editHistory,
        deletedAt: message.deletedAt,
        clientNonce: message.clientNonce,
        threadRootMessageId: message.threadRootMessageId,
        status: message.status,
      }))
    return { ok: true as const, messages }
  },
})

export const addMessage = mutation({
  args: {
    actorUserId: v.string(),
    clientNonce: v.optional(v.string()),
    content: v.string(),
    conversationId: v.id('conversations'),
    parts: v.optional(v.array(v.any())),
    replySnippet: v.optional(v.string()),
    replyToTurnId: v.optional(v.string()),
    threadRootMessageId: v.optional(v.id('conversationMessages')),
    turnId: v.string(),
    workspaceId: v.string(),
    serverSecret: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const access = await requireConversationAccess(ctx, args)
    if ((access.conversation.conversationType ?? 'personal') === 'personal') {
      throw new Error('COLLABORATION_CONVERSATION_REQUIRED')
    }
    if (args.threadRootMessageId) {
      await getMessageForThread(ctx, args.conversationId, args.threadRootMessageId)
    }
    if (args.clientNonce) {
      const existing = await ctx.db.query('conversationMessages')
        .withIndex('by_conversationId', (q) => q.eq('conversationId', args.conversationId))
        .collect()
      const match = existing.find((message) => message.clientNonce === args.clientNonce)
      if (match) return match._id
    }
    const now = Date.now()
    const messageId = await ctx.db.insert('conversationMessages', {
      conversationId: args.conversationId,
      userId: args.actorUserId,
      authorKind: 'human',
      authorPrincipalId: access.actor.principalId,
      turnId: args.turnId,
      role: 'user',
      mode: 'act',
      content: args.content,
      contentType: 'text',
      parts: args.parts,
      replyToTurnId: args.replyToTurnId,
      replySnippet: args.replySnippet,
      clientNonce: args.clientNonce,
      threadRootMessageId: args.threadRootMessageId,
      status: 'completed',
      createdAt: now,
      updatedAt: now,
    })
    await ctx.db.patch(args.conversationId, { lastModified: now, updatedAt: now })
    await recordConversationEvent(ctx, {
      conversationId: args.conversationId,
      workspaceId: args.workspaceId,
      userId: args.actorUserId,
      type: 'message.created',
      messageId,
    })
    return messageId
  },
})

/** Persists a streamed workspace-agent reply after validating both the human
 * invoker's room access and the agent's active participation in that room. */
export const addAgentMessage = mutation({
  args: {
    actorUserId: v.string(),
    authorPrincipalId: v.string(),
    clientNonce: v.string(),
    content: v.string(),
    conversationId: v.id('conversations'),
    modelId: v.string(),
    threadRootMessageId: v.optional(v.id('conversationMessages')),
    tokens: v.optional(v.object({ input: v.number(), output: v.number() })),
    turnId: v.string(),
    workspaceId: v.string(),
    serverSecret: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const access = await requireConversationAccess(ctx, args)
    if ((access.conversation.conversationType ?? 'personal') === 'personal') {
      throw new Error('COLLABORATION_CONVERSATION_REQUIRED')
    }
    const [participant, principal] = await Promise.all([
      ctx.db.query('conversationParticipants')
        .withIndex('by_conversationId_principalId', (q) => (
          q.eq('conversationId', args.conversationId).eq('principalId', args.authorPrincipalId)
        ))
        .unique(),
      ctx.db.query('workspacePrincipals')
        .withIndex('by_principalId', (q) => q.eq('principalId', args.authorPrincipalId))
        .unique(),
    ])
    if (
      participant?.status !== 'active'
      || participant.principalType !== 'agent'
      || principal?.type !== 'agent'
      || principal.workspaceId !== args.workspaceId
      || principal.archivedAt
    ) {
      throw new Error('AGENT_PARTICIPANT_REQUIRED')
    }
    if (args.threadRootMessageId) {
      await getMessageForThread(ctx, args.conversationId, args.threadRootMessageId)
    }
    const existing = await ctx.db.query('conversationMessages')
      .withIndex('by_conversationId', (q) => q.eq('conversationId', args.conversationId))
      .collect()
    const match = existing.find((message) => message.clientNonce === args.clientNonce)
    if (match) return match._id

    const now = Date.now()
    const messageId = await ctx.db.insert('conversationMessages', {
      conversationId: args.conversationId,
      userId: args.actorUserId,
      authorKind: 'agent',
      authorPrincipalId: args.authorPrincipalId,
      turnId: args.turnId,
      role: 'assistant',
      mode: 'act',
      content: args.content,
      contentType: 'text',
      modelId: args.modelId,
      tokens: args.tokens,
      clientNonce: args.clientNonce,
      threadRootMessageId: args.threadRootMessageId,
      status: 'completed',
      createdAt: now,
      updatedAt: now,
    })
    await ctx.db.patch(args.conversationId, { lastMode: 'act', lastModified: now, updatedAt: now })
    await recordConversationEvent(ctx, {
      conversationId: args.conversationId,
      workspaceId: args.workspaceId,
      userId: args.actorUserId,
      type: 'message.created',
      messageId,
    })
    return messageId
  },
})

export const createDirectMessage = mutation({
  args: {
    actorUserId: v.string(),
    principalIds: v.array(v.string()),
    sourceConversationId: v.optional(v.id('conversations')),
    title: v.optional(v.string()),
    workspaceId: v.string(),
    serverSecret: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, args)
    const principalIds = [...new Set([actor.principalId, ...args.principalIds.map((id) => id.trim()).filter(Boolean)])]
      .sort()
    if (principalIds.length < 2) throw new Error('A direct message requires at least two participants')
    const principals = []
    for (const principalId of principalIds) {
      const principal = await ctx.db.query('workspacePrincipals')
        .withIndex('by_principalId', (q) => q.eq('principalId', principalId))
        .unique()
      const membership = await ctx.db.query('workspaceMemberships')
        .withIndex('by_workspaceId_principalId', (q) => (
          q.eq('workspaceId', args.workspaceId).eq('principalId', principalId)
        ))
        .unique()
      if (
        !principal
        || principal.workspaceId !== args.workspaceId
        || principal.archivedAt
        || (principal.type !== 'human' && principal.type !== 'agent')
        || membership?.status !== 'active'
      ) throw new Error('Every participant must be an active human or agent in this workspace')
      principals.push(principal)
    }

    const dmIdentityKey = principalIds.join(':')
    const existing = await ctx.db.query('conversations')
      .withIndex('by_workspaceId_dmIdentityKey', (q) => (
        q.eq('workspaceId', args.workspaceId).eq('dmIdentityKey', dmIdentityKey)
      ))
      .filter((q) => q.eq(q.field('deletedAt'), undefined))
      .first()
    if (existing) {
      const actorParticipant = await ctx.db.query('conversationParticipants')
        .withIndex('by_conversationId_principalId', (q) => (
          q.eq('conversationId', existing._id).eq('principalId', actor.principalId)
        ))
        .unique()
      if (actorParticipant?.archivedAt) {
        const now = Date.now()
        await ctx.db.patch(actorParticipant._id, { archivedAt: undefined, updatedAt: now })
        await recordConversationEvent(ctx, {
          conversationId: existing._id,
          workspaceId: args.workspaceId,
          userId: args.actorUserId,
          type: 'conversation.updated',
          payload: { conversationType: 'dm', unarchived: true },
        })
      }
      return {
        conversationId: existing._id,
        workspaceId: args.workspaceId,
        title: existing.title,
        participants: await participantViews(ctx, existing._id),
        created: false,
      }
    }

    if (args.sourceConversationId) {
      const source = await ctx.db.get(args.sourceConversationId)
      if (
        !source
        || source.workspaceId !== args.workspaceId
        || source.userId !== args.actorUserId
        || (source.conversationType ?? 'personal') !== 'personal'
        || source.deletedAt
      ) throw new Error('The source Personal chat is unavailable')
    }

    const now = Date.now()
    const otherNames = principals.filter((principal) => principal.principalId !== actor.principalId)
      .map((principal) => principal.displayName)
    const title = args.title?.trim().replace(/\s+/g, ' ').slice(0, 120)
      || otherNames.join(', ').slice(0, 120)
      || 'Direct message'
    const conversationId = await ctx.db.insert('conversations', {
      userId: args.actorUserId,
      workspaceId: args.workspaceId,
      conversationType: 'dm',
      createdByPrincipalId: actor.principalId,
      title,
      lastModified: now,
      updatedAt: now,
      createdAt: now,
      lastMode: 'act',
      askModelIds: [DEFAULT_MODEL_ID],
      actModelId: DEFAULT_MODEL_ID,
      dmIdentityKey,
    })
    for (const principal of principals) {
      await ctx.db.insert('conversationParticipants', {
        conversationId,
        workspaceId: args.workspaceId,
        principalId: principal.principalId,
        principalType: principal.type as 'human' | 'agent',
        role: principal.principalId === actor.principalId ? 'moderator' : 'member',
        status: 'active',
        notificationLevel: 'all',
        joinedAt: now,
        updatedAt: now,
        lastReadAt: principal.principalId === actor.principalId ? now : undefined,
      })
      if (principal.principalId !== actor.principalId) {
        await ctx.db.insert('workspaceNotifications', {
          notificationId: crypto.randomUUID(),
          workspaceId: args.workspaceId,
          recipientPrincipalId: principal.principalId,
          type: 'participant',
          conversationId,
          actorPrincipalId: actor.principalId,
          title: `${actor.displayName} started a conversation`,
          body: title,
          eventSequence: now,
          createdAt: now,
        })
      }
    }
    await ctx.db.insert('workspaceResourceScopes', {
      workspaceId: args.workspaceId,
      resourceType: 'conversation',
      resourceId: conversationId,
      createdAt: now,
      updatedAt: now,
    })
    await recordConversationEvent(ctx, {
      conversationId,
      workspaceId: args.workspaceId,
      userId: args.actorUserId,
      type: 'conversation.created',
      payload: { conversationType: 'dm' },
    })
    return {
      conversationId,
      workspaceId: args.workspaceId,
      title,
      participants: await participantViews(ctx, conversationId),
      created: true,
    }
  },
})

export const accessibleConversationIds = query({
  args: {
    actorUserId: v.string(),
    workspaceId: v.string(),
    serverSecret: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, args)
    const conversations = await ctx.db.query('conversations')
      .withIndex('by_workspaceId_conversationType_lastModified', (q) => q.eq('workspaceId', args.workspaceId))
      .collect()
    const participantRows = await ctx.db.query('conversationParticipants')
      .withIndex('by_workspaceId_principalId_status', (q) => (
        q.eq('workspaceId', args.workspaceId)
          .eq('principalId', actor.principalId)
          .eq('status', 'active')
      ))
      .collect()
    const shared = new Set(participantRows.filter((row) => !row.archivedAt).map((row) => String(row.conversationId)))
    return conversations.filter((conversation) => (
      !conversation.deletedAt
      && (
        ((conversation.conversationType ?? 'personal') === 'personal' && conversation.userId === args.actorUserId)
        || shared.has(String(conversation._id))
      )
    )).map((conversation) => String(conversation._id))
  },
})

export const canAccessConversation = query({
  args: {
    actorUserId: v.string(),
    conversationId: v.id('conversations'),
    workspaceId: v.string(),
    serverSecret: v.optional(v.string()),
  },
  handler: async (ctx, args) => (await canAccess(ctx, args)).allowed,
})

export const listParticipants = query({
  args: {
    actorUserId: v.string(),
    conversationId: v.id('conversations'),
    workspaceId: v.string(),
    serverSecret: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireConversationAccess(ctx, args)
    return await participantViews(ctx, args.conversationId)
  },
})

export const addParticipant = mutation({
  args: {
    actorUserId: v.string(),
    conversationId: v.id('conversations'),
    principalId: v.string(),
    workspaceId: v.string(),
    serverSecret: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const access = await requireConversationAccess(ctx, args)
    if (access.participant?.role !== 'moderator') throw new Error('CONVERSATION_MODERATOR_REQUIRED')
    if (access.conversation?.conversationType === 'dm') {
      throw new Error('DIRECT_MESSAGE_REQUIRES_NEW_GROUP')
    }
    const principal = await ctx.db.query('workspacePrincipals')
      .withIndex('by_principalId', (q) => q.eq('principalId', args.principalId))
      .unique()
    const membership = await ctx.db.query('workspaceMemberships')
      .withIndex('by_workspaceId_principalId', (q) => (
        q.eq('workspaceId', args.workspaceId).eq('principalId', args.principalId)
      )).unique()
    if (
      !principal
      || principal.workspaceId !== args.workspaceId
      || principal.archivedAt
      || (principal.type !== 'human' && principal.type !== 'agent')
      || membership?.status !== 'active'
    ) throw new Error('Participant is not eligible')
    const existing = await ctx.db.query('conversationParticipants')
      .withIndex('by_conversationId_principalId', (q) => (
        q.eq('conversationId', args.conversationId).eq('principalId', args.principalId)
      )).unique()
    const now = Date.now()
    let participant
    if (existing) {
      await ctx.db.patch(existing._id, {
        status: 'active',
        removedAt: undefined,
        archivedAt: undefined,
        updatedAt: now,
      })
      participant = { ...existing, status: 'active' as const, removedAt: undefined, archivedAt: undefined, updatedAt: now }
    } else {
      const id = await ctx.db.insert('conversationParticipants', {
        conversationId: args.conversationId,
        workspaceId: args.workspaceId,
        principalId: args.principalId,
        principalType: principal.type,
        role: 'member',
        status: 'active',
        notificationLevel: 'all',
        joinedAt: now,
        updatedAt: now,
      })
      participant = (await ctx.db.get(id))!
    }
    await ctx.db.insert('workspaceNotifications', {
      notificationId: crypto.randomUUID(),
      workspaceId: args.workspaceId,
      recipientPrincipalId: args.principalId,
      type: 'participant',
      conversationId: args.conversationId,
      actorPrincipalId: access.actor.principalId,
      title: `${access.actor.displayName} added you to a conversation`,
      eventSequence: now,
      createdAt: now,
    })
    return await participantView(ctx, participant)
  },
})

export const removeParticipant = mutation({
  args: {
    actorUserId: v.string(),
    conversationId: v.id('conversations'),
    principalId: v.string(),
    workspaceId: v.string(),
    serverSecret: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const access = await requireConversationAccess(ctx, args)
    if (access.actor.principalId !== args.principalId && access.participant?.role !== 'moderator') {
      throw new Error('CONVERSATION_MODERATOR_REQUIRED')
    }
    const active = await ctx.db.query('conversationParticipants')
      .withIndex('by_conversationId_status', (q) => (
        q.eq('conversationId', args.conversationId).eq('status', 'active')
      )).collect()
    if (active.length <= 1 && access.actor.principalId !== args.principalId) {
      throw new Error('A conversation must retain one participant')
    }
    const participant = await ctx.db.query('conversationParticipants')
      .withIndex('by_conversationId_principalId', (q) => (
        q.eq('conversationId', args.conversationId).eq('principalId', args.principalId)
      )).unique()
    if (!participant || participant.status !== 'active') return false
    const now = Date.now()
    await ctx.db.patch(participant._id, {
      status: 'removed',
      removedAt: now,
      archivedAt: now,
      updatedAt: now,
    })
    return true
  },
})

export const updateParticipantState = mutation({
  args: {
    actorUserId: v.string(),
    archived: v.optional(v.boolean()),
    conversationId: v.id('conversations'),
    markRead: v.optional(v.boolean()),
    markUnread: v.optional(v.boolean()),
    readSequence: v.optional(v.number()),
    notificationLevel: v.optional(v.union(v.literal('all'), v.literal('mentions'), v.literal('muted'))),
    workspaceId: v.string(),
    serverSecret: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const access = await requireConversationAccess(ctx, args)
    let participant = access.participant
    const now = Date.now()
    if (!participant) {
      // Personal chats are owned by userId and never created a participant
      // row. Archive (and other per-actor state) still needs one.
      if ((access.conversation.conversationType ?? 'personal') !== 'personal') {
        throw new Error('CONVERSATION_ACCESS_DENIED')
      }
      const existing = await ctx.db.query('conversationParticipants')
        .withIndex('by_conversationId_principalId', (q) => (
          q.eq('conversationId', args.conversationId).eq('principalId', access.actor.principalId)
        )).unique()
      if (existing) {
        participant = existing
      } else {
        const id = await ctx.db.insert('conversationParticipants', {
          conversationId: args.conversationId,
          workspaceId: args.workspaceId,
          principalId: access.actor.principalId,
          principalType: 'human',
          role: 'moderator',
          status: 'active',
          notificationLevel: 'all',
          joinedAt: now,
          updatedAt: now,
        })
        const created = await ctx.db.get(id)
        if (!created) throw new Error('CONVERSATION_ACCESS_DENIED')
        participant = created
      }
    }
    const requestedReadSequence = Number.isSafeInteger(args.readSequence) && (args.readSequence ?? 0) >= 0
      ? args.readSequence
      : undefined
    let readSequence = requestedReadSequence
    if (args.markRead || requestedReadSequence !== undefined) {
      const events = await ctx.db.query('conversationEvents')
        .withIndex('by_conversationId_createdAt', (q) => q.eq('conversationId', args.conversationId))
        .collect()
      const latestSequence = events.reduce((max, event) => Math.max(max, event._creationTime), 0)
      readSequence = Math.min(requestedReadSequence ?? Number.MAX_SAFE_INTEGER, latestSequence)
    }
    const patch = {
      ...(args.notificationLevel ? { notificationLevel: args.notificationLevel } : {}),
      ...(args.archived !== undefined ? { archivedAt: args.archived ? now : undefined } : {}),
      ...(args.markRead ? { lastReadAt: now, lastReadSequence: readSequence ?? 0, markedUnreadAt: undefined } : {}),
      ...(readSequence !== undefined && !args.markRead ? { lastReadSequence: readSequence } : {}),
      ...(args.markUnread ? { markedUnreadAt: now } : {}),
      updatedAt: now,
    }
    await ctx.db.patch(participant._id, patch)
    return await participantView(ctx, { ...participant, ...patch })
  },
})

export const archiveConversationForEveryone = mutation({
  args: {
    actorUserId: v.string(),
    archived: v.boolean(),
    conversationId: v.id('conversations'),
    workspaceId: v.string(),
    serverSecret: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const actor = await requireWorkspaceOwner(ctx, args)
    const access = await requireConversationAccess(ctx, args)
    const now = Date.now()
    const participants = await ctx.db.query('conversationParticipants')
      .withIndex('by_conversationId_status', (q) => (
        q.eq('conversationId', args.conversationId).eq('status', 'active')
      ))
      .collect()
    for (const participant of participants) {
      await ctx.db.patch(participant._id, {
        archivedAt: args.archived ? now : undefined,
        updatedAt: now,
      })
    }
    await recordConversationEvent(ctx, {
      conversationId: args.conversationId,
      workspaceId: args.workspaceId,
      userId: args.actorUserId,
      type: 'conversation.updated',
      payload: { archived: args.archived, scope: 'everyone' },
    })
    const current = participants.find((participant) => participant.principalId === actor.principalId)
      ?? access.participant
    if (!current) throw new Error('CONVERSATION_ACCESS_DENIED')
    return await participantView(ctx, {
      ...current,
      archivedAt: args.archived ? now : undefined,
      updatedAt: now,
    })
  },
})

export const deleteConversationForEveryone = mutation({
  args: {
    actorUserId: v.string(),
    conversationId: v.id('conversations'),
    workspaceId: v.string(),
    serverSecret: v.optional(v.string()),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    await requireWorkspaceOwner(ctx, args)
    const access = await requireConversationAccess(ctx, args)
    if (access.conversation.deletedAt) return false
    const now = Date.now()
    await ctx.db.patch(args.conversationId, {
      deletedAt: now,
      lastModified: now,
      updatedAt: now,
    })
    await recordConversationEvent(ctx, {
      conversationId: args.conversationId,
      workspaceId: args.workspaceId,
      userId: args.actorUserId,
      type: 'conversation.deleted',
      payload: { scope: 'everyone' },
    })
    return true
  },
})

export const upsertPresence = mutation({
  args: {
    actorUserId: v.string(),
    conversationId: v.optional(v.id('conversations')),
    sessionId: v.optional(v.string()),
    status: v.union(v.literal('online'), v.literal('away'), v.literal('offline')),
    typing: v.optional(v.boolean()),
    workspaceId: v.string(),
    serverSecret: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, args)
    if (args.conversationId) await requireConversationAccess(ctx, { ...args, conversationId: args.conversationId })
    const sessionId = args.sessionId?.trim() || 'legacy'
    const existingRows = await ctx.db.query('workspacePresence')
      .withIndex('by_workspaceId_principalId', (q) => (
        q.eq('workspaceId', args.workspaceId).eq('principalId', actor.principalId)
      )).collect()
    const existing = existingRows.find((row) => (row.sessionId ?? 'legacy') === sessionId)
    const now = Date.now()
    const value = {
      workspaceId: args.workspaceId,
      principalId: actor.principalId,
      sessionId,
      conversationId: args.conversationId,
      status: args.status,
      lastSeenAt: now,
      typingExpiresAt: args.typing && args.conversationId ? now + 6_000 : undefined,
      updatedAt: now,
    }
    if (existing) await ctx.db.patch(existing._id, value)
    else await ctx.db.insert('workspacePresence', value)
    return {
      ...value,
      typing: Boolean(value.typingExpiresAt && value.typingExpiresAt > now),
    }
  },
})

export const listPresence = query({
  args: {
    actorUserId: v.string(),
    conversationId: v.id('conversations'),
    workspaceId: v.string(),
    serverSecret: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireConversationAccess(ctx, args)
    return await computePresence(ctx, args.conversationId, args.workspaceId)
  },
})

/**
 * Live subscription for conversation presence.
 * Uses accessToken auth so the browser can subscribe via useQuery
 * and get realtime presence/typing updates without HTTP polling.
 */
export const watchPresence = query({
  args: {
    accessToken: v.string(),
    actorUserId: v.string(),
    conversationId: v.id('conversations'),
    workspaceId: v.string(),
  },
  returns: v.union(
    v.object({ ok: v.literal(false), presence: v.array(v.any()) }),
    v.object({ ok: v.literal(true), presence: v.array(v.any()) }),
  ),
  handler: async (ctx, args) => {
    try {
      const presence = await computePresence(ctx, args.conversationId, args.workspaceId, args)
      return { ok: true as const, presence }
    } catch (error) {
      if (error instanceof Error && ['Unauthorized', 'WORKSPACE_ACCESS_DENIED'].includes(error.message)) {
        return { ok: false as const, presence: [] }
      }
      throw error
    }
  },
})

async function computePresence(
  ctx: CollaborationCtx,
  conversationId: Id<'conversations'>,
  workspaceId: string,
  authArgs?: { accessToken?: string; actorUserId?: string; serverSecret?: string },
) {
  if (authArgs) {
    await requireConversationAccess(ctx, {
      conversationId,
      workspaceId,
      actorUserId: authArgs.actorUserId ?? '',
      accessToken: authArgs.accessToken,
      serverSecret: authArgs.serverSecret,
    })
  }
  const participants = await ctx.db.query('conversationParticipants')
    .withIndex('by_conversationId_status', (q) => (
      q.eq('conversationId', conversationId).eq('status', 'active')
    )).collect()
  const now = Date.now()
  const sessionsByPrincipal = new Map<string, Array<Doc<'workspacePresence'>>>()
  for (const participant of participants) {
    const presenceRows = await ctx.db.query('workspacePresence')
      .withIndex('by_workspaceId_principalId', (q) => (
        q.eq('workspaceId', workspaceId).eq('principalId', participant.principalId)
      )).collect()
    const sessions = presenceRows
      .filter((row) => !row.conversationId || row.conversationId === conversationId)
    if (sessions.length > 0) sessionsByPrincipal.set(participant.principalId, sessions)
  }
  return [...sessionsByPrincipal.values()].map((sessions) => {
    const active = sessions
      .filter((session) => now - session.lastSeenAt <= 120_000)
      .filter((session) => session.status !== 'offline')
      .sort((left, right) => right.updatedAt - left.updatedAt)
    const latest = [...sessions].sort((left, right) => right.updatedAt - left.updatedAt)[0]!
    const representative = active[0] ?? latest
    const status = active.some((session) => session.status === 'online')
      ? 'online' as const
      : active.length > 0 ? 'away' as const : 'offline' as const
    const typing = active.some((session) => Boolean(
      session.typingExpiresAt && session.typingExpiresAt > now,
    ))
    return {
      workspaceId: representative.workspaceId,
      principalId: representative.principalId,
      sessionId: representative.sessionId,
      conversationId: representative.conversationId,
      status,
      typing,
      lastSeenAt: representative.lastSeenAt,
      typingExpiresAt: typing ? representative.typingExpiresAt : undefined,
    }
  })
}

export const recordMessageActivity = mutation({
  args: {
    actorUserId: v.string(),
    body: v.optional(v.string()),
    conversationId: v.id('conversations'),
    mentionedPrincipalIds: v.optional(v.array(v.string())),
    messageId: v.id('conversationMessages'),
    threadRootMessageId: v.optional(v.id('conversationMessages')),
    workspaceId: v.string(),
    serverSecret: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const access = await requireConversationAccess(ctx, args)
    const now = Date.now()
    const mentions = new Set(args.mentionedPrincipalIds ?? [])
    const conversation = await ctx.db.get(args.conversationId)
    const hasChannelMention = conversation?.conversationType === 'channel' && /(^|\s)@channel(?=\s|$)/i.test(args.body ?? '')
    const hasHereMention = conversation?.conversationType === 'channel' && /(^|\s)@here(?=\s|$)/i.test(args.body ?? '')
    const activeHere = new Set<string>()
    if (hasHereMention) {
      const presence = await ctx.db.query('workspacePresence')
        .withIndex('by_workspaceId_principalId_updatedAt', (q) => q.eq('workspaceId', args.workspaceId))
        .collect()
      for (const row of presence) {
        if (row.status === 'online' && now - row.lastSeenAt <= 120_000) activeHere.add(row.principalId)
      }
    }
    const followers = args.threadRootMessageId
      ? await ctx.db.query('conversationThreadFollows')
        .withIndex('by_conversationId_threadRootMessageId_principalId', (q) => (
          q.eq('conversationId', args.conversationId).eq('threadRootMessageId', args.threadRootMessageId!)
        )).collect()
      : []
    const followerIds = new Set(followers.map((row) => row.principalId))
    const messageEvents = await ctx.db.query('conversationEvents')
      .withIndex('by_conversationId_createdAt', (q) => q.eq('conversationId', args.conversationId))
      .collect()
    const eventSequence = messageEvents.find((event) => event.messageId === args.messageId && event.type === 'message.created')?._creationTime ?? Date.now()
    const participants = await ctx.db.query('conversationParticipants')
      .withIndex('by_conversationId_status', (q) => (
        q.eq('conversationId', args.conversationId).eq('status', 'active')
      )).collect()
    for (const participant of participants) {
      const mentioned = mentions.has(participant.principalId)
      if (participant.principalId === access.actor.principalId) continue
      const broadcast = hasChannelMention || (hasHereMention && activeHere.has(participant.principalId))
      const followedThread = Boolean(args.threadRootMessageId && followerIds.has(participant.principalId))
      const preferences = await ctx.db.query('workspaceNotificationPreferences')
        .withIndex('by_workspaceId_principalId', (q) => q.eq('workspaceId', args.workspaceId).eq('principalId', participant.principalId))
        .unique()
      if (mentioned || broadcast) {
        if (preferences?.mentions === 'off') continue
      } else if (followedThread) {
        if (preferences?.threadReplies === 'off' || participant.notificationLevel === 'muted') continue
      } else {
        if (participant.notificationLevel === 'muted' || participant.notificationLevel === 'mentions') continue
        const mode = conversation?.conversationType === 'dm' ? preferences?.dmMessages : preferences?.channelMessages
        if (mode === 'off') continue
      }
      const type = mentioned || broadcast ? 'mention' as const : followedThread ? 'thread' as const : 'message' as const
      const mentionScope = mentioned ? 'direct' as const : hasChannelMention ? 'channel' as const : hasHereMention ? 'here' as const : undefined
      await ctx.db.insert('workspaceNotifications', {
        notificationId: crypto.randomUUID(),
        workspaceId: args.workspaceId,
        recipientPrincipalId: participant.principalId,
        type,
        conversationId: args.conversationId,
        messageId: args.messageId,
        actorPrincipalId: access.actor.principalId,
        threadRootMessageId: args.threadRootMessageId,
        eventSequence,
        mentionScope,
        title: mentioned
          ? `${access.actor.displayName} mentioned you`
          : type === 'thread'
            ? `${access.actor.displayName} replied in a thread`
            : `New message from ${access.actor.displayName}`,
        body: args.body?.slice(0, 240),
        createdAt: now,
      })
    }
  },
})

async function accessibleConversationIdsForEvents(
  ctx: CollaborationCtx,
  args: { actorUserId: string; workspaceId: string; serverSecret?: string },
): Promise<Set<Id<'conversations'>>> {
  const actor = await requireActor(ctx, args)
  const participantRows = await ctx.db.query('conversationParticipants')
    .withIndex('by_workspaceId_principalId_status', (q) => (
      q.eq('workspaceId', args.workspaceId).eq('principalId', actor.principalId).eq('status', 'active')
    )).take(500)
  const ids = new Set<Id<'conversations'>>(participantRows.map((row) => row.conversationId))
  const owned = await ctx.db.query('conversations')
    .withIndex('by_workspaceId_conversationType_lastModified', (q) => q.eq('workspaceId', args.workspaceId))
    .take(500)
  for (const conversation of owned) {
    if (conversation.userId === args.actorUserId && (conversation.conversationType ?? 'personal') === 'personal') {
      ids.add(conversation._id)
    }
  }
  return ids
}

export const getConversationEventCursor = query({
  args: {
    actorUserId: v.string(),
    workspaceId: v.optional(v.string()),
    serverSecret: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    if (!args.workspaceId) return 0
    const accessible = await accessibleConversationIdsForEvents(ctx, {
      actorUserId: args.actorUserId,
      workspaceId: args.workspaceId,
      serverSecret: args.serverSecret,
    })
    const events = await ctx.db.query('conversationEvents')
      .withIndex('by_workspaceId', (q) => q.eq('workspaceId', args.workspaceId))
      .order('desc')
      .take(500)
    return events
      .filter((event) => accessible.has(event.conversationId))
      .reduce((max, event) => Math.max(max, event._creationTime), 0)
  },
})

export const listConversationEvents = query({
  args: {
    actorUserId: v.string(),
    afterSequence: v.number(),
    limit: v.number(),
    workspaceId: v.optional(v.string()),
    serverSecret: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    if (!args.workspaceId) return []
    const accessible = await accessibleConversationIdsForEvents(ctx, {
      actorUserId: args.actorUserId,
      workspaceId: args.workspaceId,
      serverSecret: args.serverSecret,
    })
    const events = await ctx.db.query('conversationEvents')
      .withIndex('by_workspaceId', (q) => (
        q.eq('workspaceId', args.workspaceId).gt('_creationTime', args.afterSequence)
      ))
      .order('asc')
      .take(Math.max(1, Math.min(200, Math.floor(args.limit))))
    return events
      .filter((event) => accessible.has(event.conversationId) && event._creationTime > args.afterSequence)
      .sort((left, right) => left._creationTime - right._creationTime)
      .map((event) => ({
        sequence: event._creationTime,
        conversationId: event.conversationId,
        type: event.type,
        messageId: event.messageId,
        payload: event.payload as Record<string, unknown> | undefined,
        createdAt: event.createdAt,
      }))
  },
})

/**
 * A lightweight browser-facing invalidation signal for the conversation list.
 * It intentionally returns no event metadata: any active workspace member may
 * observe that the workspace changed, but private conversation identifiers stay
 * behind the normal list/access checks.
 */
export const watchConversationListVersion = query({
  args: {
    accessToken: v.string(),
    actorUserId: v.string(),
    workspaceId: v.string(),
  },
  returns: v.union(
    v.object({ ok: v.literal(false), version: v.number() }),
    v.object({ ok: v.literal(true), version: v.number() }),
  ),
  handler: async (ctx, args) => {
    try {
      await requireActor(ctx, args)
    } catch (error) {
      if (error instanceof Error && ['Unauthorized', 'WORKSPACE_ACCESS_DENIED'].includes(error.message)) {
        return { ok: false as const, version: 0 }
      }
      throw error
    }
    const latest = await ctx.db.query('conversationEvents')
      .withIndex('by_workspaceId', (q) => q.eq('workspaceId', args.workspaceId))
      .order('desc')
      .first()
    return { ok: true as const, version: latest?._creationTime ?? 0 }
  },
})

export const editMessage = mutation({
  args: {
    actorUserId: v.string(),
    content: v.string(),
    conversationId: v.id('conversations'),
    messageId: v.id('conversationMessages'),
    workspaceId: v.string(),
    serverSecret: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const access = await requireConversationAccess(ctx, args)
    const message = await ctx.db.get(args.messageId)
    const content = args.content.trim()
    if (!content) throw new Error('Message content is required')
    if (
      !message
      || message.conversationId !== args.conversationId
      || message.authorKind !== 'human'
      || message.authorPrincipalId !== access.actor.principalId
      || message.deletedAt
    ) return false
    const now = Date.now()
    await ctx.db.patch(message._id, {
      content,
      editedAt: now,
      editHistory: [
        ...(message.editHistory ?? []),
        { content: message.content, editedAt: now },
      ],
      updatedAt: now,
    })
    return true
  },
})

export const deleteMessage = mutation({
  args: {
    actorUserId: v.string(),
    conversationId: v.id('conversations'),
    messageId: v.id('conversationMessages'),
    workspaceId: v.string(),
    serverSecret: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const access = await requireConversationAccess(ctx, args)
    const message = await ctx.db.get(args.messageId)
    if (
      !message
      || message.conversationId !== args.conversationId
      || message.authorKind !== 'human'
      || message.authorPrincipalId !== access.actor.principalId
      || message.deletedAt
    ) return false
    const now = Date.now()
    await ctx.db.patch(message._id, { content: '', parts: [], deletedAt: now, updatedAt: now })
    return true
  },
})

async function listNotificationRows(
  ctx: QueryCtx,
  args: {
    actorUserId: string
    filter?: 'all' | 'unread' | 'mentions' | 'threads' | 'reactions'
    limit?: number
    unreadOnly?: boolean
    workspaceId: string
    accessToken?: string
    serverSecret?: string
  },
) {
  const actor = await requireActor(ctx, args)
  const rows = await ctx.db.query('workspaceNotifications')
    .withIndex('by_workspaceId_recipientPrincipalId_createdAt', (q) => (
      q.eq('workspaceId', args.workspaceId).eq('recipientPrincipalId', actor.principalId)
    )).order('desc').take(Math.max(1, Math.min(100, args.limit ?? 50)))
  const notifications = rows.filter((row) => {
    if ((args.unreadOnly || args.filter === 'unread') && row.readAt) return false
    if (args.filter === 'mentions' && row.type !== 'mention') return false
    if (args.filter === 'threads' && row.type !== 'thread') return false
    if (args.filter === 'reactions' && row.type !== 'reaction') return false
    return true
  })
  const conversationIds = [...new Set(notifications.map((row) => row.conversationId))]
  const conversationStateById = new Map<string, 'archived' | 'deleted'>()
  await Promise.all(conversationIds.map(async (conversationId) => {
    const conversation = await ctx.db.get(conversationId)
    const participant = await ctx.db.query('conversationParticipants')
      .withIndex('by_conversationId_principalId', (q) => (
        q.eq('conversationId', conversationId).eq('principalId', actor.principalId)
      )).unique()
    const state = resolveConversationActivityState({
      archivedAt: participant?.archivedAt,
      conversation: conversation ? { deletedAt: conversation.deletedAt } : null,
    })
    if (state) conversationStateById.set(String(conversationId), state)
  }))
  return notifications.map((row) => ({
    id: row.notificationId,
    workspaceId: row.workspaceId,
    recipientPrincipalId: row.recipientPrincipalId,
    type: row.type,
    conversationId: row.conversationId,
    messageId: row.messageId,
    actorPrincipalId: row.actorPrincipalId,
    threadRootMessageId: row.threadRootMessageId,
    eventSequence: row.eventSequence,
    mentionScope: row.mentionScope,
    title: row.title,
    body: row.body,
    createdAt: row.createdAt,
    readAt: row.readAt,
    conversationState: conversationStateById.get(String(row.conversationId)),
  }))
}

export const listNotifications = query({
  args: {
    actorUserId: v.string(),
    filter: v.optional(notificationFilterValidator),
    limit: v.optional(v.number()),
    unreadOnly: v.optional(v.boolean()),
    workspaceId: v.string(),
    serverSecret: v.optional(v.string()),
  },
  returns: v.array(notificationValidator),
  handler: listNotificationRows,
})

export const watchNotifications = query({
  args: {
    accessToken: v.string(),
    actorUserId: v.string(),
    filter: v.optional(notificationFilterValidator),
    limit: v.optional(v.number()),
    unreadOnly: v.optional(v.boolean()),
    workspaceId: v.string(),
  },
  returns: v.union(
    v.object({ ok: v.literal(false), notifications: v.array(notificationValidator) }),
    v.object({ ok: v.literal(true), notifications: v.array(notificationValidator) }),
  ),
  handler: async (ctx, args) => {
    try {
      return { ok: true as const, notifications: await listNotificationRows(ctx, args) }
    } catch (error) {
      if (error instanceof Error && ['Unauthorized', 'WORKSPACE_ACCESS_DENIED'].includes(error.message)) {
        return { ok: false as const, notifications: [] }
      }
      throw error
    }
  },
})

export const setThreadFollow = mutation({
  args: {
    actorUserId: v.string(),
    conversationId: v.id('conversations'),
    threadRootMessageId: v.id('conversationMessages'),
    followed: v.boolean(),
    workspaceId: v.string(),
    serverSecret: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const access = await requireConversationAccess(ctx, args)
    await getMessageForThread(ctx, args.conversationId, args.threadRootMessageId)
    const existing = await ctx.db.query('conversationThreadFollows')
      .withIndex('by_conversationId_threadRootMessageId_principalId', (q) => (
        q.eq('conversationId', args.conversationId)
          .eq('threadRootMessageId', args.threadRootMessageId)
          .eq('principalId', access.actor.principalId)
      )).unique()
    if (args.followed && !existing) {
      await ctx.db.insert('conversationThreadFollows', {
        workspaceId: args.workspaceId,
        conversationId: args.conversationId,
        threadRootMessageId: args.threadRootMessageId,
        principalId: access.actor.principalId,
        followedAt: Date.now(),
      })
      return true
    }
    if (!args.followed && existing) {
      await ctx.db.delete(existing._id)
      return true
    }
    return false
  },
})

export const listThreadFollows = query({
  args: {
    actorUserId: v.string(),
    conversationId: v.id('conversations'),
    threadRootMessageId: v.optional(v.id('conversationMessages')),
    workspaceId: v.string(),
    serverSecret: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const access = await requireConversationAccess(ctx, args)
    const rows = await ctx.db.query('conversationThreadFollows')
      .withIndex('by_conversationId_threadRootMessageId_principalId', (q) => {
        const scoped = q.eq('conversationId', args.conversationId)
        return args.threadRootMessageId ? scoped.eq('threadRootMessageId', args.threadRootMessageId) : scoped
      }).collect()
    return rows
      .filter((row) => args.threadRootMessageId || row.principalId === access.actor.principalId)
      .map((row) => ({
        conversationId: row.conversationId,
        threadRootMessageId: row.threadRootMessageId,
        principalId: row.principalId,
        followedAt: row.followedAt,
      }))
  },
})

const defaultNotificationPreferences = {
  dmMessages: 'activity' as const,
  mentions: 'banner' as const,
  threadReplies: 'activity' as const,
  reactions: 'activity' as const,
  channelMessages: 'activity' as const,
}

export const getNotificationPreferences = query({
  args: { actorUserId: v.string(), workspaceId: v.string(), serverSecret: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const access = await requireActor(ctx, args)
    const row = await ctx.db.query('workspaceNotificationPreferences')
      .withIndex('by_workspaceId_principalId', (q) => q.eq('workspaceId', args.workspaceId).eq('principalId', access.principalId))
      .unique()
    return row ? {
      dmMessages: row.dmMessages,
      mentions: row.mentions,
      threadReplies: row.threadReplies,
      reactions: row.reactions,
      channelMessages: row.channelMessages,
    } : defaultNotificationPreferences
  },
})

export const updateNotificationPreferences = mutation({
  args: {
    actorUserId: v.string(), workspaceId: v.string(), serverSecret: v.optional(v.string()),
    dmMessages: v.optional(v.union(v.literal('activity'), v.literal('banner'), v.literal('off'))),
    mentions: v.optional(v.union(v.literal('activity'), v.literal('banner'), v.literal('off'))),
    threadReplies: v.optional(v.union(v.literal('activity'), v.literal('banner'), v.literal('off'))),
    reactions: v.optional(v.union(v.literal('activity'), v.literal('banner'), v.literal('off'))),
    channelMessages: v.optional(v.union(v.literal('activity'), v.literal('banner'), v.literal('off'))),
  },
  handler: async (ctx, args) => {
    const access = await requireActor(ctx, args)
    const existing = await ctx.db.query('workspaceNotificationPreferences')
      .withIndex('by_workspaceId_principalId', (q) => q.eq('workspaceId', args.workspaceId).eq('principalId', access.principalId))
      .unique()
    const next = {
      dmMessages: args.dmMessages ?? existing?.dmMessages ?? defaultNotificationPreferences.dmMessages,
      mentions: args.mentions ?? existing?.mentions ?? defaultNotificationPreferences.mentions,
      threadReplies: args.threadReplies ?? existing?.threadReplies ?? defaultNotificationPreferences.threadReplies,
      reactions: args.reactions ?? existing?.reactions ?? defaultNotificationPreferences.reactions,
      channelMessages: args.channelMessages ?? existing?.channelMessages ?? defaultNotificationPreferences.channelMessages,
    }
    if (existing) {
      await ctx.db.patch(existing._id, { ...next, updatedAt: Date.now() })
    } else {
      await ctx.db.insert('workspaceNotificationPreferences', {
        workspaceId: args.workspaceId,
        principalId: access.principalId,
        ...next,
        updatedAt: Date.now(),
      })
    }
    return next
  },
})

export const markNotificationsRead = mutation({
  args: {
    actorUserId: v.string(),
    conversationId: v.optional(v.id('conversations')),
    notificationIds: v.optional(v.array(v.string())),
    workspaceId: v.string(),
    serverSecret: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, args)
    const ids = args.notificationIds ? new Set(args.notificationIds) : null
    const rows = await ctx.db.query('workspaceNotifications')
      .withIndex('by_workspaceId_recipientPrincipalId_createdAt', (q) => (
        q.eq('workspaceId', args.workspaceId).eq('recipientPrincipalId', actor.principalId)
      )).collect()
    let updated = 0
    for (const row of rows) {
      if (
        row.readAt
        || (ids && !ids.has(row.notificationId))
        || (args.conversationId && row.conversationId !== args.conversationId)
      ) continue
      await ctx.db.patch(row._id, { readAt: Date.now() })
      updated++
    }
    return updated
  },
})
