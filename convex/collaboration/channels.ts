import { v } from 'convex/values'
import { DEFAULT_MODEL_ID } from '../../src/shared/ai/gateway/model-types'
import { mutation, query } from '../_generated/server'
import type { Id } from '../_generated/dataModel'
import type { MutationCtx, QueryCtx } from '../_generated/server'
import { validateServerSecret } from '../lib/auth'
import { recordConversationEvent } from './events'

type Ctx = Pick<QueryCtx, 'db'> | Pick<MutationCtx, 'db'>

async function requireActor(
  ctx: Ctx,
  args: { actorUserId: string; workspaceId: string; serverSecret?: string },
) {
  if (!validateServerSecret(args.serverSecret)) throw new Error('Unauthorized')
  const principal = await ctx.db.query('workspacePrincipals')
    .withIndex('by_workspaceId_userId', (q) => (
      q.eq('workspaceId', args.workspaceId).eq('userId', args.actorUserId)
    )).unique()
  if (!principal || principal.type !== 'human' || principal.archivedAt) {
    throw new Error('WORKSPACE_ACCESS_DENIED')
  }
  const membership = await ctx.db.query('workspaceMemberships')
    .withIndex('by_workspaceId_principalId', (q) => (
      q.eq('workspaceId', args.workspaceId).eq('principalId', principal.principalId)
    )).unique()
  if (!membership || membership.status !== 'active') throw new Error('WORKSPACE_ACCESS_DENIED')
  return { principal, membership }
}

async function requireAccess(
  ctx: Ctx,
  args: {
    actorUserId: string
    conversationId: Id<'conversations'>
    workspaceId: string
    serverSecret?: string
  },
) {
  const { principal } = await requireActor(ctx, args)
  const conversation = await ctx.db.get(args.conversationId)
  if (!conversation || conversation.deletedAt || conversation.workspaceId !== args.workspaceId) {
    throw new Error('CONVERSATION_ACCESS_DENIED')
  }
  if ((conversation.conversationType ?? 'personal') === 'personal') {
    if (conversation.userId !== args.actorUserId) throw new Error('CONVERSATION_ACCESS_DENIED')
    return { actor: principal, conversation }
  }
  const participant = await ctx.db.query('conversationParticipants')
    .withIndex('by_conversationId_principalId', (q) => (
      q.eq('conversationId', args.conversationId).eq('principalId', principal.principalId)
    )).unique()
  if (participant?.status !== 'active') throw new Error('CONVERSATION_ACCESS_DENIED')
  return { actor: principal, conversation, participant }
}

async function requireMessage(
  ctx: Ctx,
  conversationId: Id<'conversations'>,
  messageId: Id<'conversationMessages'>,
) {
  const message = await ctx.db.get(messageId)
  if (!message || message.conversationId !== conversationId || message.deletedAt) {
    throw new Error('Message not found')
  }
  return message
}

function slugify(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64)
}

export const createChannel = mutation({
  args: {
    actorUserId: v.string(),
    name: v.string(),
    principalIds: v.optional(v.array(v.string())),
    topic: v.optional(v.string()),
    visibility: v.union(v.literal('public'), v.literal('private')),
    workspaceId: v.string(),
    serverSecret: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { principal: actor } = await requireActor(ctx, args)
    const workspace = await ctx.db.query('workspaces')
      .withIndex('by_workspaceId', (q) => q.eq('workspaceId', args.workspaceId))
      .unique()
    if (!workspace || workspace.kind !== 'organization' || workspace.status !== 'active') {
      throw new Error('Channels require an organization workspace')
    }
    const name = args.name.trim().replace(/\s+/g, ' ').slice(0, 120)
    const slug = slugify(name)
    if (!name || !slug) throw new Error('Channel name is required')
    const existing = await ctx.db.query('conversations')
      .withIndex('by_workspaceId_channelSlug', (q) => (
        q.eq('workspaceId', args.workspaceId).eq('channelSlug', slug)
      )).filter((q) => q.eq(q.field('deletedAt'), undefined)).first()
    if (existing) throw new Error('A channel with this name already exists')

    const requested = new Set([actor.principalId, ...(args.principalIds ?? [])])
    const principals = await ctx.db.query('workspacePrincipals')
      .withIndex('by_workspaceId', (q) => q.eq('workspaceId', args.workspaceId))
      .take(5_000)
    const eligible = []
    for (const principal of principals) {
      if (principal.archivedAt || (principal.type !== 'human' && principal.type !== 'agent')) continue
      if (args.visibility === 'private' && !requested.has(principal.principalId)) continue
      const membership = await ctx.db.query('workspaceMemberships')
        .withIndex('by_workspaceId_principalId', (q) => (
          q.eq('workspaceId', args.workspaceId).eq('principalId', principal.principalId)
        )).unique()
      if (membership?.status === 'active') eligible.push({ principal, membership })
    }
    if (args.visibility === 'private' && eligible.length !== requested.size) {
      throw new Error('Every participant must be active in this workspace')
    }
    const now = Date.now()
    const conversationId = await ctx.db.insert('conversations', {
      userId: args.actorUserId,
      workspaceId: args.workspaceId,
      conversationType: 'channel',
      createdByPrincipalId: actor.principalId,
      title: name,
      lastModified: now,
      updatedAt: now,
      createdAt: now,
      lastMode: 'act',
      askModelIds: [DEFAULT_MODEL_ID],
      actModelId: DEFAULT_MODEL_ID,
      channelSlug: slug,
      channelVisibility: args.visibility,
      channelTopic: args.topic?.trim().replace(/\s+/g, ' ').slice(0, 240) || undefined,
    })
    for (const { principal, membership } of eligible) {
      await ctx.db.insert('conversationParticipants', {
        conversationId,
        workspaceId: args.workspaceId,
        principalId: principal.principalId,
        principalType: principal.type as 'human' | 'agent',
        role: principal.principalId === actor.principalId
          || membership.role === 'owner'
          || membership.role === 'admin' ? 'moderator' : 'member',
        status: 'active',
        notificationLevel: 'all',
        joinedAt: now,
        updatedAt: now,
        lastReadAt: principal.principalId === actor.principalId ? now : undefined,
      })
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
      payload: { conversationType: 'channel', slug, visibility: args.visibility },
    })
    return {
      conversationId,
      workspaceId: args.workspaceId,
      name,
      slug,
      topic: args.topic?.trim().replace(/\s+/g, ' ').slice(0, 240) || undefined,
      visibility: args.visibility,
      participantCount: eligible.length,
      createdAt: now,
      updatedAt: now,
    }
  },
})

export const listChannels = query({
  args: { actorUserId: v.string(), workspaceId: v.string(), serverSecret: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const { principal } = await requireActor(ctx, args)
    const participants = await ctx.db.query('conversationParticipants')
      .withIndex('by_workspaceId_principalId_status', (q) => (
        q.eq('workspaceId', args.workspaceId).eq('principalId', principal.principalId).eq('status', 'active')
      )).collect()
    const result = []
    for (const participant of participants) {
      const conversation = await ctx.db.get(participant.conversationId)
      if (!conversation || conversation.deletedAt || conversation.conversationType !== 'channel') continue
      const members = await ctx.db.query('conversationParticipants')
        .withIndex('by_conversationId_status', (q) => (
          q.eq('conversationId', conversation._id).eq('status', 'active')
        )).collect()
      result.push({
        conversationId: conversation._id,
        workspaceId: args.workspaceId,
        name: conversation.title,
        slug: conversation.channelSlug!,
        topic: conversation.channelTopic,
        visibility: conversation.channelVisibility!,
        participantCount: members.length,
        createdAt: conversation.createdAt,
        updatedAt: conversation.updatedAt ?? conversation.lastModified,
      })
    }
    return result.sort((a, b) => a.name.localeCompare(b.name))
  },
})

export const listReactions = query({
  args: {
    actorUserId: v.string(), conversationId: v.id('conversations'), workspaceId: v.string(),
    serverSecret: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { actor } = await requireAccess(ctx, args)
    const rows = await ctx.db.query('conversationMessageReactions')
      .withIndex('by_conversationId_createdAt', (q) => q.eq('conversationId', args.conversationId))
      .collect()
    return groupReactions(rows, actor.principalId)
  },
})

export const setReaction = mutation({
  args: {
    actorUserId: v.string(), conversationId: v.id('conversations'), emoji: v.string(),
    enabled: v.boolean(), messageId: v.id('conversationMessages'), workspaceId: v.string(),
    serverSecret: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { actor } = await requireAccess(ctx, args)
    await requireMessage(ctx, args.conversationId, args.messageId)
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
    const rows = await ctx.db.query('conversationMessageReactions')
      .withIndex('by_conversationId_createdAt', (q) => q.eq('conversationId', args.conversationId))
      .collect()
    return groupReactions(rows, actor.principalId)
  },
})

export const listPins = query({
  args: {
    actorUserId: v.string(), conversationId: v.id('conversations'), workspaceId: v.string(),
    serverSecret: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireAccess(ctx, args)
    const rows = await ctx.db.query('conversationPins')
      .withIndex('by_conversationId_createdAt', (q) => q.eq('conversationId', args.conversationId))
      .collect()
    return rows.sort((a, b) => b.createdAt - a.createdAt).map((row) => ({
      conversationId: row.conversationId,
      messageId: row.messageId,
      pinnedByPrincipalId: row.pinnedByPrincipalId,
      createdAt: row.createdAt,
    }))
  },
})

export const setPinned = mutation({
  args: {
    actorUserId: v.string(), conversationId: v.id('conversations'), messageId: v.id('conversationMessages'),
    pinned: v.boolean(), workspaceId: v.string(), serverSecret: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { actor } = await requireAccess(ctx, args)
    await requireMessage(ctx, args.conversationId, args.messageId)
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
  },
})

export const listSavedMessages = query({
  args: { actorUserId: v.string(), workspaceId: v.string(), serverSecret: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const { principal } = await requireActor(ctx, args)
    const rows = await ctx.db.query('conversationSavedMessages')
      .withIndex('by_workspaceId_principalId_createdAt', (q) => (
        q.eq('workspaceId', args.workspaceId).eq('principalId', principal.principalId)
      )).collect()
    return rows.sort((a, b) => b.createdAt - a.createdAt).map((row) => ({
      conversationId: row.conversationId, messageId: row.messageId,
      principalId: row.principalId, createdAt: row.createdAt,
    }))
  },
})

export const setSaved = mutation({
  args: {
    actorUserId: v.string(), conversationId: v.id('conversations'), messageId: v.id('conversationMessages'),
    saved: v.boolean(), workspaceId: v.string(), serverSecret: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { actor } = await requireAccess(ctx, args)
    await requireMessage(ctx, args.conversationId, args.messageId)
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
  },
})

export const searchWorkspaceChats = query({
  args: {
    actorUserId: v.string(), limit: v.optional(v.number()), query: v.string(), workspaceId: v.string(),
    serverSecret: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { principal } = await requireActor(ctx, args)
    const needle = args.query.trim().toLowerCase()
    if (!needle) return []
    const participants = await ctx.db.query('conversationParticipants')
      .withIndex('by_workspaceId_principalId_status', (q) => (
        q.eq('workspaceId', args.workspaceId).eq('principalId', principal.principalId).eq('status', 'active')
      )).collect()
    const personal = await ctx.db.query('conversations')
      .withIndex('by_workspaceId_conversationType_lastModified', (q) => (
        q.eq('workspaceId', args.workspaceId).eq('conversationType', 'personal')
      )).filter((q) => q.eq(q.field('userId'), args.actorUserId)).take(500)
    const ids = new Set<Id<'conversations'>>([
      ...participants.map((row) => row.conversationId),
      ...personal.map((row) => row._id),
    ])
    const results: Array<Record<string, unknown> & { createdAt: number }> = []
    for (const conversationId of ids) {
      const conversation = await ctx.db.get(conversationId)
      if (!conversation || conversation.deletedAt) continue
      if (conversation.title.toLowerCase().includes(needle)) {
        results.push({
          conversationId, conversationType: conversation.conversationType ?? 'personal',
          title: conversation.title, createdAt: conversation.createdAt,
        })
      }
      const messages = await ctx.db.query('conversationMessages')
        .withIndex('by_conversationId_createdAt', (q) => q.eq('conversationId', conversationId))
        .order('desc').take(200)
      for (const message of messages) {
        if (!message.deletedAt && message.content.toLowerCase().includes(needle)) {
          results.push({
            conversationId, conversationType: conversation.conversationType ?? 'personal',
            title: conversation.title, messageId: message._id,
            snippet: message.content.slice(0, 240), createdAt: message.createdAt,
          })
        }
      }
    }
    return results.sort((a, b) => b.createdAt - a.createdAt).slice(0, Math.max(1, Math.min(100, args.limit ?? 30)))
  },
})

function groupReactions(
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
