import { paginationOptsValidator } from 'convex/server'
import { v } from 'convex/values'
import { mutation } from '../_generated/server'
import { requireServerSecret } from '../lib/auth'

/**
 * One-off backfill for the agent thread model.
 *
 * `stampAgentThreadsByServer` binds existing agent DMs to their agent: a DM
 * whose `dmIdentityKey` contains an agent principal becomes a thread of that
 * agent (`conversations.agentId`), so it nests under the agent in the
 * sidebar instead of the flat chat list. Human-only DMs are untouched.
 *
 * `stampAgentAutomationsByServer` binds automations drafted inside an agent
 * thread to that agent (`automations.agentId` via the provenance
 * `sourceConversationId`), so they nest under the agent and disappear from
 * the standalone Automations page. Run `stampAgentThreadsByServer` first —
 * automations infer their agent from the source conversation's binding.
 */
export const stampAgentThreadsByServer = mutation({
  args: {
    serverSecret: v.string(),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const page = await ctx.db.query('conversations').paginate(args.paginationOpts)
    let stamped = 0
    let skipped = 0
    for (const conversation of page.page) {
      if (
        conversation.agentId
        || conversation.isAutomation
        || conversation.deletedAt
        || conversation.conversationType !== 'dm'
        || !conversation.dmIdentityKey
      ) {
        skipped++
        continue
      }
      // Only one-to-one DMs bind to an agent — a group DM that happens to
      // include an agent stays an ordinary conversation for its humans.
      const principalIds = conversation.dmIdentityKey.split(':')
      if (principalIds.length !== 2) {
        skipped++
        continue
      }
      let agentId: string | undefined
      for (const principalId of principalIds) {
        const principal = await ctx.db
          .query('workspacePrincipals')
          .withIndex('by_principalId', (q) => q.eq('principalId', principalId))
          .unique()
        if (principal?.type === 'agent' && principal.agentId) {
          agentId = principal.agentId
          break
        }
      }
      if (!agentId) {
        skipped++
        continue
      }
      await ctx.db.patch(conversation._id, {
        agentId,
        updatedAt: Date.now(),
      })
      stamped++
    }
    return {
      stamped,
      skipped,
      rows: page.page.length,
      continueCursor: page.continueCursor,
      isDone: page.isDone,
    }
  },
})

export const stampAgentAutomationsByServer = mutation({
  args: {
    serverSecret: v.string(),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const page = await ctx.db.query('automations').paginate(args.paginationOpts)
    let stamped = 0
    let skipped = 0
    for (const automation of page.page) {
      if (automation.agentId || automation.deletedAt || !automation.sourceConversationId) {
        skipped++
        continue
      }
      const source = await ctx.db.get(automation.sourceConversationId)
      const agentId = source?.agentId
      if (!agentId) {
        skipped++
        continue
      }
      await ctx.db.patch(automation._id, {
        agentId,
        updatedAt: Date.now(),
      })
      stamped++
    }
    return {
      stamped,
      skipped,
      rows: page.page.length,
      continueCursor: page.continueCursor,
      isDone: page.isDone,
    }
  },
})
