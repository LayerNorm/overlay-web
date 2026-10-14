import { v } from 'convex/values'
import { mutation, internalMutation } from '../_generated/server'
import { requireServerSecret } from '../lib/auth'

// Personal plans are gone (plans belong to workspaces). What is left here is
// billing-provider webhook bookkeeping and the daily usage cleanup; the module keeps its name so the function paths
// the app calls do not change.

// Reset daily usage — internal only (called by scheduled job)
export const resetDailyUsage = internalMutation({
  args: { date: v.string() },
  handler: async (ctx, { date }) => {
    const usageRecords = await ctx.db
      .query('dailyUsage')
      .filter((q) => q.lt(q.field('date'), date))
      .collect()

    await Promise.all(usageRecords.map((record) => ctx.db.delete(record._id)))

    return { deleted: usageRecords.length }
  }
})

// Webhook event deduplication. Returns true if this is the first time we've
// seen the event; returns false if it's a duplicate (and the caller should
// skip its side-effects entirely). Also enforces a freshness window — events
// older than MAX_EVENT_AGE_MS are rejected as potential replays.
const MAX_EVENT_AGE_MS = 7 * 24 * 60 * 60 * 1000 // 7 days

export const recordWebhookEventIfNew = internalMutation({
  args: {
    provider: v.string(),
    eventId: v.string(),
    eventType: v.optional(v.string()),
    eventCreatedMs: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    if (
      typeof args.eventCreatedMs === 'number' &&
      Number.isFinite(args.eventCreatedMs) &&
      args.eventCreatedMs > 0 &&
      Date.now() - args.eventCreatedMs > MAX_EVENT_AGE_MS
    ) {
      return { accepted: false as const, reason: 'event_too_old' as const }
    }
    const existing = await ctx.db
      .query('processedWebhookEvents')
      .withIndex('by_provider_eventId', (q) =>
        q.eq('provider', args.provider).eq('eventId', args.eventId),
      )
      .first()
    if (existing) {
      return { accepted: false as const, reason: 'duplicate' as const }
    }
    await ctx.db.insert('processedWebhookEvents', {
      provider: args.provider,
      eventId: args.eventId,
      eventType: args.eventType,
      status: 'processed',
      attempt: 1,
      updatedAt: Date.now(),
      processedAt: Date.now(),
    })
    return { accepted: true as const }
  },
})

export const reserveProviderEventByServer = mutation({
  args: {
    serverSecret: v.string(),
    eventId: v.string(),
    eventType: v.string(),
    payloadHash: v.string(),
    provider: v.string(),
  },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const existing = await ctx.db
      .query('processedWebhookEvents')
      .withIndex('by_provider_eventId', (q) =>
        q.eq('provider', args.provider).eq('eventId', args.eventId))
      .unique()
    if (existing) {
      if (existing.payloadHash && existing.payloadHash !== args.payloadHash) {
        throw new Error('billing event payload hash mismatch')
      }
      const processed = existing.status === 'processed' || !existing.status
      if (processed || existing.status === 'processing') {
        return { status: 'duplicate' as const, processed }
      }
      const attempt = (existing.attempt ?? 1) + 1
      await ctx.db.patch(existing._id, {
        attempt,
        errorMessage: undefined,
        eventType: args.eventType,
        payloadHash: args.payloadHash,
        status: 'processing',
        updatedAt: Date.now(),
      })
      return { status: 'acquired' as const, attempt }
    }
    const now = Date.now()
    await ctx.db.insert('processedWebhookEvents', {
      provider: args.provider,
      eventId: args.eventId,
      eventType: args.eventType,
      payloadHash: args.payloadHash,
      status: 'processing',
      attempt: 1,
      processedAt: now,
      updatedAt: now,
    })
    return { status: 'acquired' as const, attempt: 1 }
  },
})

export const markProviderEventProcessedByServer = mutation({
  args: { serverSecret: v.string(), eventId: v.string(), provider: v.string() },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const existing = await ctx.db
      .query('processedWebhookEvents')
      .withIndex('by_provider_eventId', (q) =>
        q.eq('provider', args.provider).eq('eventId', args.eventId))
      .unique()
    if (!existing) throw new Error('billing provider event not found')
    const now = Date.now()
    await ctx.db.patch(existing._id, {
      errorMessage: undefined,
      status: 'processed',
      processedAt: now,
      updatedAt: now,
    })
  },
})

export const markProviderEventFailedByServer = mutation({
  args: { serverSecret: v.string(), error: v.string(), eventId: v.string(), provider: v.string() },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const existing = await ctx.db
      .query('processedWebhookEvents')
      .withIndex('by_provider_eventId', (q) =>
        q.eq('provider', args.provider).eq('eventId', args.eventId))
      .unique()
    if (!existing) throw new Error('billing provider event not found')
    await ctx.db.patch(existing._id, {
      errorMessage: args.error.slice(0, 2000),
      status: 'failed',
      updatedAt: Date.now(),
    })
  },
})

export const pruneOldWebhookEvents = internalMutation({
  args: {},
  handler: async (ctx) => {
    const cutoff = Date.now() - MAX_EVENT_AGE_MS
    const old = await ctx.db
      .query('processedWebhookEvents')
      .withIndex('by_processedAt', (q) => q.lt('processedAt', cutoff))
      .take(500)
    await Promise.all(old.map((row) => ctx.db.delete(row._id)))
    return { deleted: old.length }
  },
})
