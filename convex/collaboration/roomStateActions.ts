import { insertRoomParticipant, activateRoomParticipant } from './participantRecency'
import type { Doc, Id } from '../_generated/dataModel'
import type { MutationCtx, QueryCtx } from '../_generated/server'
import { recordConversationEvent } from './events'
import { participantViewById } from './roomParticipants'

type Access = { actor: Pick<Doc<'workspacePrincipals'>, 'principalId' | 'displayName'>; conversation: Doc<'conversations'>; participant?: Doc<'conversationParticipants'> | null }
type Args = { actorUserId: string; workspaceId: string; conversationId: Id<'conversations'> }
export async function relatedRows<T>(query: { take(n: number): Promise<T[]>; collect(): Promise<T[]> }, native: boolean) {
  const rows = native ? await query.take(201) : await query.collect()
  if (native && rows.length > 200) throw new Error('ROOM_RELATED_LIMIT_EXCEEDED')
  return rows
}
export async function requireStateMessage(ctx: Pick<QueryCtx, 'db'>, conversationId: Id<'conversations'>, messageId: Id<'conversationMessages'>) {
  const message = await ctx.db.get(messageId)
  if (!message || message.conversationId !== conversationId || message.deletedAt) throw new Error('Message not found')
  return message
}

export function groupReactions(
  rows: Array<{
    conversationId: Id<'conversations'>
    messageId: Id<'conversationMessages'>
    emoji: string
    principalId: string
  }>,
  currentPrincipalId: string,
) {
  const grouped = new Map<string, {
    conversationId: Id<'conversations'>
    messageId: Id<'conversationMessages'>
    emoji: string
    principalIds: string[]
    count: number
    reactedByCurrentPrincipal: boolean
  }>()
  for (const row of rows) {
    const key = `${row.messageId}:${row.emoji}`
    const value = grouped.get(key) ?? {
      conversationId: row.conversationId, messageId: row.messageId, emoji: row.emoji,
      principalIds: [], count: 0, reactedByCurrentPrincipal: false,
    }
    value.principalIds.push(row.principalId)
    value.count += 1
    value.reactedByCurrentPrincipal ||= row.principalId === currentPrincipalId
    grouped.set(key, value)
  }
  return [...grouped.values()]
}

export async function setReactionForActor(ctx: MutationCtx, args: Args & { messageId: Id<'conversationMessages'>; emoji: string; enabled: boolean }, access: Access, native = false) {
    const { actor } = access
    await requireStateMessage(ctx, args.conversationId, args.messageId)
    const emoji = args.emoji.trim()
    if (!emoji || emoji.length > 32) throw new Error('A valid reaction is required')
    const existing = await ctx.db.query('conversationMessageReactions')
      .withIndex('by_messageId_principalId_emoji', (q) => (
        q.eq('messageId', args.messageId).eq('principalId', actor.principalId).eq('emoji', emoji)
      )).unique()
    const reactionChanged = args.enabled ? !existing : Boolean(existing)
    if (args.enabled && !existing) {
      await ctx.db.insert('conversationMessageReactions', {
        conversationId: args.conversationId, messageId: args.messageId, workspaceId: args.workspaceId,
        principalId: actor.principalId, emoji, createdAt: Date.now(),
      })
    } else if (!args.enabled && existing) await ctx.db.delete(existing._id)
    if (args.enabled && reactionChanged) {
      const message = await ctx.db.get(args.messageId)
      if (message?.authorPrincipalId && message.authorPrincipalId !== actor.principalId) {
        const preferences = await ctx.db.query('workspaceNotificationPreferences')
          .withIndex('by_workspaceId_principalId', (q) => q.eq('workspaceId', args.workspaceId).eq('principalId', message.authorPrincipalId!))
          .unique()
        if (preferences?.reactions !== 'off') {
          await ctx.db.insert('workspaceNotifications', {
            notificationId: crypto.randomUUID(),
            workspaceId: args.workspaceId,
            recipientPrincipalId: message.authorPrincipalId,
            type: 'reaction',
            conversationId: args.conversationId,
            messageId: args.messageId,
            actorPrincipalId: actor.principalId,
            title: `${actor.displayName} reacted ${emoji}`,
            body: undefined,
            eventSequence: Date.now(),
            createdAt: Date.now(),
          })
        }
      }
    }
    if (reactionChanged) {
      await recordConversationEvent(ctx, {
        conversationId: args.conversationId,
        workspaceId: args.workspaceId,
        userId: args.actorUserId,
        type: 'reaction.changed',
        messageId: args.messageId,
        payload: { enabled: args.enabled, emoji },
      })
    }
    if (native) return []
    const rows = await ctx.db.query('conversationMessageReactions')
      .withIndex('by_conversationId_createdAt', (q) => q.eq('conversationId', args.conversationId))
      .collect()
    return groupReactions(rows, actor.principalId)
}

export async function setPinnedForActor(ctx: MutationCtx, args: Args & { messageId: Id<'conversationMessages'>; pinned: boolean }, access: Access) {
    const { actor } = access
    await requireStateMessage(ctx, args.conversationId, args.messageId)
    const existing = await ctx.db.query('conversationPins')
      .withIndex('by_conversationId_messageId', (q) => (
        q.eq('conversationId', args.conversationId).eq('messageId', args.messageId)
      )).unique()
    if (args.pinned && !existing) {
      await ctx.db.insert('conversationPins', {
        conversationId: args.conversationId, messageId: args.messageId, workspaceId: args.workspaceId,
        pinnedByPrincipalId: actor.principalId, createdAt: Date.now(),
      })
      await recordConversationEvent(ctx, {
        conversationId: args.conversationId,
        workspaceId: args.workspaceId,
        userId: args.actorUserId,
        type: 'pin.changed',
        messageId: args.messageId,
        payload: { pinned: true },
      })
      return true
    }
    if (!args.pinned && existing) {
      await ctx.db.delete(existing._id)
      await recordConversationEvent(ctx, {
        conversationId: args.conversationId,
        workspaceId: args.workspaceId,
        userId: args.actorUserId,
        type: 'pin.changed',
        messageId: args.messageId,
        payload: { pinned: false },
      })
      return true
    }
    return false
}

export async function setSavedForActor(ctx: MutationCtx, args: Args & { messageId: Id<'conversationMessages'>; saved: boolean }, access: Access) {
    const { actor } = access
    await requireStateMessage(ctx, args.conversationId, args.messageId)
    const existing = await ctx.db.query('conversationSavedMessages')
      .withIndex('by_messageId_principalId', (q) => (
        q.eq('messageId', args.messageId).eq('principalId', actor.principalId)
      )).unique()
    if (args.saved && !existing) {
      await ctx.db.insert('conversationSavedMessages', {
        conversationId: args.conversationId, messageId: args.messageId, workspaceId: args.workspaceId,
        principalId: actor.principalId, createdAt: Date.now(),
      })
      return true
    }
    if (!args.saved && existing) {
      await ctx.db.delete(existing._id)
      return true
    }
    return false
}

export async function addParticipantForActor(ctx: MutationCtx, args: Args & { principalId: string }, access: Access, native = false) {

    if (access.participant?.role !== 'moderator') throw new Error('CONVERSATION_MODERATOR_REQUIRED')
    if (access.conversation?.conversationType === 'dm') {
      throw new Error('DIRECT_MESSAGE_REQUIRES_NEW_GROUP')
    }
    const [principal, membership] = await Promise.all([
      ctx.db.query('workspacePrincipals')
      .withIndex('by_principalId', (q) => q.eq('principalId', args.principalId))
        .unique(),
      ctx.db.query('workspaceMemberships')
      .withIndex('by_workspaceId_principalId', (q) => (
        q.eq('workspaceId', args.workspaceId).eq('principalId', args.principalId)
        )).unique(),
    ])
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
    if (native) {
      const active = await relatedRows(ctx.db.query('conversationParticipants').withIndex('by_conversationId_status', q => q.eq('conversationId', args.conversationId).eq('status', 'active')), true)
      if (existing?.status !== 'active' && active.length >= 200) throw new Error('ROOM_RELATED_LIMIT_EXCEEDED')
    }
    const now = Date.now()
    let participant
    if (existing) {
      await activateRoomParticipant(ctx, existing._id, {
        status: 'active',
        removedAt: undefined,
        archivedAt: undefined,
        updatedAt: now,
        roomLastModified: access.conversation.lastModified,
      })
      participant = { ...existing, status: 'active' as const, removedAt: undefined, archivedAt: undefined, updatedAt: now }
    } else {
      const id = await insertRoomParticipant(ctx, {
        conversationId: args.conversationId,
        workspaceId: args.workspaceId,
        principalId: args.principalId,
        principalType: principal.type,
        role: 'member',
        status: 'active',
        notificationLevel: 'all',
        roomLastModified: access.conversation.lastModified,
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
    return await participantViewById(ctx, participant)
}

export async function removeParticipantForActor(ctx: MutationCtx, args: Args & { principalId: string }, access: Access, native = false) {

    if (access.actor.principalId !== args.principalId && access.participant?.role !== 'moderator') {
      throw new Error('CONVERSATION_MODERATOR_REQUIRED')
    }
    const activeQuery = ctx.db.query('conversationParticipants')
      .withIndex('by_conversationId_status', (q) => (
        q.eq('conversationId', args.conversationId).eq('status', 'active')
      ))
    const active = await relatedRows(activeQuery, native)
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
}

export async function archiveConversationForEveryoneForActor(ctx: MutationCtx, args: Args & { archived: boolean }, access: Access, native = false) {
    const actor = access.actor
    const now = Date.now()
    const participantsQuery = ctx.db.query('conversationParticipants')
      .withIndex('by_conversationId_status', (q) => (
        q.eq('conversationId', args.conversationId).eq('status', 'active')
      ))

    const participants = await relatedRows(participantsQuery, native)
    await Promise.all(participants.map((participant) => ctx.db.patch(participant._id, {
      archivedAt: args.archived ? now : undefined,
      updatedAt: now,
    })))
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
    return await participantViewById(ctx, {
      ...current,
      archivedAt: args.archived ? now : undefined,
      updatedAt: now,
    })
}

export async function setThreadFollowForActor(ctx: MutationCtx, args: Args & { threadRootMessageId: Id<'conversationMessages'>; followed: boolean }, access: Access) {

    await requireStateMessage(ctx, args.conversationId, args.threadRootMessageId)
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
}

export async function heartbeatForActor(ctx: MutationCtx, args: Omit<Args, 'conversationId'> & { conversationId?: Id<'conversations'>; sessionId?: string; status: 'online' | 'away' | 'offline'; typing?: boolean }, principalId: string, native = false) {

    const sessionId = args.sessionId?.trim() || 'legacy'
    const existingQuery = ctx.db.query('workspacePresence')
      .withIndex('by_workspaceId_principalId', (q) => (
        q.eq('workspaceId', args.workspaceId).eq('principalId', principalId)
      ))
    const existingRows = native ? await ctx.db.query('workspacePresence')
      .withIndex('by_workspaceId_principalId_updatedAt', q => q.eq('workspaceId', args.workspaceId).eq('principalId', principalId)).order('desc').take(200)
      : await existingQuery.collect()
    const existing = existingRows.find((row) => (row.sessionId ?? 'legacy') === sessionId)
    const now = Date.now()
    const value = {
      workspaceId: args.workspaceId,
      principalId: principalId,
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
}
