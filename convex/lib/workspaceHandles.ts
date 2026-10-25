import type { MutationCtx, QueryCtx } from '../_generated/server'
import { isReservedWorkspaceHandle, isWorkspaceHandleSyntaxValid } from '@/shared/workspaces/handle-policy'

export type WorkspaceHandleKind = 'canonical' | 'alias'
export type WorkspaceHandleVisibility = 'public' | 'private'

type WorkspaceHandleContext = MutationCtx | QueryCtx

export async function getWorkspaceHandle(ctx: WorkspaceHandleContext, handle: string) {
  return await ctx.db.query('workspaceHandles')
    .withIndex('by_handle', (q) => q.eq('handle', handle))
    .unique()
}

export async function isWorkspaceHandleAvailable(
  ctx: WorkspaceHandleContext,
  handle: string,
  workspaceId?: string,
): Promise<boolean> {
  const registered = await getWorkspaceHandle(ctx, handle)
  if (registered && registered.workspaceId !== workspaceId) return false
  if (registered?.visibility === 'private') return false

  const legacy = await ctx.db.query('workspaces')
    .withIndex('by_slug', (q) => q.eq('slug', handle))
    .take(100)
  return !legacy.some((workspace) => workspace.workspaceId !== workspaceId)
}

export async function claimWorkspaceHandle(ctx: MutationCtx, args: {
  handle: string
  workspaceId: string
  kind: WorkspaceHandleKind
  visibility: WorkspaceHandleVisibility
  now: number
  allowReserved?: boolean
}): Promise<void> {
  if (
    !isWorkspaceHandleSyntaxValid(args.handle)
    || (!args.allowReserved && isReservedWorkspaceHandle(args.handle))
  ) {
    throw new Error('WORKSPACE_HANDLE_INVALID')
  }
  const registered = await getWorkspaceHandle(ctx, args.handle)
  if (registered && registered.workspaceId !== args.workspaceId) {
    throw new Error('WORKSPACE_HANDLE_ALREADY_EXISTS')
  }
  const legacy = await ctx.db.query('workspaces')
    .withIndex('by_slug', (q) => q.eq('slug', args.handle))
    .take(100)
  if (legacy.some((workspace) => workspace.workspaceId !== args.workspaceId)) {
    throw new Error('WORKSPACE_HANDLE_ALREADY_EXISTS')
  }
  if (registered) {
    await ctx.db.patch(registered._id, {
      kind: args.kind,
      visibility: args.visibility,
      updatedAt: args.now,
    })
    return
  }
  await ctx.db.insert('workspaceHandles', {
    handle: args.handle,
    workspaceId: args.workspaceId,
    kind: args.kind,
    visibility: args.visibility,
    createdAt: args.now,
    updatedAt: args.now,
  })
}
