import { v } from 'convex/values'
import { mutation, type MutationCtx } from '../_generated/server'
import { requireServerSecret } from '../lib/auth'

async function counter(ctx: MutationCtx, workspaceId: string, key: string) {
  return await ctx.db.query('agentAskCounters')
    .withIndex('by_workspaceId_key', (q) => q.eq('workspaceId', workspaceId).eq('key', key))
    .unique()
}

/** Gives a question back when it could not be asked (nothing was posted), so a failure does not use up the limit. */
export const releaseAgentAskByServer = mutation({
  args: { serverSecret: v.string(), workspaceId: v.string(), rootKey: v.string(), turnKey: v.string(), now: v.number() },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    for (const key of [args.rootKey, args.turnKey]) {
      const row = await counter(ctx, args.workspaceId, key)
      if (row && row.count > 0) await ctx.db.patch(row._id, { count: row.count - 1, updatedAt: args.now })
    }
  },
})

/**
 * Takes one question from the budget of the person's message it traces back to and from the turn that is asking,
 * or refuses. Both limits are checked before either is spent, so a refusal costs nothing.
 */
export const claimAgentAskByServer = mutation({
  args: {
    serverSecret: v.string(), workspaceId: v.string(), rootKey: v.string(), turnKey: v.string(),
    maxRoot: v.number(), maxTurn: v.number(), now: v.number(),
  },
  handler: async (ctx, args): Promise<{ ok: true } | { ok: false; reason: 'budget' | 'turn_limit' }> => {
    requireServerSecret(args.serverSecret)
    const [root, turn] = await Promise.all([counter(ctx, args.workspaceId, args.rootKey), counter(ctx, args.workspaceId, args.turnKey)])
    if ((root?.count ?? 0) >= args.maxRoot) return { ok: false, reason: 'budget' }
    if ((turn?.count ?? 0) >= args.maxTurn) return { ok: false, reason: 'turn_limit' }
    for (const [row, key] of [[root, args.rootKey], [turn, args.turnKey]] as const) {
      if (row) await ctx.db.patch(row._id, { count: row.count + 1, updatedAt: args.now })
      else await ctx.db.insert('agentAskCounters', { workspaceId: args.workspaceId, key, count: 1, updatedAt: args.now })
    }
    return { ok: true }
  },
})
