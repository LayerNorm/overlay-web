import { v } from 'convex/values'
import { mutation, query, type MutationCtx, type QueryCtx } from '../_generated/server'
import { requireServerSecret } from '../lib/auth'
import type { Doc } from '../_generated/dataModel'

const providerValidator = v.union(v.literal('claude-code'), v.literal('codex'), v.literal('opencode'), v.literal('hermes'), v.literal('cursor'))
const methodValidator = v.union(v.literal('subscription'), v.literal('api_key'))
const statusValidator = v.union(v.literal('active'), v.literal('needs_reauth'))

const publicRowValidator = v.object({
  id: v.string(),
  provider: providerValidator,
  method: methodValidator,
  label: v.string(),
  status: statusValidator,
  lastError: v.optional(v.string()),
  lastUsedAt: v.optional(v.number()),
  createdAt: v.number(),
  updatedAt: v.number(),
})

/** Never returns the credential reference. */
function toPublic(row: Doc<'agentProviderAccounts'>) {
  return {
    id: row._id,
    provider: row.provider,
    method: row.method,
    label: row.label,
    status: row.status,
    lastError: row.lastError,
    lastUsedAt: row.lastUsedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

async function readById(ctx: QueryCtx | MutationCtx, accountId: string) {
  const id = ctx.db.normalizeId('agentProviderAccounts', accountId)
  return id ? await ctx.db.get(id) : null
}

export const listPublicByServer = query({
  args: { serverSecret: v.string(), userId: v.string() },
  returns: v.array(publicRowValidator),
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const rows = await ctx.db
      .query('agentProviderAccounts')
      .withIndex('by_userId', (q) => q.eq('userId', args.userId))
      .take(100)
    return rows.map(toPublic)
  },
})

/** Includes the credential reference: server use only, never forwarded to a client. */
export const getByServer = query({
  args: { serverSecret: v.string(), accountId: v.string() },
  returns: v.union(v.null(), v.object({
    id: v.string(),
    userId: v.string(),
    provider: providerValidator,
    method: methodValidator,
    label: v.string(),
    credentialRef: v.string(),
    status: statusValidator,
    lastError: v.optional(v.string()),
    lastUsedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })),
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const row = await readById(ctx, args.accountId)
    return row ? { ...toPublic(row), userId: row.userId, credentialRef: row.credentialRef } : null
  },
})

/** Vault references for every agent account this user stored, so account deletion can remove them from the vault. */
export const listCredentialRefsByServer = query({
  args: { serverSecret: v.string(), userId: v.string() },
  returns: v.array(v.string()),
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const rows = await ctx.db
      .query('agentProviderAccounts')
      .withIndex('by_userId', (q) => q.eq('userId', args.userId))
      .take(1_000)
    return rows.map((row) => row.credentialRef)
  },
})

export const createByServer = mutation({
  args: {
    serverSecret: v.string(),
    userId: v.string(),
    provider: providerValidator,
    method: methodValidator,
    label: v.string(),
    credentialRef: v.string(),
    maxAccounts: v.number(),
  },
  returns: v.string(),
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const existing = await ctx.db
      .query('agentProviderAccounts')
      .withIndex('by_userId', (q) => q.eq('userId', args.userId))
      .take(args.maxAccounts + 1)
    if (existing.length >= args.maxAccounts) throw new Error('AGENT_PROVIDER_ACCOUNT_LIMIT')
    const now = Date.now()
    return await ctx.db.insert('agentProviderAccounts', {
      userId: args.userId,
      provider: args.provider,
      method: args.method,
      label: args.label,
      credentialRef: args.credentialRef,
      status: 'active',
      createdAt: now,
      updatedAt: now,
    })
  },
})

export const updateByServer = mutation({
  args: {
    serverSecret: v.string(),
    accountId: v.string(),
    label: v.optional(v.string()),
    credentialRef: v.optional(v.string()),
    status: v.optional(statusValidator),
    lastError: v.optional(v.union(v.string(), v.null())),
    lastUsedAt: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const row = await readById(ctx, args.accountId)
    if (!row) throw new Error('Account not found')
    const patch: Record<string, unknown> = { updatedAt: Date.now() }
    if (args.label !== undefined) patch.label = args.label
    if (args.credentialRef !== undefined) patch.credentialRef = args.credentialRef
    if (args.status !== undefined) patch.status = args.status
    if (args.lastError !== undefined) patch.lastError = args.lastError ?? undefined
    if (args.lastUsedAt !== undefined) patch.lastUsedAt = args.lastUsedAt
    await ctx.db.patch(row._id, patch)
    return null
  },
})

export const deleteByServer = mutation({
  args: { serverSecret: v.string(), accountId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const row = await readById(ctx, args.accountId)
    if (row) await ctx.db.delete(row._id)
    return null
  },
})

/**
 * Takes the account's refresh lock for `ttlMs`, or reports that someone else holds it. A lease, not a forever lock:
 * a server that dies mid-refresh frees it when the lease runs out.
 */
export const acquireRefreshLockByServer = mutation({
  args: { serverSecret: v.string(), accountId: v.string(), owner: v.string(), ttlMs: v.number(), now: v.number() },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const row = await readById(ctx, args.accountId)
    if (!row) throw new Error('Account not found')
    if (row.refreshLockUntil !== undefined && row.refreshLockUntil > args.now && row.refreshLockOwner !== args.owner) return false
    await ctx.db.patch(row._id, { refreshLockOwner: args.owner, refreshLockUntil: args.now + Math.max(1_000, Math.min(args.ttlMs, 120_000)) })
    return true
  },
})

export const releaseRefreshLockByServer = mutation({
  args: { serverSecret: v.string(), accountId: v.string(), owner: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const row = await readById(ctx, args.accountId)
    if (row && row.refreshLockOwner === args.owner) await ctx.db.patch(row._id, { refreshLockOwner: undefined, refreshLockUntil: undefined })
    return null
  },
})
