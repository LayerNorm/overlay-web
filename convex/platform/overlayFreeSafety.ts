import { v } from 'convex/values'
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from '../_generated/server'
import { requireServerSecret } from '../lib/auth'

const ROUTE_KEY = v.string()
const routeTransport = v.union(v.literal('gateway'), v.literal('openrouter'))
const routeValidator = v.object({
  routeKey: v.string(),
  transport: routeTransport,
  modelId: v.string(),
  provider: v.string(),
  capabilitiesJson: v.string(),
  pricingJson: v.string(),
  catalogVerifiedAt: v.number(),
  catalogExpiresAt: v.number(),
  generation: v.number(),
  canaryVerifiedAt: v.optional(v.number()),
  canaryExpiresAt: v.optional(v.number()),
  quarantineReason: v.optional(v.string()),
  quarantineAt: v.optional(v.number()),
  cooldownUntil: v.optional(v.number()),
  latestReceiptAt: v.optional(v.number()),
  latestReceiptJson: v.optional(v.string()),
  latestActualModelId: v.optional(v.string()),
  latestActualProvider: v.optional(v.string()),
  activeLeaseToken: v.optional(v.string()),
  activeLeaseExpiresAt: v.optional(v.number()),
  updatedAt: v.number(),
})

const routeInput = v.object({
  routeKey: v.string(),
  transport: routeTransport,
  modelId: v.string(),
  provider: v.string(),
  capabilitiesJson: v.string(),
  pricingJson: v.string(),
  catalogVerifiedAt: v.number(),
  catalogExpiresAt: v.number(),
  generation: v.number(),
  canaryVerifiedAt: v.optional(v.number()),
  canaryExpiresAt: v.optional(v.number()),
})

const statusValidator = v.union(
  v.literal('claimed'),
  v.literal('busy'),
  v.literal('missing'),
  v.literal('quarantined'),
  v.literal('cooldown'),
  v.literal('expired'),
  v.literal('settled'),
  v.literal('late'),
)
const claimPurpose = v.union(v.literal('user'), v.literal('canary'))

const LOCK_KEY = 'overlay-free'

async function findRoute(ctx: QueryCtx | MutationCtx, routeKey: string) {
  return await ctx.db
    .query('overlayFreeRoutes')
    .withIndex('by_routeKey', (q) => q.eq('routeKey', routeKey))
    .first()
}

async function findLock(ctx: QueryCtx | MutationCtx) {
  return await ctx.db
    .query('overlayFreeRefreshLocks')
    .withIndex('by_key', (q) => q.eq('key', LOCK_KEY))
    .first()
}

function routeWithoutLease(row: NonNullable<Awaited<ReturnType<typeof findRoute>>>) {
  return {
    routeKey: row.routeKey,
    transport: row.transport,
    modelId: row.modelId,
    provider: row.provider,
    capabilitiesJson: row.capabilitiesJson,
    pricingJson: row.pricingJson,
    catalogVerifiedAt: row.catalogVerifiedAt,
    catalogExpiresAt: row.catalogExpiresAt,
    generation: row.generation,
    canaryVerifiedAt: row.canaryVerifiedAt,
    canaryExpiresAt: row.canaryExpiresAt,
    quarantineReason: row.quarantineReason,
    quarantineAt: row.quarantineAt,
    cooldownUntil: row.cooldownUntil,
    latestReceiptAt: row.latestReceiptAt,
    latestReceiptJson: row.latestReceiptJson,
    latestActualModelId: row.latestActualModelId,
    latestActualProvider: row.latestActualProvider,
    activeLeaseToken: row.activeLeaseToken,
    activeLeaseExpiresAt: row.activeLeaseExpiresAt,
    updatedAt: row.updatedAt,
  }
}

export const listEligibleByServer = query({
  args: { serverSecret: v.string(), now: v.number(), generation: v.number() },
  returns: v.array(routeValidator),
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const rows = await ctx.db.query('overlayFreeRoutes').collect()
    return rows.filter((row) =>
      row.generation === args.generation &&
      row.catalogExpiresAt > args.now &&
      (row.transport === 'openrouter' || (row.canaryExpiresAt ?? 0) > args.now) &&
      !row.quarantineReason &&
      (!row.cooldownUntil || row.cooldownUntil <= args.now) &&
      (!row.activeLeaseToken || row.activeLeaseExpiresAt !== undefined && row.activeLeaseExpiresAt <= args.now)
    ).map(routeWithoutLease)
  },
})

export const getRefreshStateByServer = query({
  args: { serverSecret: v.string(), now: v.number() },
  returns: v.object({ generation: v.number(), due: v.boolean() }),
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const lock = await findLock(ctx)
    return {
      generation: lock?.generation ?? 0,
      due: !lock || (lock.leaseExpiresAt <= args.now && lock.retryAfter <= args.now),
    }
  },
})

export const quarantineExpiredLeasesByServer = mutation({
  args: { serverSecret: v.string(), now: v.number() },
  returns: v.null(),
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const rows = await ctx.db.query('overlayFreeRoutes').collect()
    for (const row of rows) {
      if (!row.activeLeaseToken || row.activeLeaseExpiresAt !== undefined && row.activeLeaseExpiresAt > args.now) continue
      await ctx.db.patch(row._id, {
        quarantineReason: row.quarantineReason ?? 'missing receipt',
        quarantineAt: row.quarantineAt ?? args.now,
        activeLeaseToken: undefined,
        activeLeaseExpiresAt: undefined,
        updatedAt: args.now,
      })
    }
    return null
  },
})

export const getByServer = query({
  args: { serverSecret: v.string(), routeKey: ROUTE_KEY },
  returns: v.union(routeValidator, v.null()),
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const row = await findRoute(ctx, args.routeKey)
    return row ? routeWithoutLease(row) : null
  },
})

export const claimByServer = mutation({
  args: {
    serverSecret: v.string(),
    routeKey: ROUTE_KEY,
    leaseToken: v.string(),
    now: v.number(),
    leaseMs: v.number(),
    purpose: claimPurpose,
    expectedGeneration: v.number(),
    refreshToken: v.optional(v.string()),
  },
  returns: v.object({ status: statusValidator, route: v.union(routeValidator, v.null()) }),
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const lock = await findLock(ctx)
    if (!lock || lock.generation !== args.expectedGeneration) return { status: 'missing' as const, route: null }
    if (args.purpose === 'canary' &&
      (lock.leaseToken !== args.refreshToken || lock.leaseExpiresAt <= args.now)) {
      return { status: 'missing' as const, route: null }
    }
    const row = await findRoute(ctx, args.routeKey)
    if (!row) return { status: 'missing' as const, route: null }
    if (row.activeLeaseToken) {
      if (row.activeLeaseExpiresAt !== undefined && row.activeLeaseExpiresAt > args.now) return { status: 'busy' as const, route: null }
      await ctx.db.patch(row._id, {
        quarantineReason: 'missing receipt',
        quarantineAt: args.now,
        activeLeaseToken: undefined,
        activeLeaseExpiresAt: undefined,
        updatedAt: args.now,
      })
      return { status: 'expired' as const, route: null }
    }
    if (row.generation !== args.expectedGeneration || row.catalogExpiresAt <= args.now) return { status: 'missing' as const, route: null }
    if (args.purpose === 'user' && row.transport === 'gateway' && (row.canaryExpiresAt ?? 0) <= args.now) return { status: 'missing' as const, route: null }
    if (args.purpose === 'canary' && (row.quarantineReason || row.cooldownUntil && row.cooldownUntil > args.now)) return { status: 'quarantined' as const, route: null }
    if (row.quarantineReason) return { status: 'quarantined' as const, route: null }
    if (row.cooldownUntil && row.cooldownUntil > args.now) return { status: 'cooldown' as const, route: null }
    await ctx.db.patch(row._id, {
      activeLeaseToken: args.leaseToken,
      activeLeaseExpiresAt: args.now + Math.min(args.leaseMs, 3 * 60 * 1000),
      updatedAt: args.now,
    })
    return {
      status: 'claimed' as const,
      route: {
        ...routeWithoutLease(row),
        activeLeaseToken: args.leaseToken,
        activeLeaseExpiresAt: args.now + Math.min(args.leaseMs, 3 * 60 * 1000),
        updatedAt: args.now,
      },
    }
  },
})

export const settleByServer = mutation({
  args: {
    serverSecret: v.string(),
    routeKey: ROUTE_KEY,
    leaseToken: v.string(),
    now: v.number(),
    receiptJson: v.string(),
    safe: v.boolean(),
    cost: v.union(v.number(), v.null()),
    actualModelId: v.optional(v.string()),
    actualProvider: v.optional(v.string()),
    reason: v.optional(v.string()),
  },
  returns: v.object({ status: statusValidator }),
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const row = await findRoute(ctx, args.routeKey)
    if (!row || row.activeLeaseToken !== args.leaseToken) return { status: 'late' as const }
    const supplied = JSON.parse(args.receiptJson) as Record<string, unknown>
    if (typeof supplied.safe !== 'boolean' ||
      !(supplied.cost === null || (typeof supplied.cost === 'number' && Number.isFinite(supplied.cost) && supplied.cost >= 0)) ||
      (supplied.reason !== undefined && supplied.reason !== null &&
        (typeof supplied.reason !== 'string' || supplied.reason.length > 256)) ||
      (supplied.actualModelId !== undefined &&
        (typeof supplied.actualModelId !== 'string' || supplied.actualModelId.length > 256)) ||
      (supplied.actualProvider !== undefined &&
        (typeof supplied.actualProvider !== 'string' || supplied.actualProvider.length > 128))) {
      throw new Error('overlay_free_invalid_receipt')
    }
    const receiptJson = JSON.stringify({
      safe: supplied.safe,
      cost: supplied.cost,
      ...(typeof supplied.reason === 'string' ? { reason: supplied.reason } : {}),
      ...(typeof supplied.actualModelId === 'string' ? { actualModelId: supplied.actualModelId } : {}),
      ...(typeof supplied.actualProvider === 'string' ? { actualProvider: supplied.actualProvider } : {}),
    })
    const patch = {
      latestReceiptAt: args.now,
      latestReceiptJson: receiptJson,
      latestActualModelId: typeof supplied.actualModelId === 'string' ? supplied.actualModelId : undefined,
      latestActualProvider: typeof supplied.actualProvider === 'string' ? supplied.actualProvider : undefined,
      activeLeaseToken: undefined,
      activeLeaseExpiresAt: undefined,
      updatedAt: args.now,
    }
    if (row.quarantineReason) {
      await ctx.db.patch(row._id, patch)
      return { status: 'settled' as const }
    }
    const receiptMatches = supplied.cost === 0 &&
      (row.transport !== 'gateway' || (
        supplied.actualModelId === row.modelId && supplied.actualProvider === row.provider
      ))
    if (!supplied.safe || !receiptMatches) {
      await ctx.db.patch(row._id, {
        ...patch,
        quarantineReason: typeof supplied.reason === 'string' ? supplied.reason : args.reason || 'unsafe receipt',
        quarantineAt: args.now,
      })
      return { status: 'settled' as const }
    }
    await ctx.db.patch(row._id, patch)
    return { status: 'settled' as const }
  },
})

export const cooldownByServer = mutation({
  args: {
    serverSecret: v.string(),
    routeKey: ROUTE_KEY,
    leaseToken: v.string(),
    now: v.number(),
    cooldownUntil: v.number(),
    reason: v.string(),
  },
  returns: v.object({ status: statusValidator }),
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const row = await findRoute(ctx, args.routeKey)
    if (!row || row.activeLeaseToken !== args.leaseToken) return { status: 'late' as const }
    if (row.quarantineReason) return { status: 'quarantined' as const }
    await ctx.db.patch(row._id, {
      cooldownUntil: Math.max(args.cooldownUntil, args.now),
      activeLeaseToken: undefined,
      activeLeaseExpiresAt: undefined,
      updatedAt: args.now,
    })
    return { status: 'settled' as const }
  },
})

export const acquireRefreshLockByServer = mutation({
  args: {
    serverSecret: v.string(),
    leaseToken: v.string(),
    now: v.number(),
    leaseMs: v.number(),
    retryMs: v.number(),
  },
  returns: v.union(v.object({ leaseToken: v.string(), generation: v.number() }), v.null()),
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const current = await findLock(ctx)
    if (current && (current.leaseExpiresAt > args.now || current.retryAfter > args.now)) return null
    const generation = (current?.generation ?? 0) + 1
    const value = {
      key: LOCK_KEY,
      leaseToken: args.leaseToken,
      leaseExpiresAt: args.now + Math.min(args.leaseMs, 5 * 60 * 1000),
      retryAfter: args.now + Math.max(args.retryMs, 5 * 60 * 1000),
      generation,
      updatedAt: args.now,
    }
    if (current) await ctx.db.patch(current._id, value)
    else await ctx.db.insert('overlayFreeRefreshLocks', value)
    const rows = await ctx.db.query('overlayFreeRoutes').collect()
    for (const row of rows) {
      await ctx.db.patch(row._id, {
        catalogExpiresAt: 0,
        canaryExpiresAt: undefined,
        updatedAt: args.now,
      })
    }
    return { leaseToken: args.leaseToken, generation }
  },
})

export const releaseRefreshLockByServer = mutation({
  args: {
    serverSecret: v.string(),
    leaseToken: v.string(),
    now: v.number(),
    success: v.boolean(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const current = await findLock(ctx)
    if (!current || current.leaseToken !== args.leaseToken) return null
    await ctx.db.patch(current._id, {
      leaseExpiresAt: args.now,
      retryAfter: args.success ? args.now + 60 * 60 * 1000 : Math.max(current.retryAfter, args.now + 5 * 60 * 1000),
      updatedAt: args.now,
    })
    return null
  },
})

export const publishByServer = mutation({
  args: {
    serverSecret: v.string(),
    generation: v.number(),
    refreshToken: v.string(),
    preserveUnlisted: v.optional(v.boolean()),
    preserveTransports: v.optional(v.array(routeTransport)),
    now: v.number(),
    routes: v.array(routeInput),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const activeLock = await findLock(ctx)
    if (!activeLock || activeLock.generation !== args.generation ||
      activeLock.leaseToken !== args.refreshToken || activeLock.leaseExpiresAt <= args.now) return null
    const existing = await ctx.db.query('overlayFreeRoutes').collect()
    const incoming = new Map(args.routes.map((route) => [route.routeKey, route]))
    for (const old of existing) {
      if (old.generation > args.generation || incoming.has(old.routeKey)) continue
      if ((args.preserveUnlisted && old.transport === 'gateway') ||
        args.preserveTransports?.includes(old.transport)) continue
      await ctx.db.patch(old._id, {
        catalogExpiresAt: 0,
        quarantineReason: old.activeLeaseToken ? old.quarantineReason || 'disappeared' : old.quarantineReason,
        quarantineAt: old.activeLeaseToken ? old.quarantineAt ?? args.now : old.quarantineAt,
        generation: args.generation,
        updatedAt: args.now,
      })
    }
    for (const route of args.routes) {
      const old = existing.find((row) => row.routeKey === route.routeKey)
      if (old && old.generation > args.generation) continue
      const preservedQuarantine = old?.quarantineReason
      const value = {
        ...route,
        quarantineReason: preservedQuarantine,
        quarantineAt: old?.quarantineAt,
        cooldownUntil: old?.cooldownUntil,
        latestReceiptAt: old?.latestReceiptAt,
        latestReceiptJson: old?.latestReceiptJson,
        latestActualModelId: old?.latestActualModelId,
        latestActualProvider: old?.latestActualProvider,
        activeLeaseToken: old?.activeLeaseToken,
        activeLeaseExpiresAt: old?.activeLeaseExpiresAt,
        updatedAt: args.now,
      }
      if (old) await ctx.db.patch(old._id, value)
      else await ctx.db.insert('overlayFreeRoutes', value)
    }
    return null
  },
})

export const invalidateGenerationByServer = mutation({
  args: { serverSecret: v.string(), generation: v.number(), refreshToken: v.string(), now: v.number() },
  returns: v.null(),
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const lock = await findLock(ctx)
    if (!lock || lock.generation !== args.generation || lock.leaseToken !== args.refreshToken || lock.leaseExpiresAt <= args.now) return null
    const activeLock = await findLock(ctx)
    if (!activeLock || activeLock.generation !== args.generation) return null
    const rows = await ctx.db.query('overlayFreeRoutes').collect()
    for (const row of rows) {
      if (row.generation > args.generation) continue
      await ctx.db.patch(row._id, {
        catalogExpiresAt: 0,
        generation: args.generation,
        updatedAt: args.now,
      })
    }
    return null
  },
})

export const listInternal = internalQuery({
  args: { now: v.number() },
  returns: v.array(routeValidator),
  handler: async (ctx, args) => {
    const rows = await ctx.db.query('overlayFreeRoutes').collect()
    return rows.filter((row) => row.catalogExpiresAt > args.now && !row.quarantineReason).map(routeWithoutLease)
  },
})

export const clearExpiredLeasesInternal = internalMutation({
  args: { now: v.number() },
  returns: v.number(),
  handler: async (ctx, args) => {
    const rows = await ctx.db.query('overlayFreeRoutes').collect()
    let count = 0
    for (const row of rows) {
      if (!row.activeLeaseToken || row.activeLeaseExpiresAt === undefined || row.activeLeaseExpiresAt > args.now) continue
      await ctx.db.patch(row._id, {
        quarantineReason: row.quarantineReason || 'missing receipt',
        quarantineAt: row.quarantineAt ?? args.now,
        activeLeaseToken: undefined,
        activeLeaseExpiresAt: undefined,
        updatedAt: args.now,
      })
      count += 1
    }
    return count
  },
})
