import { makeFunctionReference } from 'convex/server'
import type { Doc } from '../_generated/dataModel'
import type { MutationCtx, QueryCtx } from '../_generated/server'

export const releaseDependentsRef = makeFunctionReference<'action'>('work/workItems:releaseDependents')
export const dispatchReadyAssignmentRef = makeFunctionReference<'action'>('work/workItems:dispatchReadyAssignment')

export async function workDependenciesDone(ctx: QueryCtx | MutationCtx, row: Doc<'workItems'>): Promise<boolean> {
  for (const id of row.blockedBy ?? []) {
    const blocker = await ctx.db.get(id)
    if (!blocker || blocker.workspaceId !== row.workspaceId || blocker.status !== 'done') return false
  }
  return true
}

export async function scheduleReadyAssignment(ctx: MutationCtx, row: Doc<'workItems'>) {
  const execution = row.assignmentExecution
  if (row.archivedAt !== undefined || row.status === 'done' || execution?.status !== 'pending'
    || execution.assigneePrincipalId !== row.assigneePrincipalId || !await workDependenciesDone(ctx, row)) return
  await ctx.scheduler.runAfter(0, dispatchReadyAssignmentRef, {
    workspaceId: row.workspaceId, userId: execution.assignedByUserId, id: String(row._id), generation: execution.generation,
  })
}
