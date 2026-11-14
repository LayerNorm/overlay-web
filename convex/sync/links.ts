import { v } from 'convex/values'
import { internal } from '../_generated/api'
import { internalMutation, mutation, query } from '../_generated/server'
import type { MutationCtx, QueryCtx } from '../_generated/server'
import type { Doc, Id } from '../_generated/dataModel'
import { DEFAULT_MODEL_ID } from '../../src/shared/ai/gateway/model-types'
import { SYNC_HISTORY_WINDOW_MS } from '../../src/shared/sync/types'
import { validateServerSecret } from '../lib/auth'
import { requireNativeWorkspace } from '../lib/nativeViewer'
import { recordConversationEvent } from '../collaboration/events'
import { findUniqueSlug, slugifyChannel } from '../imports/slackImporter'
import { channelKindValidator, providerValidator } from './validators'

type Provider = 'slack' | 'teams'

const linkStatusValidator = v.union(v.literal('syncing'), v.literal('history'), v.literal('catching_up'), v.literal('paused'))

async function requireManager(ctx: Pick<QueryCtx, 'db'>, args: { serverSecret: string; actorUserId: string; workspaceId: string }) {
  if (!validateServerSecret(args.serverSecret)) throw new Error('Unauthorized')
  const principal = await ctx.db.query('workspacePrincipals')
    .withIndex('by_workspaceId_userId', q => q.eq('workspaceId', args.workspaceId).eq('userId', args.actorUserId))
    .unique()
  if (!principal || principal.type !== 'human' || principal.archivedAt) throw new Error('WORKSPACE_ACCESS_DENIED')
  const membership = await ctx.db.query('workspaceMemberships')
    .withIndex('by_workspaceId_principalId', q => q.eq('workspaceId', args.workspaceId).eq('principalId', principal.principalId))
    .unique()
  if (!membership || membership.status !== 'active') throw new Error('WORKSPACE_ACCESS_DENIED')
  if (membership.role !== 'owner' && membership.role !== 'admin') throw new Error('SYNC_MANAGE_DENIED')
  return { principalId: principal.principalId }
}

async function connectionFor(ctx: Pick<QueryCtx, 'db'>, workspaceId: string, provider: Provider) {
  return await ctx.db.query('syncConnections')
    .withIndex('by_workspaceId_provider', q => q.eq('workspaceId', workspaceId).eq('provider', provider))
    .unique()
}

/** Records (or re-activates) the workspace's Slack workspace or Microsoft tenant after its install succeeds. */
export const connect = mutation({
  args: {
    serverSecret: v.string(), actorUserId: v.string(), workspaceId: v.string(),
    provider: providerValidator, externalOrgId: v.string(), externalOrgName: v.optional(v.string()),
  },
  returns: v.id('syncConnections'),
  handler: async (ctx, args) => {
    await requireManager(ctx, args)
    const claimed = await ctx.db.query('syncConnections')
      .withIndex('by_provider_externalOrgId', q => q.eq('provider', args.provider).eq('externalOrgId', args.externalOrgId))
      .collect()
    if (claimed.some(row => row.workspaceId !== args.workspaceId && row.status !== 'disconnected')) {
      throw new Error('SYNC_ORG_CONNECTED_ELSEWHERE')
    }
    const now = Date.now()
    const existing = await connectionFor(ctx, args.workspaceId, args.provider)
    if (existing && existing.externalOrgId !== args.externalOrgId && existing.status !== 'disconnected') {
      throw new Error('SYNC_ALREADY_CONNECTED')
    }
    if (existing) {
      await ctx.db.patch(existing._id, {
        externalOrgId: args.externalOrgId,
        ...(args.externalOrgName ? { externalOrgName: args.externalOrgName } : {}),
        status: 'connected', connectedByUserId: args.actorUserId, connectedAt: now, updatedAt: now,
      })
      for (const link of await ctx.db.query('syncChannelLinks').withIndex('by_connectionId', q => q.eq('connectionId', existing._id)).collect()) {
        if (link.status === 'paused' && link.pauseReason === 'disconnected') {
          await ctx.db.patch(link._id, { status: link.historyCompletedAt ? 'syncing' : 'history', pauseReason: undefined, updatedAt: now })
        }
      }
      return existing._id
    }
    return await ctx.db.insert('syncConnections', {
      workspaceId: args.workspaceId, provider: args.provider, externalOrgId: args.externalOrgId,
      ...(args.externalOrgName ? { externalOrgName: args.externalOrgName } : {}),
      status: 'connected', autoLink: false, connectedByUserId: args.actorUserId, connectedAt: now, updatedAt: now,
    })
  },
})

/** Stops every link. Synced messages and channels stay; reconnecting the same org resumes them. */
export const disconnect = mutation({
  args: { serverSecret: v.string(), actorUserId: v.string(), workspaceId: v.string(), provider: providerValidator },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireManager(ctx, args)
    const connection = await connectionFor(ctx, args.workspaceId, args.provider)
    if (!connection) return null
    const now = Date.now()
    await ctx.db.patch(connection._id, { status: 'disconnected', updatedAt: now })
    for (const link of await ctx.db.query('syncChannelLinks').withIndex('by_connectionId', q => q.eq('connectionId', connection._id)).collect()) {
      await ctx.db.patch(link._id, { status: 'paused', pauseReason: 'disconnected', updatedAt: now })
    }
    return null
  },
})

export const setAutoLink = mutation({
  args: { serverSecret: v.string(), actorUserId: v.string(), workspaceId: v.string(), provider: providerValidator, enabled: v.boolean() },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireManager(ctx, args)
    const connection = await connectionFor(ctx, args.workspaceId, args.provider)
    if (!connection) throw new Error('SYNC_NOT_CONNECTED')
    await ctx.db.patch(connection._id, { autoLink: args.enabled, updatedAt: Date.now() })
    return null
  },
})

async function createLinkedChannel(
  ctx: MutationCtx,
  args: { workspaceId: string; actorUserId: string; principalId: string; name: string; isPrivate: boolean; seed: string; provider: Provider },
) {
  const base = slugifyChannel(args.name) || 'channel'
  const slug = await findUniqueSlug(ctx, args.workspaceId, base, slugifyChannel(args.seed.slice(-6)), undefined)
  const now = Date.now()
  const conversationId = await ctx.db.insert('conversations', {
    userId: args.actorUserId,
    workspaceId: args.workspaceId,
    conversationType: 'channel',
    createdByPrincipalId: args.principalId,
    clientId: 'sync:' + args.provider + ':' + args.seed,
    title: slug,
    lastModified: now,
    updatedAt: now,
    createdAt: now,
    lastMode: 'act',
    askModelIds: [DEFAULT_MODEL_ID],
    actModelId: DEFAULT_MODEL_ID,
    channelSlug: slug,
    channelVisibility: args.isPrivate ? 'private' : 'public',
    isAutomation: false,
  })
  await ctx.db.insert('conversationParticipants', {
    conversationId, workspaceId: args.workspaceId, principalId: args.principalId, principalType: 'human',
    role: 'moderator', status: 'active', notificationLevel: 'all', joinedAt: now, updatedAt: now,
  })
  await recordConversationEvent(ctx, {
    conversationId, workspaceId: args.workspaceId, userId: args.actorUserId,
    type: 'conversation.created', payload: { conversationType: 'channel', source: args.provider },
  })
  return conversationId
}

/**
 * Links one Slack or Teams channel to a new or existing Overlay channel. New
 * links start importing history; live messages sync from the first event.
 * Private and shared external channels only map to private Overlay channels.
 */
export const linkChannel = mutation({
  args: {
    serverSecret: v.string(), actorUserId: v.string(), workspaceId: v.string(), provider: providerValidator,
    externalChannelId: v.string(), externalGroupId: v.optional(v.string()), externalChannelName: v.string(),
    externalChannelKind: channelKindValidator,
    existingConversationId: v.optional(v.id('conversations')),
  },
  returns: v.object({ linkId: v.id('syncChannelLinks'), conversationId: v.id('conversations') }),
  handler: async (ctx, args) => {
    const actor = await requireManager(ctx, args)
    const connection = await connectionFor(ctx, args.workspaceId, args.provider)
    if (!connection || connection.status !== 'connected') throw new Error('SYNC_NOT_CONNECTED')
    const taken = await ctx.db.query('syncChannelLinks')
      .withIndex('by_provider_externalOrgId_externalChannelId', q => q
        .eq('provider', args.provider).eq('externalOrgId', connection.externalOrgId).eq('externalChannelId', args.externalChannelId))
      .unique()
    if (taken) throw new Error('SYNC_CHANNEL_ALREADY_LINKED')
    const mustBePrivate = args.externalChannelKind !== 'public' || args.provider === 'teams'
    let conversationId: Id<'conversations'>
    if (args.existingConversationId) {
      const existing = await ctx.db.get(args.existingConversationId)
      if (!existing || existing.deletedAt || existing.workspaceId !== args.workspaceId || existing.conversationType !== 'channel' || existing.externalPlatform) {
        throw new Error('SYNC_TARGET_INVALID')
      }
      if (mustBePrivate && existing.channelVisibility !== 'private') throw new Error('SYNC_TARGET_MUST_BE_PRIVATE')
      const linked = await ctx.db.query('syncChannelLinks').withIndex('by_conversationId', q => q.eq('conversationId', existing._id)).unique()
      if (linked) throw new Error('SYNC_TARGET_ALREADY_LINKED')
      const participant = await ctx.db.query('conversationParticipants')
        .withIndex('by_conversationId_principalId', q => q.eq('conversationId', existing._id).eq('principalId', actor.principalId))
        .first()
      if (!participant || participant.status !== 'active') throw new Error('SYNC_TARGET_INVALID')
      conversationId = existing._id
    } else {
      conversationId = await createLinkedChannel(ctx, {
        workspaceId: args.workspaceId, actorUserId: args.actorUserId, principalId: actor.principalId,
        name: args.externalChannelName, isPrivate: mustBePrivate, seed: args.externalChannelId, provider: args.provider,
      })
    }
    const now = Date.now()
    const linkId = await ctx.db.insert('syncChannelLinks', {
      workspaceId: args.workspaceId, provider: args.provider, connectionId: connection._id, externalOrgId: connection.externalOrgId,
      externalChannelId: args.externalChannelId,
      ...(args.externalGroupId ? { externalGroupId: args.externalGroupId } : {}),
      externalChannelName: args.externalChannelName, externalChannelKind: args.externalChannelKind,
      conversationId, status: 'history', historyTargetAt: now - SYNC_HISTORY_WINDOW_MS,
      linkedByUserId: args.actorUserId, createdAt: now, updatedAt: now,
    })
    return { linkId, conversationId }
  },
})

/** Stops syncing one channel. The Overlay channel, its members and its messages stay. */
export const unlinkChannel = mutation({
  args: { serverSecret: v.string(), actorUserId: v.string(), workspaceId: v.string(), linkId: v.id('syncChannelLinks') },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireManager(ctx, args)
    const link = await ctx.db.get(args.linkId)
    if (!link || link.workspaceId !== args.workspaceId) return null
    await ctx.db.delete(link._id)
    await ctx.scheduler.runAfter(0, internal.sync.links.purgeMessageMap, { linkId: link._id })
    return null
  },
})

/** Drops an unlinked channel's message map in pages, so relinking later starts clean. */
export const purgeMessageMap = internalMutation({
  args: { linkId: v.id('syncChannelLinks') },
  returns: v.null(),
  handler: async (ctx, args) => {
    const rows = await ctx.db.query('syncMessageMap').withIndex('by_linkId', q => q.eq('linkId', args.linkId)).take(500)
    for (const row of rows) await ctx.db.delete(row._id)
    if (rows.length === 500) await ctx.scheduler.runAfter(0, internal.sync.links.purgeMessageMap, args)
    return null
  },
})

/** Adapter-side state changes: history progress, rate-limit catch-up, pauses and Graph subscriptions. */
export const updateLinkState = mutation({
  args: {
    serverSecret: v.string(),
    linkId: v.id('syncChannelLinks'),
    status: v.optional(linkStatusValidator),
    pauseReason: v.optional(v.union(v.string(), v.null())),
    historyOldestAt: v.optional(v.number()),
    historyCursor: v.optional(v.union(v.string(), v.null())),
    historyCompletedAt: v.optional(v.number()),
    catchUpUntil: v.optional(v.union(v.number(), v.null())),
    subscriptionId: v.optional(v.union(v.string(), v.null())),
    subscriptionExpiresAt: v.optional(v.union(v.number(), v.null())),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    if (!validateServerSecret(args.serverSecret)) throw new Error('Unauthorized')
    const link = await ctx.db.get(args.linkId)
    if (!link) return null
    const patch: Record<string, unknown> = { updatedAt: Date.now() }
    for (const [key, value] of Object.entries(args)) {
      if (key === 'serverSecret' || key === 'linkId' || value === undefined) continue
      patch[key] = value === null ? undefined : value
    }
    await ctx.db.patch(link._id, patch as Partial<Doc<'syncChannelLinks'>>)
    return null
  },
})

function linkView(link: Doc<'syncChannelLinks'>) {
  return {
    linkId: link._id,
    workspaceId: link.workspaceId,
    provider: link.provider,
    externalOrgId: link.externalOrgId,
    externalChannelId: link.externalChannelId,
    ...(link.externalGroupId ? { externalGroupId: link.externalGroupId } : {}),
    externalChannelName: link.externalChannelName,
    externalChannelKind: link.externalChannelKind,
    conversationId: link.conversationId,
    status: link.status,
    ...(link.pauseReason ? { pauseReason: link.pauseReason } : {}),
    ...(link.historyTargetAt !== undefined ? { historyTargetAt: link.historyTargetAt } : {}),
    ...(link.historyOldestAt !== undefined ? { historyOldestAt: link.historyOldestAt } : {}),
    ...(link.historyCursor ? { historyCursor: link.historyCursor } : {}),
    ...(link.historyCompletedAt !== undefined ? { historyCompletedAt: link.historyCompletedAt } : {}),
    ...(link.catchUpUntil !== undefined ? { catchUpUntil: link.catchUpUntil } : {}),
    ...(link.subscriptionId ? { subscriptionId: link.subscriptionId } : {}),
    ...(link.subscriptionExpiresAt !== undefined ? { subscriptionExpiresAt: link.subscriptionExpiresAt } : {}),
    ...(link.lastEventAt !== undefined ? { lastEventAt: link.lastEventAt } : {}),
    createdAt: link.createdAt,
  }
}

export type SyncLinkView = ReturnType<typeof linkView>

/** The link for a platform channel, for adapters routing a live event or a history page. */
export const getLinkByChannel = query({
  args: { serverSecret: v.string(), provider: providerValidator, externalOrgId: v.string(), externalChannelId: v.string() },
  handler: async (ctx, args) => {
    if (!validateServerSecret(args.serverSecret)) throw new Error('Unauthorized')
    const link = await ctx.db.query('syncChannelLinks')
      .withIndex('by_provider_externalOrgId_externalChannelId', q => q
        .eq('provider', args.provider).eq('externalOrgId', args.externalOrgId).eq('externalChannelId', args.externalChannelId))
      .unique()
    return link ? linkView(link) : null
  },
})

export const getLinkByConversation = query({
  args: { serverSecret: v.string(), conversationId: v.id('conversations') },
  handler: async (ctx, args) => {
    if (!validateServerSecret(args.serverSecret)) throw new Error('Unauthorized')
    const link = await ctx.db.query('syncChannelLinks').withIndex('by_conversationId', q => q.eq('conversationId', args.conversationId)).unique()
    return link ? linkView(link) : null
  },
})

/** Links in a given state, oldest update first, for the history and repair workers. */
export const listLinksByStatus = query({
  args: { serverSecret: v.string(), status: linkStatusValidator, limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    if (!validateServerSecret(args.serverSecret)) throw new Error('Unauthorized')
    const rows = await ctx.db.query('syncChannelLinks')
      .withIndex('by_status_updatedAt', q => q.eq('status', args.status))
      .take(Math.min(args.limit ?? 50, 200))
    return rows.map(linkView)
  },
})

export const getConnection = query({
  args: { serverSecret: v.string(), workspaceId: v.string(), provider: providerValidator },
  handler: async (ctx, args) => {
    if (!validateServerSecret(args.serverSecret)) throw new Error('Unauthorized')
    const connection = await connectionFor(ctx, args.workspaceId, args.provider)
    if (!connection) return null
    return {
      connectionId: connection._id,
      workspaceId: connection.workspaceId,
      provider: connection.provider,
      externalOrgId: connection.externalOrgId,
      ...(connection.externalOrgName ? { externalOrgName: connection.externalOrgName } : {}),
      status: connection.status,
      autoLink: connection.autoLink,
    }
  },
})

/**
 * The Import & sync settings view, live: each provider's connection, its links and
 * whether the viewer has connected their own account. Tokens never leave Convex.
 */
export const status = query({
  args: { workspaceId: v.string() },
  handler: async (ctx, { workspaceId }) => {
    let viewer
    try {
      viewer = await requireNativeWorkspace(ctx, workspaceId)
    } catch {
      return null
    }
    const canManage = viewer.membership.role === 'owner' || viewer.membership.role === 'admin'
    const providers = await Promise.all((['slack', 'teams'] as const).map(async provider => {
      const connection = await connectionFor(ctx, workspaceId, provider)
      const connectedBy = connection
        ? await ctx.db.query('workspacePrincipals')
          .withIndex('by_workspaceId_userId', q => q.eq('workspaceId', workspaceId).eq('userId', connection.connectedByUserId))
          .unique()
        : null
      const linkRows = await ctx.db.query('syncChannelLinks')
        .withIndex('by_workspaceId_provider', q => q.eq('workspaceId', workspaceId).eq('provider', provider))
        .collect()
      const account = await ctx.db.query('syncMemberAccounts')
        .withIndex('by_workspaceId_userId_provider', q => q.eq('workspaceId', workspaceId).eq('userId', viewer.userId).eq('provider', provider))
        .unique()
      const links = await Promise.all(linkRows.map(async link => {
        const conversation = await ctx.db.get(link.conversationId)
        return {
          ...linkView(link),
          overlayChannelName: conversation?.channelSlug ?? conversation?.title ?? '',
          overlayChannelVisibility: conversation?.channelVisibility ?? 'private',
        }
      }))
      return {
        provider,
        connection: connection
          ? {
              externalOrgName: connection.externalOrgName ?? connection.externalOrgId,
              status: connection.status,
              autoLink: connection.autoLink,
              connectedAt: connection.connectedAt,
              connectedByName: connectedBy?.displayName ?? null,
            }
          : null,
        account: account && account.status === 'active'
          ? { externalDisplayName: account.externalDisplayName ?? null, dmSyncEnabled: account.dmSyncEnabled }
          : null,
        links: links.sort((a, b) => a.createdAt - b.createdAt),
      }
    }))
    return { canManage, providers }
  },
})
