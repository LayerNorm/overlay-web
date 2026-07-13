import { v } from 'convex/values'
import { mutation, query } from '../_generated/server'
import { requireAccessToken, validateServerSecret } from '../lib/auth'
import type { Id } from '../_generated/dataModel'

async function authorizeUserAccess(params: {
  accessToken?: string
  serverSecret?: string
  userId: string
}) {
  if (validateServerSecret(params.serverSecret)) {
    return
  }
  await requireAccessToken(params.accessToken ?? '', params.userId)
}

export const list = query({
  args: {
    userId: v.string(),
    accessToken: v.optional(v.string()),
    serverSecret: v.optional(v.string()),
    projectId: v.optional(v.string()),
  },
  handler: async (ctx, { userId, accessToken, serverSecret, projectId }) => {
    try {
      await authorizeUserAccess({ userId, accessToken, serverSecret })
    } catch {
      return []
    }
    const all = await ctx.db
      .query('mcpServers')
      .withIndex('by_userId', (q) => q.eq('userId', userId))
      .order('desc')
      .collect()
    // Scrub authConfig from the response
    return all.filter((s) => projectId !== undefined ? s.projectId === projectId : !s.projectId).map((s) => ({
      _id: s._id,
      userId: s.userId,
      projectId: s.projectId,
      name: s.name,
      description: s.description,
      transport: s.transport,
      url: s.url,
      enabled: s.enabled,
      authType: s.authType,
      hasAuth: !!s.authConfig || !!s.encryptedAuthConfig,
      timeoutMs: s.timeoutMs,
      toolCatalogCount: s.toolCatalog?.length ?? 0,
      toolCatalogUpdatedAt: s.toolCatalogUpdatedAt,
      toolCatalogError: s.toolCatalogError,
      defaultToolPolicy: s.defaultToolPolicy ?? 'allow',
      toolPolicies: s.toolPolicies ?? {},
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
    }))
  },
})

export const listEnabled = query({
  args: {
    userId: v.string(),
    accessToken: v.optional(v.string()),
    serverSecret: v.optional(v.string()),
    projectId: v.optional(v.string()),
  },
  handler: async (ctx, { userId, accessToken, serverSecret, projectId }) => {
    try {
      await authorizeUserAccess({ userId, accessToken, serverSecret })
    } catch {
      return []
    }
    const all = await ctx.db
      .query('mcpServers')
      .withIndex('by_userId_enabled', (q) =>
        q.eq('userId', userId).eq('enabled', true)
      )
      .collect()
    return all.filter((server) => projectId !== undefined ? server.projectId === projectId : !server.projectId)
  },
})

export const get = query({
  args: {
    mcpServerId: v.id('mcpServers'),
    userId: v.string(),
    accessToken: v.optional(v.string()),
    serverSecret: v.optional(v.string()),
  },
  handler: async (ctx, { mcpServerId, userId, accessToken, serverSecret }) => {
    try {
      await authorizeUserAccess({ userId, accessToken, serverSecret })
    } catch {
      return null
    }
    const server = await ctx.db.get(mcpServerId)
    if (!server || server.userId !== userId) return null
    return server
  },
})

export const create = mutation({
  args: {
    userId: v.string(),
    accessToken: v.optional(v.string()),
    serverSecret: v.optional(v.string()),
    name: v.string(),
    projectId: v.optional(v.string()),
    description: v.optional(v.string()),
    transport: v.union(v.literal('sse'), v.literal('streamable-http')),
    url: v.string(),
    enabled: v.optional(v.boolean()),
    authType: v.optional(v.union(v.literal('none'), v.literal('bearer'), v.literal('header'))),
    authConfig: v.optional(
      v.object({
        bearerToken: v.optional(v.string()),
        headerName: v.optional(v.string()),
        headerValue: v.optional(v.string()),
      })
    ),
    encryptedAuthConfig: v.optional(v.string()),
    timeoutMs: v.optional(v.number()),
    defaultToolPolicy: v.optional(v.union(v.literal('allow'), v.literal('approval_required'), v.literal('deny'))),
    toolPolicies: v.optional(v.record(v.string(), v.union(v.literal('allow'), v.literal('approval_required'), v.literal('deny')))),
  },
  handler: async (ctx, args) => {
    await authorizeUserAccess(args)
    if (args.projectId) {
      const project = await ctx.db.get(args.projectId as Id<'projects'>)
      if (!project || project.userId !== args.userId || project.deletedAt) {
        throw new Error('Unauthorized')
      }
    }
    const now = Date.now()
    return await ctx.db.insert('mcpServers', {
      userId: args.userId,
      projectId: args.projectId,
      name: args.name,
      description: args.description,
      transport: args.transport,
      url: args.url,
      enabled: args.enabled ?? true,
      authType: args.authType ?? 'none',
      authConfig: args.authConfig,
      encryptedAuthConfig: args.encryptedAuthConfig,
      timeoutMs: args.timeoutMs,
      defaultToolPolicy: args.defaultToolPolicy ?? 'allow',
      toolPolicies: args.toolPolicies ?? {},
      createdAt: now,
      updatedAt: now,
    })
  },
})

export const update = mutation({
  args: {
    mcpServerId: v.id('mcpServers'),
    userId: v.string(),
    accessToken: v.optional(v.string()),
    serverSecret: v.optional(v.string()),
    name: v.optional(v.string()),
    description: v.optional(v.string()),
    transport: v.optional(v.union(v.literal('sse'), v.literal('streamable-http'))),
    url: v.optional(v.string()),
    enabled: v.optional(v.boolean()),
    authType: v.optional(v.union(v.literal('none'), v.literal('bearer'), v.literal('header'))),
    authConfig: v.optional(
      v.object({
        bearerToken: v.optional(v.string()),
        headerName: v.optional(v.string()),
        headerValue: v.optional(v.string()),
      })
    ),
    encryptedAuthConfig: v.optional(v.string()),
    clearAuthConfig: v.optional(v.boolean()),
    timeoutMs: v.optional(v.number()),
    defaultToolPolicy: v.optional(v.union(v.literal('allow'), v.literal('approval_required'), v.literal('deny'))),
    toolPolicies: v.optional(v.record(v.string(), v.union(v.literal('allow'), v.literal('approval_required'), v.literal('deny')))),
  },
  handler: async (ctx, { mcpServerId, userId, accessToken, serverSecret, ...updates }) => {
    await authorizeUserAccess({ userId, accessToken, serverSecret })
    const server = await ctx.db.get(mcpServerId)
    if (!server || server.userId !== userId) {
      throw new Error('Unauthorized')
    }
    const patch: Record<string, unknown> = { updatedAt: Date.now() }
    if (updates.name !== undefined) patch.name = updates.name
    if (updates.description !== undefined) patch.description = updates.description
    if (updates.transport !== undefined) patch.transport = updates.transport
    if (updates.url !== undefined) patch.url = updates.url
    if (updates.enabled !== undefined) patch.enabled = updates.enabled
    if (updates.authType !== undefined) patch.authType = updates.authType
    if (updates.clearAuthConfig) {
      patch.authConfig = undefined
      patch.encryptedAuthConfig = undefined
    } else {
      if (updates.authConfig !== undefined) patch.authConfig = updates.authConfig
      if (updates.encryptedAuthConfig !== undefined) {
        patch.authConfig = undefined
        patch.encryptedAuthConfig = updates.encryptedAuthConfig
      }
    }
    if (updates.timeoutMs !== undefined) patch.timeoutMs = updates.timeoutMs
    if (updates.defaultToolPolicy !== undefined) patch.defaultToolPolicy = updates.defaultToolPolicy
    if (updates.toolPolicies !== undefined) patch.toolPolicies = updates.toolPolicies
    await ctx.db.patch(mcpServerId, patch)
  },
})

export const remove = mutation({
  args: {
    mcpServerId: v.id('mcpServers'),
    userId: v.string(),
    accessToken: v.optional(v.string()),
    serverSecret: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, { mcpServerId, userId, accessToken, serverSecret }) => {
    await authorizeUserAccess({ userId, accessToken, serverSecret })
    const server = await ctx.db.get(mcpServerId)
    if (!server || server.userId !== userId) {
      throw new Error('Unauthorized')
    }
    const executions = await ctx.db
      .query('mcpToolExecutions')
      .withIndex('by_mcpServerId_createdAt', (q) => q.eq('mcpServerId', mcpServerId))
      .collect()
    for (const execution of executions) await ctx.db.delete(execution._id)
    await ctx.db.delete(mcpServerId)
    return null
  },
})

const toolPolicy = v.union(v.literal('allow'), v.literal('approval_required'), v.literal('deny'))

export const recordExecution = mutation({
  args: {
    userId: v.string(),
    serverSecret: v.optional(v.string()),
    mcpServerId: v.id('mcpServers'),
    projectId: v.optional(v.string()),
    toolName: v.string(),
    argumentsHash: v.string(),
    policyDecision: toolPolicy,
    status: v.union(v.literal('succeeded'), v.literal('failed'), v.literal('denied')),
    conversationId: v.optional(v.string()),
    turnId: v.optional(v.string()),
    modelId: v.optional(v.string()),
    durationMs: v.optional(v.number()),
    errorMessage: v.optional(v.string()),
    createdAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await authorizeUserAccess(args)
    const server = await ctx.db.get(args.mcpServerId)
    if (!server || server.userId !== args.userId) throw new Error('Unauthorized')
    return await ctx.db.insert('mcpToolExecutions', {
      userId: args.userId,
      projectId: args.projectId,
      mcpServerId: args.mcpServerId,
      toolName: args.toolName,
      argumentsHash: args.argumentsHash,
      policyDecision: args.policyDecision,
      status: args.status,
      conversationId: args.conversationId,
      turnId: args.turnId,
      modelId: args.modelId,
      durationMs: args.durationMs,
      errorMessage: args.errorMessage?.slice(0, 2_000),
      createdAt: args.createdAt ?? Date.now(),
    })
  },
})

export const listExecutions = query({
  args: {
    userId: v.string(),
    serverSecret: v.optional(v.string()),
    mcpServerId: v.optional(v.id('mcpServers')),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    try {
      await authorizeUserAccess(args)
    } catch {
      return []
    }
    const rows = args.mcpServerId
      ? await ctx.db.query('mcpToolExecutions')
        .withIndex('by_mcpServerId_createdAt', (q) => q.eq('mcpServerId', args.mcpServerId!))
        .order('desc')
        .take(Math.min(Math.max(args.limit ?? 50, 1), 200))
      : await ctx.db.query('mcpToolExecutions')
        .withIndex('by_userId_createdAt', (q) => q.eq('userId', args.userId))
        .order('desc')
        .take(Math.min(Math.max(args.limit ?? 50, 1), 200))
    return rows.filter((row) => row.userId === args.userId)
  },
})

const mcpToolCatalogEntry = v.object({
  name: v.string(),
  description: v.optional(v.string()),
  inputSchema: v.optional(v.any()),
})

export const updateToolCatalog = mutation({
  args: {
    mcpServerId: v.id('mcpServers'),
    userId: v.string(),
    accessToken: v.optional(v.string()),
    serverSecret: v.optional(v.string()),
    tools: v.array(mcpToolCatalogEntry),
    catalogError: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await authorizeUserAccess(args)
    const server = await ctx.db.get(args.mcpServerId)
    if (!server || server.userId !== args.userId) {
      throw new Error('Unauthorized')
    }
    await ctx.db.patch(args.mcpServerId, {
      toolCatalog: args.tools,
      toolCatalogUpdatedAt: Date.now(),
      toolCatalogError: args.catalogError,
      updatedAt: Date.now(),
    })
    return null
  },
})
