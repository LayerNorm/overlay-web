import { v } from 'convex/values'
import { mutation } from '../_generated/server'
import { requireServerSecret } from '../lib/auth'

/**
 * Generated images and videos were saved without the workspace they were made in, so workspace lists (Outputs, Files)
 * never showed them and they could not move to Workspace. This gives each such output the workspace of the chat it was
 * made in. Outputs with no chat, or whose chat has no workspace, are counted and left alone. Idempotent; `dryRun` only
 * counts. Run until `isDone`, passing `continueCursor`.
 */
export const backfillOutputWorkspacesByServer = mutation({
  args: {
    serverSecret: v.string(),
    dryRun: v.boolean(),
    cursor: v.optional(v.union(v.string(), v.null())),
    numItems: v.optional(v.number()),
  },
  handler: async (ctx, { serverSecret, dryRun, cursor, numItems }) => {
    requireServerSecret(serverSecret)
    const page = await ctx.db.query('files').paginate({ cursor: cursor ?? null, numItems: numItems ?? 200 })
    let fixed = 0
    let unresolved = 0
    for (const file of page.page) {
      if (file.kind !== 'output' || file.workspaceId) continue
      const conversationId = file.conversationId ? ctx.db.normalizeId('conversations', file.conversationId) : null
      const conversation = conversationId ? await ctx.db.get(conversationId) : null
      const workspaceId = conversation?.workspaceId
      if (!workspaceId) { unresolved += 1; continue }
      fixed += 1
      if (!dryRun) await ctx.db.patch(file._id, { workspaceId })
    }
    return {
      scanned: page.page.length, fixed, unresolved, isDone: page.isDone, continueCursor: page.isDone ? null : page.continueCursor,
    }
  },
})
