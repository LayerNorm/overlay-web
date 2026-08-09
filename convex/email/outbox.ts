import { v } from 'convex/values'
import {
  internalMutation,
  internalQuery,
  mutation,
  type MutationCtx,
} from '../_generated/server'
import type { Id } from '../_generated/dataModel'
import { requireServerSecret } from '../lib/auth'

const deliveryStatus = v.union(
  v.literal('retry'),
  v.literal('dead_letter'),
  v.literal('lost_lease'),
)

export const appendByServer = mutation({
  args: {
    serverSecret: v.string(),
    availableAt: v.optional(v.number()),
    dedupeKey: v.optional(v.string()),
    eventId: v.string(),
    maxAttempts: v.optional(v.number()),
    payloadJson: v.string(),
    topic: v.string(),
  },
  returns: v.string(),
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const duplicate = args.dedupeKey
      ? await ctx.db
          .query('emailOutbox')
          .withIndex('by_dedupeKey', (q) => q.eq('dedupeKey', args.dedupeKey))
          .unique()
      : await ctx.db
          .query('emailOutbox')
          .withIndex('by_eventId', (q) => q.eq('eventId', args.eventId))
          .unique()
    if (duplicate) return duplicate.eventId

    JSON.parse(args.payloadJson)
    const now = Date.now()
    await ctx.db.insert('emailOutbox', {
      attempts: 0,
      availableAt: args.availableAt ?? now,
      createdAt: now,
      dedupeKey: normalizeOptional(args.dedupeKey),
      eventId: required(args.eventId, 'eventId'),
      maxAttempts: normalizeMaxAttempts(args.maxAttempts),
      payloadJson: args.payloadJson,
      status: 'pending',
      topic: required(args.topic, 'topic'),
      updatedAt: now,
    })
    return args.eventId
  },
})

export const claimByServer = mutation({
  args: {
    serverSecret: v.string(),
    leaseMs: v.number(),
    now: v.optional(v.number()),
    workerId: v.string(),
  },
  returns: v.union(v.null(), v.object({
    attempts: v.number(),
    eventId: v.string(),
    maxAttempts: v.number(),
    payloadJson: v.string(),
    topic: v.string(),
  })),
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    return await claimOne(ctx, {
      leaseMs: args.leaseMs,
      now: args.now ?? Date.now(),
      workerId: args.workerId,
    })
  },
})

export const markPublishedByServer = mutation({
  args: { serverSecret: v.string(), eventId: v.string(), workerId: v.string() },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const row = await byEventId(ctx, args.eventId)
    if (!row || row.status !== 'publishing' || row.leaseOwner !== args.workerId) return false
    const now = Date.now()
    await ctx.db.patch(row._id, {
      leaseExpiresAt: undefined,
      leaseOwner: undefined,
      publishedAt: now,
      status: 'published',
      updatedAt: now,
    })
    return true
  },
})

export const markFailedByServer = mutation({
  args: {
    serverSecret: v.string(),
    error: v.string(),
    eventId: v.string(),
    now: v.optional(v.number()),
    retryDelayMs: v.number(),
    workerId: v.string(),
  },
  returns: deliveryStatus,
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    return await markFailure(ctx, {
      error: args.error,
      eventId: args.eventId,
      now: args.now ?? Date.now(),
      retryDelayMs: args.retryDelayMs,
      workerId: args.workerId,
    })
  },
})

export const renewLeaseByServer = mutation({
  args: {
    serverSecret: v.string(),
    eventId: v.string(),
    leaseMs: v.number(),
    now: v.optional(v.number()),
    workerId: v.string(),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const row = await byEventId(ctx, args.eventId)
    if (!row || row.status !== 'publishing' || row.leaseOwner !== args.workerId) return false
    const now = args.now ?? Date.now()
    await ctx.db.patch(row._id, {
      leaseExpiresAt: now + normalizeLeaseMs(args.leaseMs),
      updatedAt: now,
    })
    return true
  },
})

export const recoverExpiredLeasesByServer = mutation({
  args: { serverSecret: v.string(), limit: v.optional(v.number()), now: v.optional(v.number()) },
  returns: v.object({ deadLettered: v.number(), requeued: v.number() }),
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    return await recoverExpired(ctx, args.now ?? Date.now(), args.limit)
  },
})

export const getSuppressionByServer = mutation({
  args: { serverSecret: v.string(), userId: v.string() },
  returns: v.any(),
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    return await ctx.db
      .query('emailSuppressions')
      .withIndex('by_userId', (q) => q.eq('userId', args.userId))
      .unique()
  },
})

export const suppressByServer = mutation({
  args: {
    serverSecret: v.string(),
    reason: v.union(
      v.literal('bounce'),
      v.literal('complaint'),
      v.literal('manual'),
      v.literal('provider_suppression'),
    ),
    source: v.union(v.literal('admin'), v.literal('provider')),
    suppressedAt: v.number(),
    userId: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const existing = await ctx.db
      .query('emailSuppressions')
      .withIndex('by_userId', (q) => q.eq('userId', args.userId))
      .unique()
    const values = {
      reason: args.reason,
      source: args.source,
      suppressedAt: args.suppressedAt,
      updatedAt: Date.now(),
    }
    if (existing) await ctx.db.patch(existing._id, values)
    else await ctx.db.insert('emailSuppressions', { ...values, userId: args.userId })
    return null
  },
})

export const clearSuppressionByServer = mutation({
  args: { serverSecret: v.string(), userId: v.string() },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const existing = await ctx.db
      .query('emailSuppressions')
      .withIndex('by_userId', (q) => q.eq('userId', args.userId))
      .unique()
    if (!existing) return false
    await ctx.db.delete(existing._id)
    return true
  },
})

export const claimDueInternal = internalMutation({
  args: { limit: v.optional(v.number()), now: v.number(), workerId: v.string() },
  returns: v.array(v.id('emailOutbox')),
  handler: async (ctx, args) => {
    await recoverExpired(ctx, args.now, 100)
    const limit = Math.min(Math.max(args.limit ?? 25, 1), 100)
    const rows = await ctx.db
      .query('emailOutbox')
      .withIndex('by_status_availableAt', (q) =>
        q.eq('status', 'pending').lte('availableAt', args.now),
      )
      .take(limit)
    const ids: Id<'emailOutbox'>[] = []
    for (const row of rows) {
      await ctx.db.patch(row._id, {
        attempts: row.attempts + 1,
        leaseExpiresAt: args.now + 60_000,
        leaseOwner: args.workerId,
        status: 'publishing',
        updatedAt: args.now,
      })
      ids.push(row._id)
    }
    return ids
  },
})

export const getDeliveryInternal = internalQuery({
  args: { outboxId: v.id('emailOutbox') },
  returns: v.any(),
  handler: async (ctx, args) => {
    const outbox = await ctx.db.get(args.outboxId)
    if (!outbox || outbox.status !== 'publishing') return null
    const payload = JSON.parse(outbox.payloadJson) as {
      attributes?: unknown
      name?: unknown
      userId?: unknown
    }
    const userId = typeof payload.userId === 'string' ? payload.userId : ''
    if (!userId) return null
    const attributes = payload.attributes && typeof payload.attributes === 'object' && !Array.isArray(payload.attributes)
      ? payload.attributes as Record<string, unknown>
      : {}
    const invitationRecipient = payload.name === 'workspace.invitation_sent'
      && typeof attributes.invitedEmail === 'string'
      ? attributes.invitedEmail.trim().toLowerCase()
      : ''
    const [user, suppression] = await Promise.all([
      ctx.db.query('subscriptions').withIndex('by_userId', (q) => q.eq('userId', userId)).unique(),
      invitationRecipient
        ? Promise.resolve(null)
        : ctx.db.query('emailSuppressions').withIndex('by_userId', (q) => q.eq('userId', userId)).unique(),
    ])
    return {
      attempts: outbox.attempts,
      eventId: outbox.eventId,
      outboxId: outbox._id,
      payloadJson: outbox.payloadJson,
      recipient: invitationRecipient || user?.email,
      suppression: suppression
        ? { reason: suppression.reason, source: suppression.source }
        : undefined,
    }
  },
})

export const markDeliveryPublishedInternal = internalMutation({
  args: {
    outboxId: v.id('emailOutbox'),
    action: v.string(),
    outcome: v.union(v.literal('success'), v.literal('denied')),
    provider: v.string(),
    providerMessageId: v.optional(v.string()),
    template: v.string(),
    userId: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.outboxId)
    if (!row || row.status !== 'publishing') return null
    const now = Date.now()
    await ctx.db.patch(row._id, {
      leaseExpiresAt: undefined,
      leaseOwner: undefined,
      providerMessageId: args.providerMessageId,
      publishedAt: now,
      status: 'published',
      updatedAt: now,
    })
    await appendAudit(ctx, {
      action: args.action,
      eventId: `email:${row.eventId}:${args.action}`,
      metadata: {
        attempt: row.attempts,
        provider: args.provider,
        providerMessageId: args.providerMessageId,
        template: args.template,
      },
      outcome: args.outcome,
      outboxEventId: row.eventId,
      userId: args.userId,
    })
    return null
  },
})

export const markDeliveryFailedInternal = internalMutation({
  args: {
    error: v.string(),
    outboxId: v.id('emailOutbox'),
    provider: v.string(),
    suppress: v.boolean(),
    template: v.string(),
    userId: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.outboxId)
    if (!row || row.status !== 'publishing') return null
    const now = Date.now()
    if (args.suppress) {
      const existing = await ctx.db
        .query('emailSuppressions')
        .withIndex('by_userId', (q) => q.eq('userId', args.userId))
        .unique()
      const values = {
        reason: 'provider_suppression' as const,
        source: 'provider' as const,
        suppressedAt: now,
        updatedAt: now,
      }
      if (existing) await ctx.db.patch(existing._id, values)
      else await ctx.db.insert('emailSuppressions', { ...values, userId: args.userId })
    }
    const terminal = row.attempts >= row.maxAttempts
    await ctx.db.patch(row._id, terminal
      ? {
          deadLetteredAt: now,
          lastError: truncate(args.error),
          leaseExpiresAt: undefined,
          leaseOwner: undefined,
          status: 'dead_letter',
          updatedAt: now,
        }
      : {
          availableAt: now + retryDelayMs(row.attempts),
          lastError: truncate(args.error),
          leaseExpiresAt: undefined,
          leaseOwner: undefined,
          status: 'pending',
          updatedAt: now,
        })
    await appendAudit(ctx, {
      action: 'email.delivery.failed',
      eventId: `email:${row.eventId}:failed:${row.attempts}`,
      metadata: { attempt: row.attempts, provider: args.provider, template: args.template },
      outcome: 'failure',
      outboxEventId: row.eventId,
      userId: args.userId,
    })
    return null
  },
})

async function claimOne(ctx: MutationCtx, args: { leaseMs: number; now: number; workerId: string }) {
  const row = await ctx.db
    .query('emailOutbox')
    .withIndex('by_status_availableAt', (q) => q.eq('status', 'pending').lte('availableAt', args.now))
    .first()
  if (!row) return null
  await ctx.db.patch(row._id, {
    attempts: row.attempts + 1,
    leaseExpiresAt: args.now + normalizeLeaseMs(args.leaseMs),
    leaseOwner: required(args.workerId, 'workerId'),
    status: 'publishing',
    updatedAt: args.now,
  })
  return {
    attempts: row.attempts + 1,
    eventId: row.eventId,
    maxAttempts: row.maxAttempts,
    payloadJson: row.payloadJson,
    topic: row.topic,
  }
}

async function markFailure(ctx: MutationCtx, args: {
  error: string
  eventId: string
  now: number
  retryDelayMs: number
  workerId: string
}): Promise<'retry' | 'dead_letter' | 'lost_lease'> {
  const row = await byEventId(ctx, args.eventId)
  if (!row || row.status !== 'publishing' || row.leaseOwner !== args.workerId) return 'lost_lease'
  const terminal = row.attempts >= row.maxAttempts
  await ctx.db.patch(row._id, terminal
    ? {
        deadLetteredAt: args.now,
        lastError: truncate(args.error),
        leaseExpiresAt: undefined,
        leaseOwner: undefined,
        status: 'dead_letter',
        updatedAt: args.now,
      }
    : {
        availableAt: args.now + Math.max(0, args.retryDelayMs),
        lastError: truncate(args.error),
        leaseExpiresAt: undefined,
        leaseOwner: undefined,
        status: 'pending',
        updatedAt: args.now,
      })
  return terminal ? 'dead_letter' : 'retry'
}

async function recoverExpired(ctx: MutationCtx, now: number, requestedLimit?: number) {
  const limit = Math.min(Math.max(requestedLimit ?? 100, 1), 1_000)
  const rows = await ctx.db
    .query('emailOutbox')
    .withIndex('by_status_leaseExpiresAt', (q) =>
      q.eq('status', 'publishing').lte('leaseExpiresAt', now),
    )
    .take(limit)
  let deadLettered = 0
  let requeued = 0
  for (const row of rows) {
    if (row.attempts >= row.maxAttempts) {
      await ctx.db.patch(row._id, {
        deadLetteredAt: now,
        lastError: row.lastError ?? 'Outbox publisher lease expired',
        leaseExpiresAt: undefined,
        leaseOwner: undefined,
        status: 'dead_letter',
        updatedAt: now,
      })
      deadLettered += 1
    } else {
      await ctx.db.patch(row._id, {
        availableAt: now,
        lastError: row.lastError ?? 'Outbox publisher lease expired',
        leaseExpiresAt: undefined,
        leaseOwner: undefined,
        status: 'pending',
        updatedAt: now,
      })
      requeued += 1
    }
  }
  return { deadLettered, requeued }
}

async function byEventId(ctx: MutationCtx, eventId: string) {
  return await ctx.db.query('emailOutbox').withIndex('by_eventId', (q) => q.eq('eventId', eventId)).unique()
}

async function appendAudit(ctx: MutationCtx, args: {
  action: string
  eventId: string
  metadata: Record<string, unknown>
  outcome: 'success' | 'denied' | 'failure'
  outboxEventId: string
  userId: string
}) {
  const existing = await ctx.db.query('auditEvents').withIndex('by_eventId', (q) => q.eq('eventId', args.eventId)).unique()
  if (existing) return
  await ctx.db.insert('auditEvents', {
    action: args.action,
    actorType: 'system',
    actorUserId: args.userId,
    createdAt: Date.now(),
    eventId: args.eventId,
    metadataJson: JSON.stringify(args.metadata),
    outcome: args.outcome,
    resourceId: args.outboxEventId,
    resourceType: 'transactional_email',
  })
}

function normalizeLeaseMs(value: number): number {
  if (!Number.isFinite(value) || value < 1_000) throw new Error('leaseMs must be at least 1000')
  return Math.min(value, 60 * 60_000)
}

function normalizeMaxAttempts(value = 8): number {
  return Number.isInteger(value) ? Math.min(Math.max(value, 1), 100) : 8
}

function normalizeOptional(value: string | undefined): string | undefined {
  const normalized = value?.trim()
  return normalized || undefined
}

function required(value: string, label: string): string {
  const normalized = value.trim()
  if (!normalized) throw new Error(`${label} is required`)
  return normalized
}

function retryDelayMs(attempt: number): number {
  return Math.min(12 * 60 * 60_000, 60_000 * 5 ** Math.max(0, attempt - 1))
}

function truncate(value: string): string {
  return value.slice(0, 4_096)
}
