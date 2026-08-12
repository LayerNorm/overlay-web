import type { QueryCtx, MutationCtx } from '../_generated/server'

type Ctx = Pick<QueryCtx, 'db'> | Pick<MutationCtx, 'db'>

/**
 * Validates that a user is an active member of the given workspace.
 * Throws 'WORKSPACE_ACCESS_DENIED' if the user is not a member.
 * Returns silently if workspaceId is undefined (no workspace scoping requested).
 */
export async function assertWorkspaceMembership(
  ctx: Ctx,
  args: { userId: string; workspaceId?: string },
): Promise<void> {
  if (args.workspaceId === undefined) return

  const principal = await ctx.db
    .query('workspacePrincipals')
    .withIndex('by_workspaceId_userId', (q) =>
      q.eq('workspaceId', args.workspaceId!).eq('userId', args.userId),
    )
    .unique()

  if (!principal || principal.type !== 'human' || principal.archivedAt) {
    throw new Error('WORKSPACE_ACCESS_DENIED')
  }

  const membership = await ctx.db
    .query('workspaceMemberships')
    .withIndex('by_workspaceId_principalId', (q) =>
      q.eq('workspaceId', args.workspaceId!).eq('principalId', principal.principalId),
    )
    .unique()

  if (!membership || membership.status !== 'active') {
    throw new Error('WORKSPACE_ACCESS_DENIED')
  }
}
