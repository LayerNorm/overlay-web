import { v } from 'convex/values'
import type { MutationCtx, QueryCtx } from '../_generated/server'
import { mutation, query } from '../_generated/server'
import { requireAccessToken, validateServerSecret } from '../lib/auth'
import { assertCanCreateInScope, listScopedRows, scopeContextLoader } from '../lib/resourceScope'
import { scopeMutations } from '../lib/scopeMutations'

// Archived connectors are not used by agents (see listByWorkspace).
export const { setScope, archive, restore } = scopeMutations('workspaceConnectors', 'extension')

type ConnectorDatabaseContext = { db: QueryCtx['db'] | MutationCtx['db'] }

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

async function requireActiveWorkspaceMembership(
  ctx: ConnectorDatabaseContext,
  workspaceId: string,
  userId: string,
) {
  const principal = await ctx.db
    .query('workspacePrincipals')
    .withIndex('by_workspaceId_userId', (q) => q.eq('workspaceId', workspaceId).eq('userId', userId))
    .unique()
  if (!principal || principal.archivedAt) throw new Error('WORKSPACE_ACCESS_DENIED')

  const membership = await ctx.db
    .query('workspaceMemberships')
    .withIndex('by_workspaceId_principalId', (q) =>
      q.eq('workspaceId', workspaceId).eq('principalId', principal.principalId))
    .unique()
  if (!membership || membership.status !== 'active') throw new Error('WORKSPACE_ACCESS_DENIED')
}

async function authorizeWorkspaceUserAccess(
  ctx: ConnectorDatabaseContext,
  params: {
    accessToken?: string
    serverSecret?: string
    userId: string
    workspaceId: string
  },
) {
  await authorizeUserAccess(params)
  await requireActiveWorkspaceMembership(ctx, params.workspaceId, params.userId)
}

export const listByWorkspace = query({
  args: {
    workspaceId: v.string(),
    userId: v.string(),
    accessToken: v.optional(v.string()),
    serverSecret: v.optional(v.string()),
  },
  handler: async (ctx, { workspaceId, userId, accessToken, serverSecret }) => {
    await authorizeWorkspaceUserAccess(ctx, { workspaceId, userId, accessToken, serverSecret })
    const rows = await ctx.db
      .query('workspaceConnectors')
      .withIndex('by_workspaceId_userId_providerKey', (q) =>
        q.eq('workspaceId', workspaceId).eq('userId', userId))
      .collect()
    // The caller's own personal connectors; ones shared with the workspace are listed by `listScopedByWorkspace`.
    return rows.filter((row) => row.archivedAt === undefined && row.scope !== 'workspace')
  },
})

/**
 * Connectors for the Personal / Workspace / Archived views: the caller's own plus other members' workspace-scoped
 * ones. Other people's rows never carry their connected account id (a workspace connector shares its use, not the
 * credential reference).
 */
export const listScopedByWorkspace = query({
  args: {
    workspaceId: v.string(),
    userId: v.string(),
    accessToken: v.optional(v.string()),
    serverSecret: v.optional(v.string()),
    view: v.optional(v.union(v.literal('personal'), v.literal('workspace'), v.literal('archived'))),
  },
  handler: async (ctx, { workspaceId, userId, accessToken, serverSecret, view }) => {
    await authorizeWorkspaceUserAccess(ctx, { workspaceId, userId, accessToken, serverSecret })
    const rows = await listScopedRows(ctx, {
      userId, workspaceId, view,
      fetchMine: async () => await ctx.db.query('workspaceConnectors')
        .withIndex('by_workspaceId_userId_providerKey', (q) => q.eq('workspaceId', workspaceId).eq('userId', userId)).collect(),
      fetchShared: async (ws) => await ctx.db.query('workspaceConnectors')
        .withIndex('by_workspaceId_scope_archivedAt', (q) => q.eq('workspaceId', ws).eq('scope', 'workspace')).collect(),
    })
    return rows.map((row) => ({
      _id: row._id,
      userId: row.userId,
      workspaceId: row.workspaceId,
      providerKey: row.providerKey,
      scope: row.scope ?? ('personal' as const),
      archivedAt: row.archivedAt,
      archivedFromScope: row.archivedFromScope,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      ...(row.userId === userId ? { connectedAccountId: row.connectedAccountId } : {}),
    }))
  },
})

export const listByUser = query({
  args: {
    userId: v.string(),
    accessToken: v.optional(v.string()),
    serverSecret: v.optional(v.string()),
  },
  handler: async (ctx, { userId, accessToken, serverSecret }) => {
    await authorizeUserAccess({ userId, accessToken, serverSecret })
    return await ctx.db
      .query('workspaceConnectors')
      .withIndex('by_userId', (q) => q.eq('userId', userId))
      .collect()
  },
})

export const insert = mutation({
  args: {
    workspaceId: v.string(),
    userId: v.string(),
    providerKey: v.string(),
    connectedAccountId: v.string(),
    accessToken: v.optional(v.string()),
    serverSecret: v.optional(v.string()),
    /** Scope of a newly created connector; an existing one keeps its scope (move it with `setScope`). */
    scope: v.optional(v.union(v.literal('personal'), v.literal('workspace'))),
  },
  handler: async (ctx, { workspaceId, userId, providerKey, connectedAccountId, accessToken, serverSecret, scope }) => {
    await authorizeWorkspaceUserAccess(ctx, { workspaceId, userId, accessToken, serverSecret })
    const now = Date.now()
    const rows = await ctx.db
      .query('workspaceConnectors')
      .withIndex('by_workspaceId_userId_providerKey', (q) =>
        q.eq('workspaceId', workspaceId).eq('userId', userId).eq('providerKey', providerKey))
      .collect()
    // A person has at most one connector per provider in each scope: their own account, and the workspace's.
    const target = scope ?? 'personal'
    const sameScope = rows.filter((row) => (row.scope ?? 'personal') === target)
    if (sameScope.length > 1) throw new Error('WORKSPACE_CONNECTOR_DUPLICATE')
    const existing = sameScope[0]
    if (existing) {
      await ctx.db.patch(existing._id, { connectedAccountId, updatedAt: now })
      return existing._id
    }
    const createdScope = await assertCanCreateInScope(ctx, { kind: 'extension', scope, workspaceId, userId })
    if (createdScope === 'workspace') {
      // One workspace account per connector: a second person connecting it must disconnect the first.
      const taken = (await ctx.db.query('workspaceConnectors')
        .withIndex('by_workspaceId_providerKey', (q) => q.eq('workspaceId', workspaceId).eq('providerKey', providerKey))
        .collect()).some((row) => row.scope === 'workspace' && row.archivedAt === undefined)
      if (taken) throw new Error('WORKSPACE_CONNECTOR_EXISTS')
    }
    return await ctx.db.insert('workspaceConnectors', {
      workspaceId,
      userId,
      scope: createdScope,
      providerKey,
      connectedAccountId,
      createdAt: now,
      updatedAt: now,
    })
  },
})

export const remove = mutation({
  args: {
    workspaceId: v.string(),
    providerKey: v.string(),
    userId: v.string(),
    accessToken: v.optional(v.string()),
    serverSecret: v.optional(v.string()),
  },
  handler: async (ctx, { workspaceId, providerKey, userId, accessToken, serverSecret }) => {
    await authorizeWorkspaceUserAccess(ctx, { workspaceId, userId, accessToken, serverSecret })
    const rows = await ctx.db
      .query('workspaceConnectors')
      .withIndex('by_workspaceId_userId_providerKey', (q) =>
        q.eq('workspaceId', workspaceId).eq('userId', userId).eq('providerKey', providerKey))
      .collect()
    // The person's own connector only; the workspace's is removed by `removeWorkspaceConnector`.
    await Promise.all(rows.filter((row) => row.scope !== 'workspace').map((row) => ctx.db.delete(row._id)))
  },
})

/**
 * Removes the workspace's connector for a provider. Its creator may, and owners and admins (as for any workspace item).
 * Returns the row's creator so the caller can tell who connected it, or null when there is none or it is not theirs to remove.
 */
export const removeWorkspaceConnector = mutation({
  args: {
    workspaceId: v.string(),
    providerKey: v.string(),
    userId: v.string(),
    accessToken: v.optional(v.string()),
    serverSecret: v.optional(v.string()),
  },
  handler: async (ctx, { workspaceId, providerKey, userId, accessToken, serverSecret }) => {
    await authorizeWorkspaceUserAccess(ctx, { workspaceId, userId, accessToken, serverSecret })
    const row = (await ctx.db.query('workspaceConnectors')
      .withIndex('by_workspaceId_providerKey', (q) => q.eq('workspaceId', workspaceId).eq('providerKey', providerKey))
      .collect()).find((candidate) => candidate.scope === 'workspace')
    if (!row) return { ok: false as const, reason: 'not_found' as const }
    if (!(await scopeContextLoader(ctx, userId).canEdit(row))) return { ok: false as const, reason: 'forbidden' as const }
    await ctx.db.delete(row._id)
    return { ok: true as const, creatorUserId: row.userId }
  },
})

export const removeByUser = mutation({
  args: {
    userId: v.string(),
    serverSecret: v.optional(v.string()),
    accessToken: v.optional(v.string()),
  },
  handler: async (ctx, { userId, serverSecret, accessToken }) => {
    await authorizeUserAccess({ userId, accessToken, serverSecret })
    const rows = await ctx.db
      .query('workspaceConnectors')
      .withIndex('by_userId', (q) => q.eq('userId', userId))
      .collect()
    await Promise.all(rows.map((row) => ctx.db.delete(row._id)))
    return rows.length
  },
})
