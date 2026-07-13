import { v } from 'convex/values'
import { mutation, query } from '../_generated/server'
import { requireServerSecret } from '../lib/auth'

const role = v.union(
  v.literal('admin'),
  v.literal('auditor'),
  v.literal('billing_admin'),
  v.literal('support'),
)

export const getPrincipalByServer = query({
  args: { serverSecret: v.string(), userId: v.string() },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    return await ctx.db
      .query('administrativePrincipals')
      .withIndex('by_userId', (q) => q.eq('userId', args.userId))
      .unique()
  },
})

export const listPrincipalsByServer = query({
  args: { serverSecret: v.string() },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    return await ctx.db.query('administrativePrincipals').withIndex('by_createdAt').order('desc').collect()
  },
})

export const grantPrincipalByServer = mutation({
  args: {
    serverSecret: v.string(),
    grantedBy: v.string(),
    reason: v.optional(v.string()),
    role,
    userId: v.string(),
  },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const existing = await ctx.db
      .query('administrativePrincipals')
      .withIndex('by_userId', (q) => q.eq('userId', args.userId))
      .unique()
    const now = Date.now()
    const values = {
      grantedBy: args.grantedBy,
      reason: args.reason,
      role: args.role,
      updatedAt: now,
      revokedAt: undefined,
      revokedBy: undefined,
    }
    if (existing) {
      await ctx.db.patch(existing._id, values)
      return { ...existing, ...values }
    }
    const id = await ctx.db.insert('administrativePrincipals', {
      ...values,
      userId: args.userId,
      createdAt: now,
    })
    return await ctx.db.get(id)
  },
})

export const revokePrincipalByServer = mutation({
  args: { serverSecret: v.string(), revokedBy: v.string(), userId: v.string() },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const existing = await ctx.db
      .query('administrativePrincipals')
      .withIndex('by_userId', (q) => q.eq('userId', args.userId))
      .unique()
    if (!existing) return { revoked: false }
    const now = Date.now()
    await ctx.db.patch(existing._id, {
      revokedAt: existing.revokedAt ?? now,
      revokedBy: args.revokedBy,
      updatedAt: now,
    })
    return { revoked: true }
  },
})

export const appendAuditByServer = mutation({
  args: {
    serverSecret: v.string(),
    eventId: v.string(),
    actorType: v.union(v.literal('user'), v.literal('api_key'), v.literal('service'), v.literal('system')),
    actorUserId: v.optional(v.string()),
    actorApiKeyId: v.optional(v.string()),
    action: v.string(),
    resourceType: v.string(),
    resourceId: v.optional(v.string()),
    outcome: v.union(v.literal('success'), v.literal('denied'), v.literal('failure')),
    requestId: v.optional(v.string()),
    ipAddress: v.optional(v.string()),
    metadataJson: v.string(),
    createdAt: v.number(),
  },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const existing = await ctx.db
      .query('auditEvents')
      .withIndex('by_eventId', (q) => q.eq('eventId', args.eventId))
      .unique()
    if (existing) return existing
    const values = {
      eventId: args.eventId,
      actorType: args.actorType,
      actorUserId: args.actorUserId,
      actorApiKeyId: args.actorApiKeyId,
      action: args.action,
      resourceType: args.resourceType,
      resourceId: args.resourceId,
      outcome: args.outcome,
      requestId: args.requestId,
      ipAddress: args.ipAddress,
      metadataJson: args.metadataJson,
      createdAt: args.createdAt,
    }
    const id = await ctx.db.insert('auditEvents', values)
    return await ctx.db.get(id)
  },
})

export const listAuditByServer = query({
  args: {
    serverSecret: v.string(),
    action: v.optional(v.string()),
    actorUserId: v.optional(v.string()),
    before: v.optional(v.number()),
    limit: v.optional(v.number()),
    resourceType: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const limit = Math.min(Math.max(args.limit ?? 100, 1), 200)
    const before = args.before ?? Date.now() + 1
    const source = args.actorUserId
      ? ctx.db.query('auditEvents').withIndex('by_actorUserId_createdAt', (q) =>
          q.eq('actorUserId', args.actorUserId).lt('createdAt', before))
      : ctx.db.query('auditEvents').withIndex('by_createdAt', (q) => q.lt('createdAt', before))
    const rows = await source.order('desc').take(200)
    return rows
      .filter((row) => (!args.action || row.action === args.action) &&
        (!args.resourceType || row.resourceType === args.resourceType))
      .slice(0, limit)
  },
})
