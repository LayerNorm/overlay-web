import type { Doc } from '../_generated/dataModel'
import type { MutationCtx } from '../_generated/server'
import { DEFAULT_MODEL_ID } from '@/shared/ai/gateway/model-types'
import { recordConversationEvent } from './events'

function slugify(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64)
}

export async function createChannelForActor(ctx: MutationCtx, args: {
  actorUserId: string; workspaceId: string; name: string; principalIds?: string[]
  topic?: string; visibility: 'public' | 'private'
}, actor: Doc<'workspacePrincipals'>, limit?: number) {
  const workspace = await ctx.db.query('workspaces')
    .withIndex('by_workspaceId', (q) => q.eq('workspaceId', args.workspaceId))
    .unique()
  if (!workspace || workspace.status !== 'active') {
    throw new Error('Workspace is not active')
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
    .take(limit === undefined ? 5_000 : limit + 1)
  if (limit !== undefined && principals.length > limit) throw new Error('ROOM_RELATED_LIMIT_EXCEEDED')
  const eligiblePrincipals = principals.filter((principal) =>
    !principal.archivedAt
    && (principal.type === 'human' || principal.type === 'agent')
    && (args.visibility !== 'private' || requested.has(principal.principalId)))
  const memberships = await Promise.all(eligiblePrincipals.map((principal) =>
    ctx.db.query('workspaceMemberships')
      .withIndex('by_workspaceId_principalId', (q) => (
        q.eq('workspaceId', args.workspaceId).eq('principalId', principal.principalId)
      )).unique()))
  const eligible = eligiblePrincipals.flatMap((principal, i) => {
    const membership = memberships[i]
    return membership?.status === 'active' ? [{ principal, membership }] : []
  })
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
  await Promise.all(eligible.map(({ principal, membership }) =>
    ctx.db.insert('conversationParticipants', {
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
    })))
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
}
