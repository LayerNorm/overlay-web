import { paginationOptsValidator } from 'convex/server'
import { v } from 'convex/values'
import { mutation } from '../_generated/server'
import { requireServerSecret } from '../lib/auth'

/**
 * One-off repair for automations whose `conversationId` points at a shared
 * conversation (the chat or agent thread the automation was drafted in).
 *
 * Under the old model `sourceConversationId` doubled as the run target, so
 * `markRunCompleted` stamped the shared conversation onto `conversationId`.
 * That hid the source conversation from the chat list and made automation
 * runs write into the user's/agent's thread.
 *
 * An automation-owned thread is always created with `isAutomation: true`
 * (see the run executors). Any `conversationId` that is missing or not
 * flagged is therefore a shared conversation — clear it so the next run
 * creates a dedicated thread and the conversation returns to its owner.
 * `sourceConversationId` is left untouched as provenance.
 */
export const clearSharedRunTargetsByServer = mutation({
  args: {
    serverSecret: v.string(),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const page = await ctx.db.query('automations').paginate(args.paginationOpts)
    let cleared = 0
    let kept = 0
    for (const automation of page.page) {
      if (!automation.conversationId) {
        kept++
        continue
      }
      const conversation = await ctx.db.get(automation.conversationId)
      if (conversation?.isAutomation === true) {
        kept++
        continue
      }
      await ctx.db.patch(automation._id, {
        conversationId: undefined,
        updatedAt: Date.now(),
      })
      cleared++
    }
    return {
      cleared,
      kept,
      rows: page.page.length,
      continueCursor: page.continueCursor,
      isDone: page.isDone,
    }
  },
})
