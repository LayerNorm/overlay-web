import { paginationOptsValidator } from 'convex/server'
import { v } from 'convex/values'
import type { MutationCtx } from '../_generated/server'
import { mutation, query } from '../_generated/server'
import { requireServerSecret } from '../lib/auth'

const BACKFILL_TABLES = [
  'conversations',
  'files',
  'notes',
  'skills',
  'mcpServers',
  'projects',
  'automations',
  'memories',
  'outputs',
  'webhookSubscriptions',
  'knowledgeChunks',
] as const

export const auditBackfillByServer = query({
  args: {
    serverSecret: v.string(),
    table: v.union(...BACKFILL_TABLES.map((t) => v.literal(t))),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const page = await ctx.db.query(args.table).paginate(args.paginationOpts)
    let missingWorkspaceId = 0
    for (const row of page.page) {
      if (!row.workspaceId) missingWorkspaceId++
    }
    return {
      table: args.table,
      rows: page.page.length,
      missingWorkspaceId,
      continueCursor: page.continueCursor,
      isDone: page.isDone,
    }
  },
})

export const backfillBatchByServer = mutation({
  args: {
    serverSecret: v.string(),
    table: v.union(...BACKFILL_TABLES.map((t) => v.literal(t))),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const page = await ctx.db.query(args.table).paginate(args.paginationOpts)
    let migrated = 0
    let skipped = 0
    for (const row of page.page) {
      if (row.workspaceId) {
        skipped++
        continue
      }
      const scope = await ensureLegacyPersonalScope(ctx, row.userId)
      await ctx.db.patch(row._id, { workspaceId: scope.workspaceId })
      migrated++
    }
    return {
      table: args.table,
      rows: page.page.length,
      migrated,
      skipped,
      continueCursor: page.continueCursor,
      isDone: page.isDone,
    }
  },
})

async function ensureLegacyPersonalScope(ctx: MutationCtx, userId: string) {
  const existingWorkspace = await ctx.db.query('workspaces')
    .withIndex('by_personalOwnerUserId', (q) => q.eq('personalOwnerUserId', userId))
    .unique()
  if (existingWorkspace) {
    return { workspaceId: existingWorkspace.workspaceId }
  }
  const now = Date.now()
  const token = stableToken(userId)
  const workspaceId = `personal-${token}`
  const principalId = `human-${token}`
  await ctx.db.insert('workspaces', {
    workspaceId,
    kind: 'personal',
    name: 'Personal',
    slug: `personal-${token}`,
    status: 'active',
    createdByPrincipalId: principalId,
    personalOwnerUserId: userId,
    createdAt: now,
    updatedAt: now,
  })
  await ctx.db.insert('workspacePrincipals', {
    principalId,
    workspaceId,
    type: 'human',
    userId,
    displayName: 'Member',
    createdAt: now,
    updatedAt: now,
  })
  await ctx.db.insert('workspaceMemberships', {
    membershipId: `membership-${token}`,
    workspaceId,
    principalId,
    role: 'owner',
    status: 'active',
    joinedAt: now,
    updatedAt: now,
  })
  const preference = await ctx.db.query('workspaceUserPreferences')
    .withIndex('by_userId', (q) => q.eq('userId', userId))
    .unique()
  if (!preference) {
    await ctx.db.insert('workspaceUserPreferences', {
      userId,
      activeWorkspaceId: workspaceId,
      updatedAt: now,
    })
  }
  return { workspaceId }
}

function stableToken(value: string) {
  let hash = 2166136261
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36)
}
