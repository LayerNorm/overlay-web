import { v } from 'convex/values'
import { DEFAULT_MODEL_ID } from '../../src/shared/ai/gateway/model-types'
import { mutation, query } from '../_generated/server'
import type { Doc, Id } from '../_generated/dataModel'
import type { MutationCtx, QueryCtx } from '../_generated/server'
import { validateServerSecret } from '../lib/auth'

type CollaborationCtx = Pick<QueryCtx, 'db'> | Pick<MutationCtx, 'db'>

async function requireActor(
  ctx: CollaborationCtx,
  args: { actorUserId: string; workspaceId: string; serverSecret?: string },
) {
  if (!validateServerSecret(args.serverSecret)) throw new Error('Unauthorized')
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

async function canAccess(
  ctx: CollaborationCtx,
  args: {
    actorUserId: string
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
    conversationId: Id<'conversations'>
    workspaceId: string
    serverSecret?: string
  },
) {
  const access = await canAccess(ctx, args)
  if (!access.allowed || !access.conversation) throw new Error('CONVERSATION_ACCESS_DENIED')
  return access
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
    if (active.length <= 1) throw new Error('A conversation must retain one participant')
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
    const participant = access.participant
    if (!participant) throw new Error('CONVERSATION_ACCESS_DENIED')
    const now = Date.now()
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
    const participants = await ctx.db.query('conversationParticipants')
      .withIndex('by_conversationId_status', (q) => (
        q.eq('conversationId', args.conversationId).eq('status', 'active')
      )).collect()
    const now = Date.now()
    const sessionsByPrincipal = new Map<string, Array<Doc<'workspacePresence'>>>()
    for (const participant of participants) {
      const presenceRows = await ctx.db.query('workspacePresence')
        .withIndex('by_workspaceId_principalId', (q) => (
          q.eq('workspaceId', args.workspaceId).eq('principalId', participant.principalId)
        )).collect()
      const sessions = presenceRows
        .filter((row) => !row.conversationId || row.conversationId === args.conversationId)
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
  },
})

export const recordMessageActivity = mutation({
  args: {
    actorUserId: v.string(),
    body: v.optional(v.string()),
    conversationId: v.id('conversations'),
    mentionedPrincipalIds: v.optional(v.array(v.string())),
    messageId: v.id('conversationMessages'),
    workspaceId: v.string(),
    serverSecret: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const access = await requireConversationAccess(ctx, args)
    const now = Date.now()
    const mentions = new Set(args.mentionedPrincipalIds ?? [])
    const participants = await ctx.db.query('conversationParticipants')
      .withIndex('by_conversationId_status', (q) => (
        q.eq('conversationId', args.conversationId).eq('status', 'active')
      )).collect()
    for (const participant of participants) {
      if (participant.principalId === access.actor.principalId || participant.notificationLevel === 'muted') continue
      const mentioned = mentions.has(participant.principalId)
      if (participant.notificationLevel === 'mentions' && !mentioned) continue
      await ctx.db.insert('workspaceNotifications', {
        notificationId: crypto.randomUUID(),
        workspaceId: args.workspaceId,
        recipientPrincipalId: participant.principalId,
        type: mentioned ? 'mention' : 'message',
        conversationId: args.conversationId,
        messageId: args.messageId,
        actorPrincipalId: access.actor.principalId,
        title: mentioned
          ? `${access.actor.displayName} mentioned you`
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
    )).collect()
  const ids = new Set<Id<'conversations'>>(participantRows.map((row) => row.conversationId))
  const owned = await ctx.db.query('conversations')
    .withIndex('by_workspaceId_conversationType_lastModified', (q) => q.eq('workspaceId', args.workspaceId))
    .collect()
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
    const events = await ctx.db.query('conversationEvents').collect()
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
    const events = await ctx.db.query('conversationEvents').collect()
    return events
      .filter((event) => accessible.has(event.conversationId) && event._creationTime > args.afterSequence)
      .sort((left, right) => left._creationTime - right._creationTime)
      .slice(0, Math.max(1, Math.min(200, Math.floor(args.limit))))
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
    await ctx.db.patch(message._id, { content, editedAt: now, updatedAt: now })
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

export const listNotifications = query({
  args: {
    actorUserId: v.string(),
    limit: v.optional(v.number()),
    unreadOnly: v.optional(v.boolean()),
    workspaceId: v.string(),
    serverSecret: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, args)
    const rows = await ctx.db.query('workspaceNotifications')
      .withIndex('by_workspaceId_recipientPrincipalId_createdAt', (q) => (
        q.eq('workspaceId', args.workspaceId).eq('recipientPrincipalId', actor.principalId)
      )).order('desc').take(Math.max(1, Math.min(100, args.limit ?? 50)))
    return rows.filter((row) => !args.unreadOnly || !row.readAt).map((row) => ({
      id: row.notificationId,
      workspaceId: row.workspaceId,
      recipientPrincipalId: row.recipientPrincipalId,
      type: row.type,
      conversationId: row.conversationId,
      messageId: row.messageId,
      actorPrincipalId: row.actorPrincipalId,
      title: row.title,
      body: row.body,
      createdAt: row.createdAt,
      readAt: row.readAt,
    }))
  },
})

export const markNotificationsRead = mutation({
  args: {
    actorUserId: v.string(),
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
      if (row.readAt || (ids && !ids.has(row.notificationId))) continue
      await ctx.db.patch(row._id, { readAt: Date.now() })
      updated++
    }
    return updated
  },
})
