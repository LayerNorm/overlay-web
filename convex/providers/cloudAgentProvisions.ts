import { v } from 'convex/values'
import { mutation, query } from '../_generated/server'
import { requireServerSecret } from '../lib/auth'

const phaseValidator = v.union(
  v.literal('queued'), v.literal('allocating'), v.literal('booting'),
  v.literal('connecting'), v.literal('ready'), v.literal('failed'),
)

/** A start that has not moved for this long was lost (the server restarted mid-provision) and may be started again. */
const STALE_START_MS = 10 * 60_000

const rowValidator = v.object({
  workspaceId: v.string(),
  agentId: v.string(),
  userId: v.string(),
  phase: phaseValidator,
  error: v.optional(v.string()),
  environmentId: v.optional(v.string()),
  createdAt: v.number(),
  updatedAt: v.number(),
})

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
    const { _id: _id, _creationTime: _creationTime, ...rest } = row
    return rest
  },
})

/** Starts (or restarts, after a failure or a lost start) the provisioning record for an agent. Never overwrites an active one. */
export const beginByServer = mutation({
  args: { serverSecret: v.string(), workspaceId: v.string(), agentId: v.string(), userId: v.string(), now: v.number() },
  returns: v.object({ started: v.boolean(), phase: phaseValidator }),
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const row = await ctx.db
      .query('cloudAgentProvisions')
      .withIndex('by_workspaceId_agentId', (q) => q.eq('workspaceId', args.workspaceId).eq('agentId', args.agentId))
      .first()
    const lost = row !== null && row.phase !== 'ready' && row.phase !== 'failed' && args.now - row.updatedAt > STALE_START_MS
    if (row && row.phase !== 'failed' && !lost) return { started: false, phase: row.phase }
    if (row) {
      await ctx.db.patch(row._id, { phase: 'queued', error: undefined, environmentId: undefined, userId: args.userId, updatedAt: args.now })
    } else {
      await ctx.db.insert('cloudAgentProvisions', {
        workspaceId: args.workspaceId, agentId: args.agentId, userId: args.userId,
        phase: 'queued', createdAt: args.now, updatedAt: args.now,
      })
    }
    return { started: true, phase: 'queued' as const }
  },
})

export const setPhaseByServer = mutation({
  args: {
    serverSecret: v.string(), workspaceId: v.string(), agentId: v.string(), phase: phaseValidator,
    error: v.optional(v.string()), environmentId: v.optional(v.string()), now: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const row = await ctx.db
      .query('cloudAgentProvisions')
      .withIndex('by_workspaceId_agentId', (q) => q.eq('workspaceId', args.workspaceId).eq('agentId', args.agentId))
      .first()
    if (!row) return null
    await ctx.db.patch(row._id, {
      phase: args.phase,
      error: args.phase === 'failed' ? (args.error ?? 'Could not start the machine.').slice(0, 300) : undefined,
      ...(args.environmentId ? { environmentId: args.environmentId } : {}),
      updatedAt: args.now,
    })
    return null
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
