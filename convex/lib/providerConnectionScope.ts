import type { MutationCtx, QueryCtx } from '../_generated/server'
import type { Doc } from '../_generated/dataModel'
import { assertWorkspaceMembership } from './workspaceMembership'

type Ctx = Pick<QueryCtx, 'db'> | Pick<MutationCtx, 'db'>

export async function assertActiveWorkspaceMember(
  ctx: Ctx,
  args: { userId: string; workspaceId: string },
): Promise<void> {
  const workspace = await ctx.db
    .query('workspaces')
    .withIndex('by_workspaceId', (q) => q.eq('workspaceId', args.workspaceId))
    .unique()
  if (!workspace || workspace.status !== 'active') {
    throw new Error('WORKSPACE_ACCESS_DENIED')
  }
  await assertWorkspaceMembership(ctx, args)
}

export async function isActiveWorkspaceMember(
  ctx: Ctx,
  args: { userId: string; workspaceId: string },
): Promise<boolean> {
  try {
    await assertActiveWorkspaceMember(ctx, args)
    return true
  } catch (error) {
    if (error instanceof Error && error.message === 'WORKSPACE_ACCESS_DENIED') return false
    throw error
  }
}

export async function canUseProviderConnection(
  ctx: Ctx,
  connection: Doc<'userProviderConnections'>,
  args: { actorUserId: string; workspaceId?: string },
): Promise<boolean> {
  const scope = connection.scope ?? 'personal'
  if (scope === 'personal') return connection.userId === args.actorUserId
  if (connection.authKind !== 'subscription' || !connection.subscriptionProvider) return false
  if (!args.workspaceId || args.workspaceId !== connection.workspaceId) return false
  return await isActiveWorkspaceMember(ctx, {
    userId: args.actorUserId,
    workspaceId: args.workspaceId,
  })
}
