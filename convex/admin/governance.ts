import { v } from 'convex/values'
import { mutation, query } from '../_generated/server'
import { requireServerSecret } from '../lib/auth'

const resourceType = v.union(v.literal('project'), v.literal('knowledge_base'))
const policyStatus = v.union(
  v.literal('draft'),
  v.literal('active'),
  v.literal('superseded'),
  v.literal('rejected'),
)
const reviewStatus = v.union(v.literal('open'), v.literal('completed'))

export const createPolicyVersionByServer = mutation({
  args: {
    serverSecret: v.string(),
    policyId: v.string(),
    resourceType,
    resourceId: v.string(),
    retentionUntil: v.optional(v.number()),
    legalHold: v.boolean(),
    notes: v.optional(v.string()),
    createdBy: v.string(),
  },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const existing = await ctx.db.query('governancePolicies')
      .withIndex('by_resource_version', (q) => q
        .eq('resourceType', args.resourceType)
        .eq('resourceId', args.resourceId))
      .collect()
    const now = Date.now()
    const id = await ctx.db.insert('governancePolicies', {
      policyId: args.policyId,
      resourceType: args.resourceType,
      resourceId: args.resourceId,
      version: Math.max(0, ...existing.map(({ version }) => version)) + 1,
      status: 'draft',
      retentionUntil: args.retentionUntil,
      legalHold: args.legalHold,
      notes: args.notes,
      createdBy: args.createdBy,
      createdAt: now,
      updatedAt: now,
    })
    return await ctx.db.get(id)
  },
})

export const getPolicyByServer = query({
  args: { serverSecret: v.string(), policyId: v.string() },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    return await ctx.db.query('governancePolicies')
      .withIndex('by_policyId', (q) => q.eq('policyId', args.policyId))
      .unique()
  },
})

export const getActivePolicyByServer = query({
  args: { serverSecret: v.string(), resourceType, resourceId: v.string() },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    return await ctx.db.query('governancePolicies')
      .withIndex('by_resource_status', (q) => q
        .eq('resourceType', args.resourceType)
        .eq('resourceId', args.resourceId)
        .eq('status', 'active'))
      .unique()
  },
})

export const listPoliciesByServer = query({
  args: {
    serverSecret: v.string(),
    resourceType: v.optional(resourceType),
    resourceId: v.optional(v.string()),
    status: v.optional(policyStatus),
  },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const rows = await ctx.db.query('governancePolicies').collect()
    return rows
      .filter((row) =>
        (args.resourceType === undefined || row.resourceType === args.resourceType) &&
        (args.resourceId === undefined || row.resourceId === args.resourceId) &&
        (args.status === undefined || row.status === args.status))
      .sort((a, b) =>
        b.updatedAt - a.updatedAt ||
        a.resourceType.localeCompare(b.resourceType) ||
        a.resourceId.localeCompare(b.resourceId) ||
        b.version - a.version)
  },
})

export const approvePolicyByServer = mutation({
  args: {
    serverSecret: v.string(),
    policyId: v.string(),
    approvedBy: v.string(),
    approvedAt: v.number(),
  },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const target = await ctx.db.query('governancePolicies')
      .withIndex('by_policyId', (q) => q.eq('policyId', args.policyId))
      .unique()
    if (!target || target.status !== 'draft') return null
    const active = await ctx.db.query('governancePolicies')
      .withIndex('by_resource_status', (q) => q
        .eq('resourceType', target.resourceType)
        .eq('resourceId', target.resourceId)
        .eq('status', 'active'))
      .collect()
    for (const row of active) {
      await ctx.db.patch(row._id, {
        status: 'superseded',
        updatedAt: args.approvedAt,
      })
    }
    const update = {
      status: 'active' as const,
      approvedBy: args.approvedBy,
      approvedAt: args.approvedAt,
      updatedAt: args.approvedAt,
    }
    await ctx.db.patch(target._id, update)
    return { ...target, ...update }
  },
})

export const rejectPolicyByServer = mutation({
  args: {
    serverSecret: v.string(),
    policyId: v.string(),
    rejectedBy: v.string(),
    rejectedAt: v.number(),
  },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const target = await ctx.db.query('governancePolicies')
      .withIndex('by_policyId', (q) => q.eq('policyId', args.policyId))
      .unique()
    if (!target || target.status !== 'draft') return null
    const update = {
      status: 'rejected' as const,
      rejectedBy: args.rejectedBy,
      rejectedAt: args.rejectedAt,
      updatedAt: args.rejectedAt,
    }
    await ctx.db.patch(target._id, update)
    return { ...target, ...update }
  },
})

export const createAccessReviewByServer = mutation({
  args: {
    serverSecret: v.string(),
    reviewId: v.string(),
    resourceType,
    resourceId: v.string(),
    ownerUserId: v.optional(v.string()),
    grants: v.any(),
    createdBy: v.string(),
    notes: v.optional(v.string()),
    dueAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const id = await ctx.db.insert('governanceAccessReviews', {
      reviewId: args.reviewId,
      resourceType: args.resourceType,
      resourceId: args.resourceId,
      status: 'open',
      ownerUserId: args.ownerUserId,
      grants: args.grants,
      createdBy: args.createdBy,
      notes: args.notes,
      dueAt: args.dueAt,
      createdAt: Date.now(),
    })
    return await ctx.db.get(id)
  },
})

export const getAccessReviewByServer = query({
  args: { serverSecret: v.string(), reviewId: v.string() },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    return await ctx.db.query('governanceAccessReviews')
      .withIndex('by_reviewId', (q) => q.eq('reviewId', args.reviewId))
      .unique()
  },
})

export const listAccessReviewsByServer = query({
  args: {
    serverSecret: v.string(),
    resourceType: v.optional(resourceType),
    resourceId: v.optional(v.string()),
    status: v.optional(reviewStatus),
  },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const rows = await ctx.db.query('governanceAccessReviews').collect()
    return rows
      .filter((row) =>
        (args.resourceType === undefined || row.resourceType === args.resourceType) &&
        (args.resourceId === undefined || row.resourceId === args.resourceId) &&
        (args.status === undefined || row.status === args.status))
      .sort((a, b) => b.createdAt - a.createdAt || a.reviewId.localeCompare(b.reviewId))
  },
})

export const completeAccessReviewByServer = mutation({
  args: {
    serverSecret: v.string(),
    reviewId: v.string(),
    reviewerUserId: v.string(),
    notes: v.optional(v.string()),
    completedAt: v.number(),
  },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const target = await ctx.db.query('governanceAccessReviews')
      .withIndex('by_reviewId', (q) => q.eq('reviewId', args.reviewId))
      .unique()
    if (!target || target.status !== 'open') return null
    const update = {
      status: 'completed' as const,
      reviewerUserId: args.reviewerUserId,
      ...(args.notes !== undefined ? { notes: args.notes } : {}),
      completedAt: args.completedAt,
    }
    await ctx.db.patch(target._id, update)
    return { ...target, ...update }
  },
})

export const removeForResourceByServer = mutation({
  args: { serverSecret: v.string(), resourceType, resourceId: v.string() },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const policies = await ctx.db.query('governancePolicies')
      .withIndex('by_resource_version', (q) => q
        .eq('resourceType', args.resourceType)
        .eq('resourceId', args.resourceId))
      .collect()
    const reviews = await ctx.db.query('governanceAccessReviews')
      .withIndex('by_resource_createdAt', (q) => q
        .eq('resourceType', args.resourceType)
        .eq('resourceId', args.resourceId))
      .collect()
    for (const row of [...policies, ...reviews]) await ctx.db.delete(row._id)
    return { removed: policies.length + reviews.length }
  },
})
