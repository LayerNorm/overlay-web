import { v } from 'convex/values'
import { mutation } from '../_generated/server'
import { requireServerSecret } from '../lib/auth'

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
