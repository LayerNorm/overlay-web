import { v } from 'convex/values'
import { mutation, query } from '../_generated/server'
import { validateServerSecret } from '../lib/auth'
import { getReadableRow } from '../lib/resourceScope'
import { canWork, loadWorkItem, loadWorkViewer, logWorkEvent, workEventActorPrincipalId } from '../lib/workItems'
import { WORK_LIMITS } from '../../src/shared/work/status'

const auth = {
  userId: v.string(),
  workspaceId: v.string(),
  accessToken: v.optional(v.string()),
  serverSecret: v.optional(v.string()),
  actingAgentPrincipalId: v.optional(v.string()),
}

/** Trusted server calls only: see `authorize` in `workItems.ts`. */
async function authorize(params: { serverSecret?: string } & Record<string, unknown>) {
  if (!validateServerSecret(params.serverSecret)) throw new Error('Unauthorized')
}

/** A task's activity and comments, oldest first. Empty when the caller cannot see the task. */
export const list = query({
  args: { ...auth, workItemId: v.string() },
  handler: async (ctx, { userId, workspaceId, workItemId, accessToken, serverSecret }) => {
    try {
      await authorize({ userId, accessToken, serverSecret })
    } catch {
      return []
    }
    const item = await getReadableRow(ctx, { row: await loadWorkItem(ctx, workItemId), userId, workspaceId })
    if (!item) return []
    return await ctx.db.query('workItemEvents').withIndex('by_workItemId_createdAt', (q) => q.eq('workItemId', item._id)).order('asc').collect()
  },
})

export const addComment = mutation({
  args: { ...auth, workItemId: v.string(), body: v.string() },
  handler: async (ctx, args) => {
    await authorize(args)
    const body = args.body.trim()
    if (!body) throw new Error('WORK_INVALID:comment_required')
    if (body.length > WORK_LIMITS.comment) throw new Error('WORK_INVALID:comment_too_long')
    const viewer = await loadWorkViewer(ctx, args.workspaceId, args.userId)
    const item = await getReadableRow(ctx, { row: await loadWorkItem(ctx, args.workItemId), userId: args.userId, workspaceId: args.workspaceId })
    // Anyone who can work on a task can comment on it.
    if (!item || !canWork(item, viewer)) throw new Error('Unauthorized')
    if (item.archivedAt !== undefined) throw new Error('WORK_INVALID:archived')
    const actorPrincipalId = await workEventActorPrincipalId(ctx, {
      workspaceId: item.workspaceId,
      principalId: viewer.principalId,
      actingAgentPrincipalId: args.actingAgentPrincipalId,
    })
    await logWorkEvent(ctx, { workItemId: item._id, workspaceId: item.workspaceId, actorPrincipalId, kind: 'comment', data: { body } })
    await ctx.db.patch(item._id, { updatedAt: Date.now() })
  },
})
