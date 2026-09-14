import { v } from 'convex/values'
import { mutation, query } from '../_generated/server'
import { requireServerSecret } from '../lib/auth'
import { recordConversationEvent } from '../collaboration/events'

// Server-only surface: the BFF reaches these through ConvexSurfaceRepository
// with the internal server secret. Authorization lives in SurfaceService.

const platform = v.union(v.literal('slack'))
const connectionStatus = v.union(
  v.literal('active'),
  v.literal('degraded'),
  v.literal('uninstalled'),
)
const bindingStatus = v.union(v.literal('active'), v.literal('removed'))

export const upsertConnection = mutation({
  args: {
    id: v.string(),
    serverSecret: v.string(),
    workspaceId: v.string(),
    platform,
    externalTeamId: v.string(),
    externalTeamName: v.optional(v.string()),
    externalEnterpriseId: v.optional(v.string()),
    botUserId: v.optional(v.string()),
    status: connectionStatus,
    installedByUserId: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
  },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const existing = await ctx.db
      .query('surfaceConnections')
      .withIndex('by_platform_team', (q) => q
        .eq('platform', args.platform)
        .eq('externalTeamId', args.externalTeamId))
      .unique()
    // Mutations are transactional, so check-then-insert is atomic. A reinstall
    // refreshes install metadata but never moves the connection to another
    // Overlay workspace — SurfaceService rejects that case before calling.
    if (existing) {
      await ctx.db.patch(existing._id, {
        externalTeamName: args.externalTeamName,
        externalEnterpriseId: args.externalEnterpriseId,
        botUserId: args.botUserId,
        status: args.status,
        updatedAt: args.updatedAt,
      })
      return existing.id
    }
    await ctx.db.insert('surfaceConnections', {
      id: args.id,
      workspaceId: args.workspaceId,
      platform: args.platform,
      externalTeamId: args.externalTeamId,
      externalTeamName: args.externalTeamName,
      externalEnterpriseId: args.externalEnterpriseId,
      botUserId: args.botUserId,
      status: args.status,
      installedByUserId: args.installedByUserId,
      createdAt: args.createdAt,
      updatedAt: args.updatedAt,
    })
    return args.id
  },
})

export const getConnection = query({
  args: { id: v.string(), serverSecret: v.string() },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    return await ctx.db
      .query('surfaceConnections')
      .withIndex('by_entityId', (q) => q.eq('id', args.id))
      .unique()
  },
})

export const findConnectionByTeam = query({
  args: { platform, externalTeamId: v.string(), serverSecret: v.string() },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    return await ctx.db
      .query('surfaceConnections')
      .withIndex('by_platform_team', (q) => q
        .eq('platform', args.platform)
        .eq('externalTeamId', args.externalTeamId))
      .unique()
  },
})

export const listConnections = query({
  args: { workspaceId: v.string(), serverSecret: v.string() },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    return await ctx.db
      .query('surfaceConnections')
      .withIndex('by_workspaceId', (q) => q.eq('workspaceId', args.workspaceId))
      .collect()
  },
})

export const updateConnection = mutation({
  args: {
    id: v.string(),
    serverSecret: v.string(),
    externalTeamName: v.optional(v.string()),
    externalEnterpriseId: v.optional(v.string()),
    botUserId: v.optional(v.string()),
    status: v.optional(connectionStatus),
    updatedAt: v.number(),
  },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const existing = await ctx.db
      .query('surfaceConnections')
      .withIndex('by_entityId', (q) => q.eq('id', args.id))
      .unique()
    if (!existing) return null
    await ctx.db.patch(existing._id, {
      ...(args.externalTeamName !== undefined ? { externalTeamName: args.externalTeamName } : {}),
      ...(args.externalEnterpriseId !== undefined ? { externalEnterpriseId: args.externalEnterpriseId } : {}),
      ...(args.botUserId !== undefined ? { botUserId: args.botUserId } : {}),
      ...(args.status !== undefined ? { status: args.status } : {}),
      updatedAt: args.updatedAt,
    })
    return existing.id
  },
})

export const createBinding = mutation({
  args: {
    id: v.string(),
    serverSecret: v.string(),
    connectionId: v.string(),
    agentId: v.string(),
    channelId: v.string(),
    channelName: v.optional(v.string()),
    status: bindingStatus,
    createdByUserId: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
  },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const existing = await ctx.db
      .query('surfaceBindings')
      .withIndex('by_connectionId_channelId', (q) => q
        .eq('connectionId', args.connectionId)
        .eq('channelId', args.channelId))
      .unique()
    // One agent per channel. A re-bind to a removed row reactivates it instead
    // of creating a duplicate channel key.
    if (existing) {
      if (existing.status === 'removed') {
        await ctx.db.patch(existing._id, {
          agentId: args.agentId,
          channelName: args.channelName,
          status: args.status,
          createdByUserId: args.createdByUserId,
          updatedAt: args.updatedAt,
        })
      }
      return existing.id
    }
    await ctx.db.insert('surfaceBindings', {
      id: args.id,
      connectionId: args.connectionId,
      agentId: args.agentId,
      channelId: args.channelId,
      channelName: args.channelName,
      status: args.status,
      createdByUserId: args.createdByUserId,
      createdAt: args.createdAt,
      updatedAt: args.updatedAt,
    })
    return args.id
  },
})

export const getBinding = query({
  args: { id: v.string(), serverSecret: v.string() },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    return await ctx.db
      .query('surfaceBindings')
      .withIndex('by_entityId', (q) => q.eq('id', args.id))
      .unique()
  },
})

export const findBindingByChannel = query({
  args: { connectionId: v.string(), channelId: v.string(), serverSecret: v.string() },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    return await ctx.db
      .query('surfaceBindings')
      .withIndex('by_connectionId_channelId', (q) => q
        .eq('connectionId', args.connectionId)
        .eq('channelId', args.channelId))
      .unique()
  },
})

export const listBindingsByAgent = query({
  args: { agentId: v.string(), serverSecret: v.string() },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    return await ctx.db
      .query('surfaceBindings')
      .withIndex('by_agentId', (q) => q.eq('agentId', args.agentId))
      .collect()
  },
})

export const listBindingsByConnection = query({
  args: { connectionId: v.string(), serverSecret: v.string() },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    return await ctx.db
      .query('surfaceBindings')
      .withIndex('by_connectionId', (q) => q.eq('connectionId', args.connectionId))
      .collect()
  },
})

/**
 * Atomic find-or-create for a surface thread's Overlay conversation — a
 * mutation so the check-then-insert can't race. A deleted conversation stays
 * deleted; a fresh live row is created for the thread instead.
 */
export const ensureSurfaceConversation = mutation({
  args: {
    serverSecret: v.string(),
    userId: v.string(),
    workspaceId: v.optional(v.string()),
    title: v.string(),
    projectId: v.optional(v.string()),
    askModelIds: v.array(v.string()),
    actModelId: v.string(),
    lastMode: v.optional(v.union(v.literal('ask'), v.literal('act'))),
    conversationType: v.optional(v.union(
      v.literal('personal'),
      v.literal('dm'),
      v.literal('channel'),
    )),
    createdByPrincipalId: v.optional(v.string()),
    externalPlatform: v.string(),
    externalChannelId: v.string(),
    externalThreadId: v.string(),
    surfaceBindingId: v.string(),
  },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const existing = await ctx.db
      .query('conversations')
      .withIndex('by_surfaceBindingId_externalThreadId', (q) => q
        .eq('surfaceBindingId', args.surfaceBindingId)
        .eq('externalThreadId', args.externalThreadId))
      .collect()
    const live = existing.find((row) => !row.deletedAt)
    if (live) return live._id
    const now = Date.now()
    const conversationId = await ctx.db.insert('conversations', {
      userId: args.userId,
      workspaceId: args.workspaceId,
      title: args.title,
      projectId: args.projectId,
      lastModified: now,
      createdAt: now,
      updatedAt: now,
      lastMode: args.lastMode ?? 'act',
      askModelIds: args.askModelIds,
      actModelId: args.actModelId,
      conversationType: args.conversationType,
      createdByPrincipalId: args.createdByPrincipalId,
      isAutomation: false,
      externalPlatform: args.externalPlatform,
      externalChannelId: args.externalChannelId,
      externalThreadId: args.externalThreadId,
      surfaceBindingId: args.surfaceBindingId,
    })
    await recordConversationEvent(ctx, {
      conversationId,
      workspaceId: args.workspaceId,
      userId: args.userId,
      type: 'conversation.created',
    })
    return conversationId
  },
})

export const updateBinding = mutation({
  args: {
    id: v.string(),
    serverSecret: v.string(),
    agentId: v.optional(v.string()),
    channelName: v.optional(v.string()),
    status: v.optional(bindingStatus),
    createdByUserId: v.optional(v.string()),
    updatedAt: v.number(),
  },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const existing = await ctx.db
      .query('surfaceBindings')
      .withIndex('by_entityId', (q) => q.eq('id', args.id))
      .unique()
    if (!existing) return null
    await ctx.db.patch(existing._id, {
      ...(args.agentId !== undefined ? { agentId: args.agentId } : {}),
      ...(args.channelName !== undefined ? { channelName: args.channelName } : {}),
      ...(args.status !== undefined ? { status: args.status } : {}),
      ...(args.createdByUserId !== undefined ? { createdByUserId: args.createdByUserId } : {}),
      updatedAt: args.updatedAt,
    })
    return existing.id
  },
})
