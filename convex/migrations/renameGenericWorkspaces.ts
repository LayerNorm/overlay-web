import { paginationOptsValidator } from 'convex/server'
import { v } from 'convex/values'
import { mutation } from '../_generated/server'
import { requireServerSecret } from '../lib/auth'
import { defaultWorkspaceName, isGenericWorkspaceName } from '../../src/shared/workspaces/default-name'

/**
 * Gives the first workspaces that early versions called "Personal" (or "Personal’s workspace") a name that says whose
 * they are, "<First name>’s workspace". Workspaces whose owner already chose a name are left alone. Idempotent: a renamed
 * workspace no longer matches. Run with `dryRun: true` first; it returns what would change and changes nothing.
 * See docs/plans/UNIFIED_SCOPES_PLAN.md (Phase 5).
 */
export const renameGenericWorkspacesByServer = mutation({
  args: {
    serverSecret: v.string(),
    dryRun: v.boolean(),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const page = await ctx.db.query('workspaces').paginate(args.paginationOpts)
    const changes: Array<{ workspaceId: string; from: string; to: string }> = []
    for (const workspace of page.page) {
      if (workspace.kind !== 'personal' || workspace.status !== 'active' || !isGenericWorkspaceName(workspace.name)) continue
      const owner = workspace.personalOwnerUserId
        ? await ctx.db.query('workspacePrincipals')
          .withIndex('by_workspaceId_userId', (q) => q.eq('workspaceId', workspace.workspaceId).eq('userId', workspace.personalOwnerUserId!))
          .unique()
        : null
      const to = defaultWorkspaceName({ displayName: owner?.displayName, email: owner?.email })
      if (to === workspace.name) continue
      changes.push({ workspaceId: workspace.workspaceId, from: workspace.name, to })
      if (!args.dryRun) await ctx.db.patch(workspace._id, { name: to, updatedAt: Date.now() })
    }
    return { changes, continueCursor: page.continueCursor, isDone: page.isDone }
  },
})
