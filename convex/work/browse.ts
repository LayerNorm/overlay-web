import { v } from 'convex/values'
import { paginationOptsValidator } from 'convex/server'
import { mutation, query, type QueryCtx } from '../_generated/server'
import { requireNativeWorkspace } from '../lib/nativeViewer'
import { requireNativeCapability } from '../lib/nativeCapabilities'
import { getReadableRow } from '../lib/resourceScope'
import { loadWorkItem } from '../lib/workItems'
import { createWorkFor, listWorkFor, moveWorkFor, updateWorkFor, workContextFor } from './workItems'
import { addWorkCommentFor, listWorkEventsFor } from './workItemEvents'
import { workEventView, workItemView } from '../../src/shared/work/projection'
import { assignmentExecutionForViewer } from '../collaboration/agentAssignments'
import type { AssignmentExecution } from '../../src/shared/work/assignment-execution'

const doneWhenArg = v.array(v.object({ text: v.string(), checked: v.boolean() }))
const contextArg = v.array(v.object({
  type: v.union(v.literal('file'), v.literal('note'), v.literal('chat'), v.literal('link')),
  id: v.string(),
  label: v.string(),
}))
const statusArg = v.union(v.literal('backlog'), v.literal('todo'), v.literal('progress'), v.literal('review'), v.literal('done'))

/**
 * The signed-in member, allowed to use Work: an active member of the workspace whose role grants `work.use` and whose
 * deployment has Work turned on. These are the checks the `/api/v1/work` routes make before reaching Convex.
 */
async function workViewer(ctx: QueryCtx, workspaceId: string) {
  const viewer = await requireNativeWorkspace(ctx, workspaceId)
  await requireNativeCapability(ctx, viewer.userId, 'work.use')
  return viewer
}

async function workViewerOrNull(ctx: QueryCtx, workspaceId: string) {
  try {
    return await workViewer(ctx, workspaceId)
  } catch {
    return null
  }
}

/** The tasks of a view, live, in board order. Null without Work access. */
export const list = query({
  args: { workspaceId: v.string(), view: v.optional(v.union(v.literal('personal'), v.literal('workspace'), v.literal('archived'))) },
  handler: async (ctx, { workspaceId, view }) => {
    const viewer = await workViewerOrNull(ctx, workspaceId)
    if (!viewer) return null
    return (await listWorkFor(ctx, { userId: viewer.userId, workspaceId, view })).map(workItemView)
  },
})

export const assignments = query({
  args: { workspaceId: v.string(), view: v.optional(v.union(v.literal('personal'), v.literal('workspace'))), paginationOpts: paginationOptsValidator },
  handler: async (ctx, { workspaceId, view, paginationOpts }) => {
    const viewer = await workViewerOrNull(ctx, workspaceId)
    if (!viewer) return { page: [], isDone: true, continueCursor: '' }
    try { await requireNativeCapability(ctx, viewer.userId, 'conversations.read') }
    catch { return { page: [], isDone: true, continueCursor: '' } }
    const batch = await ctx.db.query('agentAssignments').withIndex('by_workspaceId_createdAt', q => q.eq('workspaceId', workspaceId))
      .order('desc').paginate(paginationOpts)
    const page: AssignmentExecution[] = []
    for (const assignment of batch.page) {
      const participant = await ctx.db.query('conversationParticipants').withIndex('by_conversationId_principalId', q =>
        q.eq('conversationId', assignment.conversationId).eq('principalId', viewer.principal.principalId)).unique()
      if (participant?.archivedAt !== undefined) continue
      const execution = await assignmentExecutionForViewer(ctx, viewer, assignment)
      if (execution && (!view || execution.scope === view)) page.push(execution)
    }
    return { ...batch, page }
  },
})

/** One task the member can see, whatever view or list window it is in; null when it is gone or hidden. */
export const get = query({
  args: { workspaceId: v.string(), id: v.string() },
  handler: async (ctx, { workspaceId, id }) => {
    const viewer = await workViewerOrNull(ctx, workspaceId)
    if (!viewer) return null
    const row = await getReadableRow(ctx, { row: await loadWorkItem(ctx, id), userId: viewer.userId, workspaceId })
    return row ? workItemView(row) : null
  },
})

/** Who is asking and who a task can be given to. Null for guests and without Work access. */
export const context = query({
  args: { workspaceId: v.string() },
  handler: async (ctx, { workspaceId }) => {
    const viewer = await workViewerOrNull(ctx, workspaceId)
    if (!viewer) return null
    const result = await workContextFor(ctx, { userId: viewer.userId, workspaceId })
    if (!result) return null
    return {
      principalId: result.principalId,
      role: result.role,
      canCreateInWorkspace: result.canCreateInWorkspace,
      people: result.assignees.filter(person => person.type === 'human' || person.type === 'agent'),
    }
  },
})

/** Creates a task with no assignee; assigning an agent goes through the server, which starts the agent's turn. */
export const create = mutation({
  args: {
    workspaceId: v.string(),
    title: v.string(),
    scope: v.optional(v.union(v.literal('personal'), v.literal('workspace'))),
    description: v.optional(v.string()),
    status: v.optional(statusArg),
    blocked: v.optional(v.boolean()),
    priority: v.optional(v.number()),
    reviewerUserId: v.optional(v.string()),
    startDate: v.optional(v.string()),
    dueDate: v.optional(v.string()),
    parentId: v.optional(v.string()),
    blockedBy: v.optional(v.array(v.string())),
    doneWhen: v.optional(doneWhenArg),
    context: v.optional(contextArg),
  },
  handler: async (ctx, args) => {
    const viewer = await workViewer(ctx, args.workspaceId)
    const row = await createWorkFor(ctx, { ...args, userId: viewer.userId })
    return row ? workItemView(row) : null
  },
})

/** A task's activity and comments, live, oldest first. */
export const events = query({
  args: { workspaceId: v.string(), workItemId: v.string() },
  handler: async (ctx, { workspaceId, workItemId }) => {
    const viewer = await workViewerOrNull(ctx, workspaceId)
    if (!viewer) return []
    return (await listWorkEventsFor(ctx, { userId: viewer.userId, workspaceId, workItemId })).map(workEventView)
  },
})

/**
 * Ordinary field edits. Assignment and scope changes are not here: assigning an agent checks the budget and starts
 * the agent's turn on the server, and scope moves go through the scope routes.
 */
export const update = mutation({
  args: {
    workspaceId: v.string(),
    id: v.string(),
    expectedUpdatedAt: v.optional(v.number()),
    title: v.optional(v.string()),
    description: v.optional(v.union(v.string(), v.null())),
    status: v.optional(statusArg),
    blocked: v.optional(v.boolean()),
    priority: v.optional(v.number()),
    reviewerUserId: v.optional(v.union(v.string(), v.null())),
    startDate: v.optional(v.union(v.string(), v.null())),
    dueDate: v.optional(v.union(v.string(), v.null())),
    parentId: v.optional(v.union(v.string(), v.null())),
    blockedBy: v.optional(v.array(v.string())),
    doneWhen: v.optional(doneWhenArg),
    context: v.optional(contextArg),
  },
  handler: async (ctx, args) => {
    const viewer = await workViewer(ctx, args.workspaceId)
    const row = await updateWorkFor(ctx, { ...args, userId: viewer.userId })
    return row ? workItemView(row) : null
  },
})

/** Moves a task within or across columns, between two neighbours (or to a column's end). */
export const move = mutation({
  args: {
    workspaceId: v.string(),
    id: v.string(),
    status: v.optional(statusArg),
    afterId: v.optional(v.union(v.string(), v.null())),
    beforeId: v.optional(v.union(v.string(), v.null())),
  },
  handler: async (ctx, args) => {
    const viewer = await workViewer(ctx, args.workspaceId)
    const row = await moveWorkFor(ctx, { ...args, userId: viewer.userId })
    return row ? workItemView(row) : null
  },
})

export const addComment = mutation({
  args: { workspaceId: v.string(), workItemId: v.string(), body: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const viewer = await workViewer(ctx, args.workspaceId)
    await addWorkCommentFor(ctx, { ...args, userId: viewer.userId })
    return null
  },
})
