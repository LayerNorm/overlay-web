import { v } from 'convex/values'
import { mutation, query } from '../_generated/server'
import type { Doc } from '../_generated/dataModel'
import { requireServerSecret } from '../lib/auth'

const phaseValidator = v.union(
  v.literal('queued'), v.literal('allocating'), v.literal('booting'),
  v.literal('connecting'), v.literal('ready'), v.literal('failed'),
)

/** A start that has not moved for this long was lost (the server restarted mid-provision) and may be started again. */

const rowValidator = v.object({
  workspaceId: v.string(),
  agentId: v.string(),
  userId: v.string(),
  phase: phaseValidator,
  error: v.optional(v.string()),
  environmentId: v.optional(v.string()),
  allocationKey: v.optional(v.string()),
  provider: v.optional(v.string()),
  providerReference: v.optional(v.string()),
  allocatedAt: v.optional(v.number()),
  reclaimPending: v.optional(v.boolean()),
  createdAt: v.number(),
  updatedAt: v.number(),
})

const reclaimError = 'The machine setup was interrupted. Start it again.'

function publicRow(row: Doc<'cloudAgentProvisions'>) {
  const { _id: _id, _creationTime: _creationTime, ...rest } = row
  return rest
}

export const getByServer = query({
  args: { serverSecret: v.string(), workspaceId: v.string(), agentId: v.string() },
  returns: v.union(v.null(), rowValidator),
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const row = await ctx.db
      .query('cloudAgentProvisions')
      .withIndex('by_workspaceId_agentId', (q) => q.eq('workspaceId', args.workspaceId).eq('agentId', args.agentId))
      .first()
    if (!row) return null
    return publicRow(row)
  },
})

/** Starts (or restarts, after a failure or a lost start) the provisioning record for an agent. Never overwrites an active one. */
export const beginByServer = mutation({
  args: { serverSecret: v.string(), workspaceId: v.string(), agentId: v.string(), userId: v.string(), now: v.number() },
  returns: v.object({ started: v.boolean(), phase: phaseValidator }),
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    throw new Error('HOSTED_RUNTIME_RETIRED')
  },
})

export const setPhaseByServer = mutation({
  args: {
    serverSecret: v.string(), workspaceId: v.string(), agentId: v.string(), phase: phaseValidator,
    error: v.optional(v.string()), environmentId: v.optional(v.string()), allocationKey: v.optional(v.string()), now: v.number(),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    throw new Error('HOSTED_RUNTIME_RETIRED')
  },
})

export const recordAllocationByServer = mutation({
  args: {
    serverSecret: v.string(),
    workspaceId: v.string(),
    agentId: v.string(),
    allocationKey: v.string(),
    provider: v.string(),
    providerReference: v.string(),
    now: v.number(),
  },
  returns: v.object({ bound: v.boolean() }),
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    throw new Error('HOSTED_RUNTIME_RETIRED')
  },
})

export const claimReclaimByServer = mutation({
  args: {
    serverSecret: v.string(),
    workspaceId: v.string(),
    agentId: v.string(),
    expectedUpdatedAt: v.number(),
    now: v.number(),
  },
  returns: v.union(v.null(), rowValidator),
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const row = await ctx.db
      .query('cloudAgentProvisions')
      .withIndex('by_workspaceId_agentId', (q) => q.eq('workspaceId', args.workspaceId).eq('agentId', args.agentId))
      .first()
    if (!row || row.updatedAt !== args.expectedUpdatedAt || !row.providerReference) return null
    const updated = {
      ...row,
      phase: 'failed' as const,
      error: reclaimError,
      reclaimPending: true,
      updatedAt: args.now,
    }
    await ctx.db.patch(row._id, {
      phase: updated.phase,
      error: updated.error,
      reclaimPending: true,
      updatedAt: args.now,
    })
    return publicRow(updated)
  },
})

export const markReclaimPendingByServer = mutation({
  args: {
    serverSecret: v.string(),
    workspaceId: v.string(),
    agentId: v.string(),
    allocationKey: v.string(),
    now: v.number(),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const row = await ctx.db
      .query('cloudAgentProvisions')
      .withIndex('by_workspaceId_agentId', (q) => q.eq('workspaceId', args.workspaceId).eq('agentId', args.agentId))
      .first()
    if (!row || row.allocationKey !== args.allocationKey || !row.providerReference) return false
    await ctx.db.patch(row._id, {
      phase: 'failed',
      error: reclaimError,
      reclaimPending: true,
      updatedAt: args.now,
    })
    return true
  },
})

export const finishReclaimByServer = mutation({
  args: {
    serverSecret: v.string(),
    workspaceId: v.string(),
    agentId: v.string(),
    allocationKey: v.string(),
    providerReference: v.string(),
    now: v.number(),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const row = await ctx.db
      .query('cloudAgentProvisions')
      .withIndex('by_workspaceId_agentId', (q) => q.eq('workspaceId', args.workspaceId).eq('agentId', args.agentId))
      .first()
    if (!row || !row.reclaimPending || row.allocationKey !== args.allocationKey || row.providerReference !== args.providerReference) return false
    await ctx.db.patch(row._id, {
      provider: undefined,
      providerReference: undefined,
      allocatedAt: undefined,
      reclaimPending: undefined,
      updatedAt: args.now,
    })
    return true
  },
})

export const releaseAllocationByServer = mutation({
  args: {
    serverSecret: v.string(),
    workspaceId: v.string(),
    agentId: v.string(),
    allocationKey: v.string(),
    providerReference: v.string(),
    now: v.number(),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const row = await ctx.db
      .query('cloudAgentProvisions')
      .withIndex('by_workspaceId_agentId', (q) => q.eq('workspaceId', args.workspaceId).eq('agentId', args.agentId))
      .first()
    if (!row || row.reclaimPending || row.allocationKey !== args.allocationKey || row.providerReference !== args.providerReference) return false
    await ctx.db.patch(row._id, {
      provider: undefined,
      providerReference: undefined,
      allocatedAt: undefined,
      updatedAt: args.now,
    })
    return true
  },
})

export const listReclaimableByServer = query({
  args: { serverSecret: v.string(), before: v.number(), limit: v.number() },
  returns: v.array(rowValidator),
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const limit = Math.max(1, Math.min(50, Number.isFinite(args.limit) ? Math.floor(args.limit) : 20))
    const pending = await ctx.db
      .query('cloudAgentProvisions')
      .withIndex('by_reclaimPending_updatedAt', (q) => q.eq('reclaimPending', true))
      .take(limit)
    const phases = ['allocating', 'booting', 'connecting', 'failed'] as const
    const stale = (await Promise.all(phases.map((phase) => ctx.db
      .query('cloudAgentProvisions')
      .withIndex('by_phase_updatedAt', (q) => q.eq('phase', phase).lt('updatedAt', args.before))
      .take(limit)))).flat()
    const candidates = new Map<string, Doc<'cloudAgentProvisions'>>()
    for (const row of [...pending, ...stale]) {
      if (!row.providerReference || (!row.reclaimPending && row.updatedAt >= args.before)) continue
      candidates.set(row._id, row)
    }
    return [...candidates.values()]
      .sort((a, b) => a.updatedAt - b.updatedAt)
      .slice(0, limit)
      .map(publicRow)
  },
})

export const removeByServer = mutation({
  args: { serverSecret: v.string(), workspaceId: v.string(), agentId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const row = await ctx.db
      .query('cloudAgentProvisions')
      .withIndex('by_workspaceId_agentId', (q) => q.eq('workspaceId', args.workspaceId).eq('agentId', args.agentId))
      .first()
    if (row) await ctx.db.delete(row._id)
    return null
  },
})
