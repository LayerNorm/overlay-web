import { v } from 'convex/values'
import { mutation, query } from '../_generated/server'
import { requireAccessToken, requireServerSecret, validateServerSecret } from '../lib/auth'

const eventTypesValidator = v.array(v.string())

const WEBHOOK_EVENT_TYPES = new Set([
  'chat.completed',
  'chat.failed',
  'automation.finished',
  'automation.failed',
])

function normalizeEvents(events: string[]): string[] {
  const normalized = events
    .map((event) => event.trim())
    .filter((event) => WEBHOOK_EVENT_TYPES.has(event))
  if (normalized.length === 0) {
    throw new Error('At least one supported webhook event is required')
  }
  return normalized
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

function scrubSubscription(row: {
  _id: import('../_generated/dataModel').Id<'webhookSubscriptions'>
  url: string
  events: string[]
  enabled: boolean
  description?: string
  createdAt: number
  updatedAt: number
}) {
  return {
    _id: row._id,
    url: row.url,
    events: row.events,
    enabled: row.enabled,
    description: row.description,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

export const list = query({
  args: {
    userId: v.string(),
    workspaceId: v.optional(v.string()),
    accessToken: v.optional(v.string()),
    serverSecret: v.optional(v.string()),
  },
  returns: v.array(v.object({
    _id: v.id('webhookSubscriptions'),
    url: v.string(),
    events: eventTypesValidator,
    enabled: v.boolean(),
    description: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })),
  handler: async (ctx, args) => {
    try {
      await authorizeUserAccess(args)
    } catch {
      return []
    }

    const rows = await ctx.db
      .query('webhookSubscriptions')
      .withIndex('by_userId', (q) => q.eq('userId', args.userId))
      .order('desc')
      .collect()

    return rows
      .filter((sub) => (args.workspaceId !== undefined ? sub.workspaceId === args.workspaceId : true))
      .map(scrubSubscription)
  },
})

export const create = mutation({
  args: {
    userId: v.string(),
    workspaceId: v.optional(v.string()),
    accessToken: v.optional(v.string()),
    serverSecret: v.optional(v.string()),
    url: v.string(),
    events: eventTypesValidator,
    description: v.optional(v.string()),
    enabled: v.optional(v.boolean()),
  },
  returns: v.object({
    id: v.id('webhookSubscriptions'),
    secret: v.string(),
  }),
  handler: async (ctx, args) => {
    await authorizeUserAccess(args)

    const now = Date.now()
    const secret = crypto.randomUUID()
    const id = await ctx.db.insert('webhookSubscriptions', {
      userId: args.userId,
      workspaceId: args.workspaceId,
      url: args.url.trim(),
      secret,
      events: normalizeEvents(args.events),
      enabled: args.enabled ?? true,
      description: args.description?.trim() || undefined,
      createdAt: now,
      updatedAt: now,
    })

    return { id, secret }
  },
})

export const update = mutation({
  args: {
    userId: v.string(),
    workspaceId: v.optional(v.string()),
    accessToken: v.optional(v.string()),
    serverSecret: v.optional(v.string()),
    subscriptionId: v.id('webhookSubscriptions'),
    url: v.optional(v.string()),
    events: v.optional(eventTypesValidator),
    description: v.optional(v.string()),
    enabled: v.optional(v.boolean()),
  },
  returns: v.object({ updated: v.boolean() }),
  handler: async (ctx, args) => {
    await authorizeUserAccess(args)

    const existing = await ctx.db.get(args.subscriptionId)
    if (!existing || existing.userId !== args.userId || (args.workspaceId !== undefined && existing.workspaceId !== args.workspaceId)) {
      return { updated: false }
    }

    const patch: {
      url?: string
      events?: string[]
      description?: string
      enabled?: boolean
      updatedAt: number
    } = {
      updatedAt: Date.now(),
    }

    if (args.url !== undefined) patch.url = args.url.trim()
    if (args.events !== undefined) patch.events = normalizeEvents(args.events)
    if (args.description !== undefined) patch.description = args.description.trim() || undefined
    if (args.enabled !== undefined) patch.enabled = args.enabled

    await ctx.db.patch(args.subscriptionId, patch)
    return { updated: true }
  },
})

export const rotateSecretByServer = mutation({
  args: {
    serverSecret: v.string(),
    subscriptionId: v.id('webhookSubscriptions'),
    userId: v.string(),
    workspaceId: v.optional(v.string()),
  },
  returns: v.object({ secret: v.union(v.string(), v.null()) }),
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const existing = await ctx.db.get(args.subscriptionId)
    if (!existing || existing.userId !== args.userId) return { secret: null }
    if (args.workspaceId !== undefined && existing.workspaceId !== args.workspaceId) return { secret: null }
    const secret = crypto.randomUUID()
    await ctx.db.patch(args.subscriptionId, { secret, updatedAt: Date.now() })
    return { secret }
  },
})

export const remove = mutation({
  args: {
    userId: v.string(),
    workspaceId: v.optional(v.string()),
    accessToken: v.optional(v.string()),
    serverSecret: v.optional(v.string()),
    subscriptionId: v.id('webhookSubscriptions'),
  },
  returns: v.object({ removed: v.boolean() }),
  handler: async (ctx, args) => {
    await authorizeUserAccess(args)

    const existing = await ctx.db.get(args.subscriptionId)
    if (!existing || existing.userId !== args.userId || (args.workspaceId !== undefined && existing.workspaceId !== args.workspaceId)) {
      return { removed: false }
    }

    await ctx.db.delete(args.subscriptionId)
    return { removed: true }
  },
})

export const createByServer = mutation({
  args: {
    serverSecret: v.string(),
    userId: v.string(),
    workspaceId: v.optional(v.string()),
    url: v.string(),
    events: eventTypesValidator,
    description: v.optional(v.string()),
    enabled: v.optional(v.boolean()),
    secret: v.optional(v.string()),
  },
  returns: v.id('webhookSubscriptions'),
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)

    const now = Date.now()
    const secret = args.secret?.trim() || crypto.randomUUID()
    return await ctx.db.insert('webhookSubscriptions', {
      userId: args.userId,
      workspaceId: args.workspaceId,
      url: args.url.trim(),
      secret,
      events: args.events,
      enabled: args.enabled ?? true,
      description: args.description?.trim() || undefined,
      createdAt: now,
      updatedAt: now,
    })
  },
})

export const listByServer = query({
  args: {
    serverSecret: v.string(),
    userId: v.string(),
    workspaceId: v.optional(v.string()),
  },
  returns: v.array(v.object({
    _id: v.id('webhookSubscriptions'),
    url: v.string(),
    events: eventTypesValidator,
    enabled: v.boolean(),
    description: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })),
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)

    const rows = await ctx.db
      .query('webhookSubscriptions')
      .withIndex('by_userId', (q) => q.eq('userId', args.userId))
      .collect()

    return rows
      .filter((sub) => (args.workspaceId !== undefined ? sub.workspaceId === args.workspaceId : true))
      .map((row) => ({
        _id: row._id,
        url: row.url,
        events: row.events,
        enabled: row.enabled,
        description: row.description,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      }))
  },
})

export const removeByServer = mutation({
  args: {
    serverSecret: v.string(),
    userId: v.string(),
    subscriptionId: v.id('webhookSubscriptions'),
    workspaceId: v.optional(v.string()),
  },
  returns: v.object({ removed: v.boolean() }),
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)

    const existing = await ctx.db.get(args.subscriptionId)
    if (!existing || existing.userId !== args.userId) {
      return { removed: false }
    }
    if (args.workspaceId !== undefined && existing.workspaceId !== args.workspaceId) {
      return { removed: false }
    }

    await ctx.db.delete(args.subscriptionId)
    return { removed: true }
  },
})
