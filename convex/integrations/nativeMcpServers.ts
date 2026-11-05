import { paginationOptsValidator } from 'convex/server'
import { v } from 'convex/values'
import { mutation, query, type MutationCtx } from '../_generated/server'
import { requireNativeWorkspace } from '../lib/nativeViewer'
import { requireNativeCapability } from '../lib/nativeCapabilities'
import { scopeContextLoader, planArchive, planMove, planRestore } from '../lib/resourceScope'
import type { Doc } from '../_generated/dataModel'

const resourceArgs = { workspaceId: v.string(), mcpServerId: v.id('mcpServers') }
const policy = v.union(v.literal('allow'), v.literal('approval_required'), v.literal('deny'))

// An endpoint can carry credentials in its path, query, fragment or userinfo.
function endpointOrigin(url: string) {
  try { return new URL(url).origin } catch { return '' }
}

export function safeMcpSummary(row: Doc<'mcpServers'>) {
  return {
    _id: row._id, userId: row.userId, workspaceId: row.workspaceId,
    name: row.name, description: row.description, transport: row.transport,
    url: endpointOrigin(row.url), endpointRedacted: true as const,
    enabled: row.enabled, authType: row.authType,
    hasAuth: Boolean(row.authConfig || row.encryptedAuthConfig || row.encryptedOAuthTokens),
    scope: row.scope ?? 'personal' as const, archivedAt: row.archivedAt,
    archivedFromScope: row.archivedFromScope, timeoutMs: row.timeoutMs,
    defaultToolPolicy: row.defaultToolPolicy ?? 'allow' as const, toolPolicies: row.toolPolicies ?? {},
    toolCatalogCount: row.toolCatalog?.length ?? 0, toolCatalogUpdatedAt: row.toolCatalogUpdatedAt,
    toolCatalogError: row.toolCatalogError ? 'Tool discovery failed.' : undefined,
    oauthStatus: row.oauthStatus, oauthConnectedAt: row.oauthConnectedAt,
    oauthError: row.oauthError ? 'Authorization failed. Reconnect to try again.' : undefined,
    createdAt: row.createdAt, updatedAt: row.updatedAt,
    commandState: row.commandState,
  }
}

export const list = query({
  args: { workspaceId: v.string(), view: v.optional(v.union(v.literal('personal'), v.literal('workspace'), v.literal('archived'))), paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    const viewer = await requireNativeWorkspace(ctx, args.workspaceId)
    await requireNativeCapability(ctx, viewer.userId, 'mcp.use')
    const result = await ctx.db.query('mcpServers').withIndex('by_workspaceId', q => q.eq('workspaceId', args.workspaceId))
      .order('desc').paginate({ ...args.paginationOpts, numItems: Math.max(1, Math.min(100, args.paginationOpts.numItems)) })
    const access = scopeContextLoader(ctx, viewer.userId)
    const rows = await Promise.all(result.page.map(async row => {
      const visible = args.view ? await access.inView(row, args.view) : row.archivedAt === undefined && await access.canRead(row)
      return visible ? safeMcpSummary(row) : null
    }))
    return { ...result, page: rows.filter(row => row !== null) }
  },
})

export const get = query({
  args: resourceArgs,
  handler: async (ctx, args) => {
    const viewer = await requireNativeWorkspace(ctx, args.workspaceId)
    await requireNativeCapability(ctx, viewer.userId, 'mcp.use')
    const row = await ctx.db.get(args.mcpServerId)
    return row?.workspaceId === args.workspaceId && await scopeContextLoader(ctx, viewer.userId).canRead(row)
      ? safeMcpSummary(row) : null
  },
})

export async function admitMcpWrite(ctx: MutationCtx, userId: string, resourceId: string, action: string) {
  const now = Date.now(), bucket = 'native-mcp:write:user', bucketKey = `${bucket}:${userId}`
  const row = await ctx.db.query('rateLimitWindows').withIndex('by_bucketKey', q => q.eq('bucketKey', bucketKey)).unique()
  if (row && row.resetAt > now && row.count >= 300) throw new Error('RATE_LIMITED')
  const value = { bucket, bucketKey, count: row && row.resetAt > now ? row.count + 1 : 1,
    resetAt: row && row.resetAt > now ? row.resetAt : now + 600_000, updatedAt: now }
  if (row) await ctx.db.patch(row._id, value)
  else await ctx.db.insert('rateLimitWindows', value)
  await ctx.db.insert('auditEvents', { eventId: crypto.randomUUID(), actorType: 'user', actorUserId: userId,
    action, resourceType: 'mcp', resourceId, outcome: 'success', metadataJson: '{}', createdAt: now })
}

async function editable(ctx: MutationCtx, args: { workspaceId: string; mcpServerId: Doc<'mcpServers'>['_id']; expectedUpdatedAt: number }) {
  const viewer = await requireNativeWorkspace(ctx, args.workspaceId)
  await requireNativeCapability(ctx, viewer.userId, 'mcp.use')
  const row = await ctx.db.get(args.mcpServerId)
  if (!row || row.workspaceId !== args.workspaceId || !await scopeContextLoader(ctx, viewer.userId).canEdit(row)) throw new Error('MCP_ACCESS_DENIED')
  if (row.updatedAt !== args.expectedUpdatedAt) throw new Error('MCP_REVISION_CONFLICT')
  return { viewer, row }
}

export const updateMetadata = mutation({
  args: { ...resourceArgs, expectedUpdatedAt: v.number(), name: v.optional(v.string()), description: v.optional(v.string()),
    enabled: v.optional(v.boolean()), timeoutMs: v.optional(v.number()), defaultToolPolicy: v.optional(policy),
    toolPolicies: v.optional(v.record(v.string(), policy)) },
  handler: async (ctx, args) => {
    const { viewer, row } = await editable(ctx, args)
    if (row.archivedAt !== undefined) throw new Error('MCP_ARCHIVED')
    const mcpServerId = args.mcpServerId
    const fields = {
      name: args.name,
      description: args.description,
      enabled: args.enabled,
      timeoutMs: args.timeoutMs,
      defaultToolPolicy: args.defaultToolPolicy,
      toolPolicies: args.toolPolicies,
    }
    if (fields.name !== undefined && (!fields.name.trim() || fields.name.length > 200)) throw new Error('INVALID_MCP_NAME')
    if ((fields.description?.length ?? 0) > 4000 || Object.keys(fields.toolPolicies ?? {}).length > 500) throw new Error('INVALID_MCP_METADATA')
    if (fields.timeoutMs !== undefined && (!Number.isInteger(fields.timeoutMs) || fields.timeoutMs < 1000 || fields.timeoutMs > 120000)) throw new Error('INVALID_MCP_TIMEOUT')
    await admitMcpWrite(ctx, viewer.userId, mcpServerId, 'mcp.metadata.updated')
    const patch = Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined))
    await ctx.db.patch(mcpServerId, { ...patch, updatedAt: Math.max(Date.now(), row.updatedAt + 1) })
  },
})

export const changeScope = mutation({
  args: { ...resourceArgs, expectedUpdatedAt: v.number(), action: v.union(v.literal('personal'), v.literal('workspace'), v.literal('archive'), v.literal('restore')) },
  handler: async (ctx, args) => {
    const { row, viewer } = await editable(ctx, args)
    const action = args.action
    const plan = action === 'archive' ? await planArchive(ctx, { row, userId: viewer.userId, now: Date.now() })
      : action === 'restore' ? await planRestore(ctx, { row, userId: viewer.userId })
        : await planMove(ctx, { kind: 'extension', row, userId: viewer.userId, to: action })
    if (!plan.ok) throw new Error('MCP_SCOPE_DENIED')
    await admitMcpWrite(ctx, viewer.userId, row._id, `mcp.scope.${action}`)
    await ctx.db.patch(row._id, { ...('patch' in plan ? plan.patch : { scope: plan.scope, archivedAt: undefined, archivedBy: undefined, archivedFromScope: undefined }),
      ...(action === 'archive' ? { enabled: false } : {}), updatedAt: Math.max(Date.now(), row.updatedAt + 1) })
  },
})
