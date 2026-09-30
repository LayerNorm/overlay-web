import { v } from 'convex/values'
import { internalMutation, mutation, query, type MutationCtx, type QueryCtx } from '../_generated/server'
import type { Doc } from '../_generated/dataModel'
import { requireServerSecret } from '../lib/auth'

// Chat SDK StateAdapter backing store (src/server/surfaces/convex-chat-state.ts).
// Every mutation is a transaction, so the SDK's atomic operations
// (setIfNotExists, lock acquisition, bounded append/enqueue) hold across the
// serverless instances that share one Slack installation. Semantics mirror
// @chat-adapter/state-pg: expired rows are invisible to reads and replaced on
// write. Values are opaque JSON strings serialized by the adapter.

type Namespace = Doc<'surfaceChatState'>['namespace']

async function rows(ctx: QueryCtx | MutationCtx, namespace: Namespace, key: string) {
  return await ctx.db
    .query('surfaceChatState')
    .withIndex('by_namespace_key', (q) => q.eq('namespace', namespace).eq('key', key))
    .collect()
}

function live(row: Doc<'surfaceChatState'>, now: number): boolean {
  return row.expiresAt === undefined || row.expiresAt > now
}

function expiresAt(now: number, ttlMs: number | undefined): number | undefined {
  return ttlMs && ttlMs > 0 ? now + ttlMs : undefined
}

export const get = query({
  args: { serverSecret: v.string(), key: v.string() },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const now = Date.now()
    const row = (await rows(ctx, 'cache', args.key)).find((candidate) => live(candidate, now))
    return row?.value ?? null
  },
})

export const set = mutation({
  args: { serverSecret: v.string(), key: v.string(), value: v.string(), ttlMs: v.optional(v.number()) },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const now = Date.now()
    const [existing, ...duplicates] = await rows(ctx, 'cache', args.key)
    for (const duplicate of duplicates) await ctx.db.delete(duplicate._id)
    const patch = { value: args.value, expiresAt: expiresAt(now, args.ttlMs) }
    if (existing) await ctx.db.patch(existing._id, patch)
    else await ctx.db.insert('surfaceChatState', { namespace: 'cache', key: args.key, ...patch })
  },
})

export const setIfNotExists = mutation({
  args: { serverSecret: v.string(), key: v.string(), value: v.string(), ttlMs: v.optional(v.number()) },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const now = Date.now()
    const existing = await rows(ctx, 'cache', args.key)
    if (existing.some((row) => live(row, now))) return false
    for (const row of existing) await ctx.db.delete(row._id)
    await ctx.db.insert('surfaceChatState', {
      namespace: 'cache',
      key: args.key,
      value: args.value,
      expiresAt: expiresAt(now, args.ttlMs),
    })
    return true
  },
})

export const remove = mutation({
  args: { serverSecret: v.string(), key: v.string() },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    for (const row of await rows(ctx, 'cache', args.key)) await ctx.db.delete(row._id)
  },
})

export const appendToList = mutation({
  args: {
    serverSecret: v.string(),
    key: v.string(),
    value: v.string(),
    maxLength: v.optional(v.number()),
    ttlMs: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const now = Date.now()
    const nextExpiry = expiresAt(now, args.ttlMs)
    await ctx.db.insert('surfaceChatState', {
      namespace: 'list',
      key: args.key,
      value: args.value,
      expiresAt: nextExpiry,
    })
    const entries = await rows(ctx, 'list', args.key)
    const overflow = args.maxLength && args.maxLength > 0 ? entries.length - args.maxLength : 0
    for (const [index, entry] of entries.entries()) {
      if (index < overflow) await ctx.db.delete(entry._id)
      // Appending refreshes the TTL of the whole list, as in the Redis and
      // Postgres adapters.
      else if (nextExpiry !== undefined) await ctx.db.patch(entry._id, { expiresAt: nextExpiry })
    }
  },
})

export const getList = query({
  args: { serverSecret: v.string(), key: v.string() },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const now = Date.now()
    return (await rows(ctx, 'list', args.key))
      .filter((row) => live(row, now))
      .map((row) => row.value ?? 'null')
  },
})

export const enqueue = mutation({
  args: {
    serverSecret: v.string(),
    threadId: v.string(),
    value: v.string(),
    entryExpiresAt: v.number(),
    maxSize: v.number(),
  },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const now = Date.now()
    await ctx.db.insert('surfaceChatState', {
      namespace: 'queue',
      key: args.threadId,
      value: args.value,
      expiresAt: args.entryExpiresAt,
    })
    const entries = await rows(ctx, 'queue', args.threadId)
    const alive = []
    for (const entry of entries) {
      if (live(entry, now)) alive.push(entry)
      else await ctx.db.delete(entry._id)
    }
    // Over capacity, the oldest entries are dropped so the newest survive.
    const overflow = args.maxSize > 0 ? alive.length - args.maxSize : 0
    for (const entry of alive.slice(0, Math.max(0, overflow))) await ctx.db.delete(entry._id)
    return alive.length - Math.max(0, overflow)
  },
})

export const dequeue = mutation({
  args: { serverSecret: v.string(), threadId: v.string() },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const now = Date.now()
    for (const entry of await rows(ctx, 'queue', args.threadId)) {
      await ctx.db.delete(entry._id)
      if (live(entry, now)) return entry.value ?? null
    }
    return null
  },
})

export const queueDepth = query({
  args: { serverSecret: v.string(), threadId: v.string() },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const now = Date.now()
    return (await rows(ctx, 'queue', args.threadId)).filter((row) => live(row, now)).length
  },
})

export const subscribe = mutation({
  args: { serverSecret: v.string(), threadId: v.string() },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    if ((await rows(ctx, 'subscription', args.threadId)).length > 0) return
    await ctx.db.insert('surfaceChatState', { namespace: 'subscription', key: args.threadId })
  },
})

export const unsubscribe = mutation({
  args: { serverSecret: v.string(), threadId: v.string() },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    for (const row of await rows(ctx, 'subscription', args.threadId)) await ctx.db.delete(row._id)
  },
})

export const isSubscribed = query({
  args: { serverSecret: v.string(), threadId: v.string() },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    return (await rows(ctx, 'subscription', args.threadId)).length > 0
  },
})

export const acquireLock = mutation({
  args: { serverSecret: v.string(), threadId: v.string(), token: v.string(), ttlMs: v.number() },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const now = Date.now()
    const existing = await rows(ctx, 'lock', args.threadId)
    if (existing.some((row) => live(row, now))) return null
    for (const row of existing) await ctx.db.delete(row._id)
    const lockExpiresAt = now + args.ttlMs
    await ctx.db.insert('surfaceChatState', {
      namespace: 'lock',
      key: args.threadId,
      token: args.token,
      expiresAt: lockExpiresAt,
    })
    return { threadId: args.threadId, token: args.token, expiresAt: lockExpiresAt }
  },
})

export const releaseLock = mutation({
  args: { serverSecret: v.string(), threadId: v.string(), token: v.optional(v.string()) },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    // Without a token this is forceReleaseLock; with one, only the holder's
    // lock is removed, so a stale handler cannot release its successor's.
    for (const row of await rows(ctx, 'lock', args.threadId)) {
      if (args.token === undefined || row.token === args.token) await ctx.db.delete(row._id)
    }
  },
})

export const extendLock = mutation({
  args: { serverSecret: v.string(), threadId: v.string(), token: v.string(), ttlMs: v.number() },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const now = Date.now()
    const held = (await rows(ctx, 'lock', args.threadId))
      .find((row) => row.token === args.token && live(row, now))
    if (!held) return false
    await ctx.db.patch(held._id, { expiresAt: now + args.ttlMs })
    return true
  },
})

/** Cron: removes expired cache, list, queue, and lock rows in bounded batches. */
export const pruneExpired = internalMutation({
  args: {},
  handler: async (ctx) => {
    const expired = await ctx.db
      .query('surfaceChatState')
      .withIndex('by_expiresAt', (q) => q.gt('expiresAt', 0).lte('expiresAt', Date.now()))
      .take(500)
    for (const row of expired) await ctx.db.delete(row._id)
    return expired.length
  },
})
