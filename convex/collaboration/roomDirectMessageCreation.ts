import { insertRoomParticipant } from './participantRecency'
import type { Doc, Id } from '../_generated/dataModel'
import type { MutationCtx } from '../_generated/server'
import { DEFAULT_MODEL_ID } from '@/shared/ai/gateway/model-types'
import { recordConversationEvent } from './events'
import { participantViews, resolvedPrincipalName } from './roomParticipants'

export async function createDirectMessageForActor(ctx: MutationCtx, args: {
  actorUserId: string; workspaceId: string; principalIds: string[]
  sourceConversationId?: Id<'conversations'>; title?: string
}, actor: Doc<'workspacePrincipals'>, limit?: number) {
  const principalIds = [...new Set([actor.principalId, ...args.principalIds.map((id) => id.trim()).filter(Boolean)])]
    .sort()
  if (principalIds.length < 2) throw new Error('A direct message requires at least two participants')
  const resolved = await Promise.all(principalIds.map(async (principalId) => {
    const [principal, membership] = await Promise.all([
      ctx.db.query('workspacePrincipals')
        .withIndex('by_principalId', (q) => q.eq('principalId', principalId))
        .unique(),
      ctx.db.query('workspaceMemberships')
        .withIndex('by_workspaceId_principalId', (q) => (
          q.eq('workspaceId', args.workspaceId).eq('principalId', principalId)
        ))
        .unique(),
    ])
    if (
      !principal
      || principal.workspaceId !== args.workspaceId
      || principal.archivedAt
      || (principal.type !== 'human' && principal.type !== 'agent')
      || membership?.status !== 'active'
    ) throw new Error('Every participant must be an active human or agent in this workspace')
    return principal
  }))
  const principals = resolved

  // A one-to-one DM whose counterpart is an agent principal is that
  // agent's main thread: it binds the conversation to the agent so it
  // nests under the agent in the sidebar instead of appearing in Chats.
  // Group DMs that merely include an agent stay ordinary conversations —
  // threads are per-user and must not hide the chat from other humans.
  const agentPrincipal = principals.find((principal) => principal.type === 'agent')
  const dmAgentId = principalIds.length === 2 ? agentPrincipal?.agentId : undefined

  const dmIdentityKey = principalIds.join(':')
  const existing = await ctx.db.query('conversations')
    .withIndex('by_workspaceId_dmIdentityKey', (q) => (
      q.eq('workspaceId', args.workspaceId).eq('dmIdentityKey', dmIdentityKey)
    ))
    .filter((q) => q.eq(q.field('deletedAt'), undefined))
    .first()
  if (existing) {
    if (dmAgentId && !existing.agentId && !existing.isAutomation) {
      await ctx.db.patch(existing._id, { agentId: dmAgentId, updatedAt: Date.now() })
    }
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
      participants: await participantViews(ctx, existing._id, limit),
      created: false,
      agentId: existing.agentId ?? dmAgentId,
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
  const otherNames = await Promise.all(principals
    .filter((principal) => principal.principalId !== actor.principalId)
    .map((principal) => resolvedPrincipalName(ctx, principal)))
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
    agentId: dmAgentId,
  })
  await Promise.all(principals.flatMap((principal) => {
    const writes = [insertRoomParticipant(ctx, {
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
    })] as Promise<unknown>[]
    if (principal.principalId !== actor.principalId) {
      writes.push(ctx.db.insert('workspaceNotifications', {
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
      }))
    }
    return writes
  }))
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
    participants: await participantViews(ctx, conversationId, limit),
    created: true,
    agentId: dmAgentId,
  }
}
