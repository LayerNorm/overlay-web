import { v } from 'convex/values'
import { mutation } from '../_generated/server'
import { requireServerSecret } from '../lib/auth'
import { isAgentMemoryOwnerId } from '../../src/shared/agents/agent-memory'

/**
 * Memories saved before people's memories became private by default have no `visibility`, which reads as shared, so a
 * teammate could recall a fact another member's assistant saved in a private chat. This marks every such memory owned
 * by a person as theirs (`owner`), with its search chunks, as new memories are saved. Agents' memories are workspace
 * knowledge by design and are left alone; so is any memory someone already marked. Idempotent; `dryRun` only counts.
 * Run until `isDone`, passing `continueCursor`.
 */
export const makePersonalMemoriesPrivateByServer = mutation({
  args: {
    serverSecret: v.string(),
    dryRun: v.boolean(),
    cursor: v.optional(v.union(v.string(), v.null())),
    numItems: v.optional(v.number()),
  },
  handler: async (ctx, { serverSecret, dryRun, cursor, numItems }) => {
    requireServerSecret(serverSecret)
    const page = await ctx.db.query('memories').paginate({ cursor: cursor ?? null, numItems: numItems ?? 100 })
    let memories = 0
    let chunks = 0
    for (const memory of page.page) {
      if (memory.visibility !== undefined || isAgentMemoryOwnerId(memory.userId)) continue
      memories += 1
      const memoryChunks = await ctx.db.query('knowledgeChunks')
        .withIndex('by_source', (q) => q.eq('sourceKind', 'memory').eq('sourceId', memory._id))
        .collect()
      const stale = memoryChunks.filter((chunk) => chunk.visibility !== 'owner')
      chunks += stale.length
      if (dryRun) continue
      await ctx.db.patch(memory._id, { visibility: 'owner' })
      for (const chunk of stale) await ctx.db.patch(chunk._id, { visibility: 'owner' })
    }
    return {
      scanned: page.page.length, memories, chunks, isDone: page.isDone, continueCursor: page.isDone ? null : page.continueCursor,
    }
  },
})
