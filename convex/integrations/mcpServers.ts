import { v } from 'convex/values'
import { mutation, query } from '../_generated/server'
import { requireAccessToken, validateServerSecret } from '../lib/auth'
import type { Id } from '../_generated/dataModel'

/** Basic URL format validation at creation time. Full SSRF validation
 *  (DNS resolution, private IP blocking) runs at connection time in mcp-tools.ts. */
function validateMcpUrl(raw: string): void {
  const trimmed = raw.trim()
  if (!trimmed) throw new Error('URL is required')
  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    throw new Error('Invalid MCP server URL')
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error('MCP server URL must use HTTP or HTTPS')
  }
  // Reject obvious local/metadata endpoints — full DNS-based SSRF check runs at connection time
  const host = parsed.hostname.toLowerCase()
  if (host === 'localhost' || host === '127.0.0.1' || host === '0.0.0.0' || host === '::1' || host === '[::1]' ||
      host === '169.254.169.254' || host.endsWith('.localhost') || host.endsWith('.internal')) {
    throw new Error('Local and metadata hostnames are not allowed for MCP server URLs')
  }
}

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
    workspaceId: v.optional(v.string()),
    accessToken: v.optional(v.string()),
    serverSecret: v.optional(v.string()),
    projectId: v.optional(v.string()),
  },
  handler: async (ctx, { userId, workspaceId, accessToken, serverSecret, projectId }) => {
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
    return all.filter((s) => projectId !== undefined ? s.projectId === projectId : !s.projectId).filter((s) => (workspaceId !== undefined ? s.workspaceId === workspaceId : true)).map((s) => ({
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
      // Non-secret OAuth state only. Tokens and the client secret stay encrypted and server-side.
      oauthStatus: s.oauthStatus,
      oauthClientId: s.oauthClientId,
      oauthIssuer: s.oauthIssuer,
      oauthScope: s.oauthScope,
      oauthResource: s.oauthResource,
      oauthConnectedAt: s.oauthConnectedAt,
      oauthError: s.oauthError,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
    }))
  },
})

export const listEnabled = query({
  args: {
    userId: v.string(),
    workspaceId: v.optional(v.string()),
    accessToken: v.optional(v.string()),
    serverSecret: v.optional(v.string()),
    projectId: v.optional(v.string()),
  },
  handler: async (ctx, { userId, workspaceId, accessToken, serverSecret, projectId }) => {
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
    return all.filter((server) => projectId !== undefined ? server.projectId === projectId : !server.projectId).filter((server) => (workspaceId !== undefined ? server.workspaceId === workspaceId : true))
  },
})

export const get = query({
  args: {
    mcpServerId: v.id('mcpServers'),
    userId: v.string(),
    workspaceId: v.optional(v.string()),
    accessToken: v.optional(v.string()),
    serverSecret: v.optional(v.string()),
  },
  handler: async (ctx, { mcpServerId, userId, workspaceId, accessToken, serverSecret }) => {
    try {
      await authorizeUserAccess({ userId, accessToken, serverSecret })
    } catch {
      return null
    }
    const server = await ctx.db.get(mcpServerId)
    if (!server || server.userId !== userId || (workspaceId !== undefined && server.workspaceId !== workspaceId)) return null
    return server
  },
})

export const create = mutation({
  args: {
    userId: v.string(),
    workspaceId: v.optional(v.string()),
    accessToken: v.optional(v.string()),
    serverSecret: v.optional(v.string()),
    name: v.string(),
    projectId: v.optional(v.string()),
    description: v.optional(v.string()),
    transport: v.union(v.literal('sse'), v.literal('streamable-http')),
    url: v.string(),
    enabled: v.optional(v.boolean()),
    authType: v.optional(v.union(v.literal('none'), v.literal('bearer'), v.literal('header'), v.literal('oauth'))),
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
    validateMcpUrl(args.url)
    if (args.projectId) {
      const project = await ctx.db.get(args.projectId as Id<'projects'>)
      if (!project || project.userId !== args.userId || project.deletedAt) {
        throw new Error('Unauthorized')
      }
    }
    const now = Date.now()
    return await ctx.db.insert('mcpServers', {
      userId: args.userId,
      workspaceId: args.workspaceId,
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
    workspaceId: v.optional(v.string()),
    accessToken: v.optional(v.string()),
    serverSecret: v.optional(v.string()),
    name: v.optional(v.string()),
    description: v.optional(v.string()),
    transport: v.optional(v.union(v.literal('sse'), v.literal('streamable-http'))),
    url: v.optional(v.string()),
    enabled: v.optional(v.boolean()),
    authType: v.optional(v.union(v.literal('none'), v.literal('bearer'), v.literal('header'), v.literal('oauth'))),
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
  handler: async (ctx, { mcpServerId, userId, workspaceId, accessToken, serverSecret, ...updates }) => {
    await authorizeUserAccess({ userId, accessToken, serverSecret })
    if (updates.url !== undefined) validateMcpUrl(updates.url)
    const server = await ctx.db.get(mcpServerId)
    if (!server || server.userId !== userId || (workspaceId !== undefined && server.workspaceId !== workspaceId)) {
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
    workspaceId: v.optional(v.string()),
    accessToken: v.optional(v.string()),
    serverSecret: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, { mcpServerId, userId, workspaceId, accessToken, serverSecret }) => {
    await authorizeUserAccess({ userId, accessToken, serverSecret })
    const server = await ctx.db.get(mcpServerId)
    if (!server || server.userId !== userId || (workspaceId !== undefined && server.workspaceId !== workspaceId)) {
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

const oauthStatus = v.union(
  v.literal('pending'),
  v.literal('connected'),
  v.literal('needs_reauth'),
)

/**
 * Writes OAuth state. When `expectedTokenVersion` is supplied the token write is compare-and-set,
 * so two concurrent refreshes cannot clobber each other on servers that rotate refresh tokens.
 * Returns false when the caller lost the race and should re-read.
 */
export const updateOAuthState = mutation({
  args: {
    mcpServerId: v.id('mcpServers'),
    userId: v.string(),
    accessToken: v.optional(v.string()),
    serverSecret: v.optional(v.string()),
    encryptedOAuthTokens: v.optional(v.union(v.string(), v.null())),
    encryptedOAuthClient: v.optional(v.union(v.string(), v.null())),
    oauthClientId: v.optional(v.union(v.string(), v.null())),
    oauthStatus: v.optional(oauthStatus),
    oauthIssuer: v.optional(v.string()),
    oauthScope: v.optional(v.string()),
    oauthResource: v.optional(v.string()),
    oauthError: v.optional(v.union(v.string(), v.null())),
    expectedTokenVersion: v.optional(v.number()),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    await authorizeUserAccess(args)
    const server = await ctx.db.get(args.mcpServerId)
    if (!server || server.userId !== args.userId) throw new Error('Unauthorized')

    const currentVersion = server.oauthTokenVersion ?? 0
    if (args.expectedTokenVersion !== undefined && args.expectedTokenVersion !== currentVersion) {
      return false
    }

    const patch: Record<string, unknown> = { updatedAt: Date.now() }
    if (args.encryptedOAuthTokens !== undefined) {
      patch.encryptedOAuthTokens = args.encryptedOAuthTokens ?? undefined
      patch.oauthTokenVersion = currentVersion + 1
      if (args.encryptedOAuthTokens) patch.oauthConnectedAt = Date.now()
    }
    if (args.encryptedOAuthClient !== undefined) {
      patch.encryptedOAuthClient = args.encryptedOAuthClient ?? undefined
    }
    if (args.oauthClientId !== undefined) patch.oauthClientId = args.oauthClientId ?? undefined
    if (args.oauthStatus !== undefined) patch.oauthStatus = args.oauthStatus
    if (args.oauthIssuer !== undefined) patch.oauthIssuer = args.oauthIssuer
    if (args.oauthScope !== undefined) patch.oauthScope = args.oauthScope
    if (args.oauthResource !== undefined) patch.oauthResource = args.oauthResource
    if (args.oauthError !== undefined) patch.oauthError = args.oauthError ?? undefined

    await ctx.db.patch(args.mcpServerId, patch)
    return true
  },
})

export const createOAuthSession = mutation({
  args: {
    sessionId: v.string(),
    userId: v.string(),
    serverSecret: v.optional(v.string()),
    accessToken: v.optional(v.string()),
    mcpServerId: v.id('mcpServers'),
    encryptedCodeVerifier: v.string(),
    surface: v.union(v.literal('web'), v.literal('desktop')),
    returnTo: v.optional(v.string()),
    sessionBindingHash: v.optional(v.string()),
    expiresAt: v.number(),
    createdAt: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await authorizeUserAccess(args)
    const server = await ctx.db.get(args.mcpServerId)
    if (!server || server.userId !== args.userId) throw new Error('Unauthorized')
    await ctx.db.insert('mcpOAuthSessions', {
      sessionId: args.sessionId,
      userId: args.userId,
      mcpServerId: args.mcpServerId,
      encryptedCodeVerifier: args.encryptedCodeVerifier,
      surface: args.surface,
      returnTo: args.returnTo,
      sessionBindingHash: args.sessionBindingHash,
      expiresAt: args.expiresAt,
      createdAt: args.createdAt ?? Date.now(),
    })
    return null
  },
})

/**
 * Single-use read: the row is deleted as it is consumed, so a replayed `state` finds nothing.
 * Deliberately takes no userId — the caller is an unauthenticated browser redirect, and the row
 * itself is what binds the flow to a user.
 */
export const consumeOAuthSession = mutation({
  args: {
    sessionId: v.string(),
    serverSecret: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    if (!validateServerSecret(args.serverSecret)) throw new Error('Unauthorized')
    const row = await ctx.db
      .query('mcpOAuthSessions')
      .withIndex('by_sessionId', (q) => q.eq('sessionId', args.sessionId))
      .unique()
      .catch(() => null)
    if (!row) return null
    await ctx.db.delete(row._id)
    if (row.expiresAt < Date.now()) return null
    return row
  },
})

export const deleteExpiredOAuthSessions = mutation({
  args: {
    serverSecret: v.optional(v.string()),
    now: v.optional(v.number()),
  },
  returns: v.number(),
  handler: async (ctx, args) => {
    if (!validateServerSecret(args.serverSecret)) throw new Error('Unauthorized')
    const cutoff = args.now ?? Date.now()
    const expired = await ctx.db
      .query('mcpOAuthSessions')
      .withIndex('by_expiresAt', (q) => q.lt('expiresAt', cutoff))
      .take(200)
    for (const row of expired) await ctx.db.delete(row._id)
    return expired.length
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
