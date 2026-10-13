import { v } from 'convex/values'
import type { Doc } from '../_generated/dataModel'
import { mutation, query } from '../_generated/server'
import { canEditResource, canCreateInScope } from '../../src/shared/workspaces/resource-scope'
import { rankBetween } from '../../src/shared/work/rank'
import { listScopedRows, scopeContextLoader, planMove, planArchive, planRestore } from '../lib/resourceScope'
import { workAuth, workDoc, workFields, workScope } from './validators'
import { authorize, fail, readable, recordEvent, validateFields, validateParent, validatePeople } from './rules'

export const list = query({
  args: { ...workAuth, view: v.optional(v.union(workScope, v.literal('archived'))) },
  returns: v.array(workDoc),
  handler: async (ctx, args) => {
    await authorize(ctx, args)
    const rows = await listScopedRows(ctx, {
      userId: args.userId, workspaceId: args.workspaceId, view: args.view,
      fetchMine: () => ctx.db.query('workItems').withIndex('by_workspaceId_userId_archivedAt', (q) => q.eq('workspaceId', args.workspaceId).eq('userId', args.userId)).take(1000),
      fetchShared: (ws) => ctx.db.query('workItems').withIndex('by_workspaceId_scope_archivedAt', (q) => q.eq('workspaceId', ws).eq('scope', 'workspace')).take(1000),
    })
    return rows.sort((a, b) => (a.rank < b.rank ? -1 : a.rank > b.rank ? 1 : 0) || a._id.localeCompare(b._id))
  },
})
export const get = query({
  args: { ...workAuth, id: v.id('workItems') }, returns: workDoc,
  handler: async (ctx, args) => { await authorize(ctx, args); return readable(ctx, args, args.id) },
})
export const create = mutation({
  args: { ...workAuth, scope: v.optional(workScope), title: v.string(), description: v.optional(v.string()), status: v.optional(workFields.status), blocked: v.optional(v.boolean()), priority: v.optional(workFields.priority), parentId: workFields.parentId, assigneePrincipalId: workFields.assigneePrincipalId, reviewerUserId: workFields.reviewerUserId, startDate: workFields.startDate, dueDate: workFields.dueDate, doneWhen: workFields.doneWhen, context: workFields.context },
  returns: workDoc,
  handler: async (ctx, args) => {
    const access = await authorize(ctx, args)
    const scope = args.scope ?? 'personal'
    if (!canCreateInScope('content', scope, access.viewer, access.policy)) fail('FORBIDDEN', 'Workspace task creation is restricted')
    const status = args.status ?? 'todo'
    const column = scope === 'workspace'
      ? ctx.db.query('workItems').withIndex('by_workspaceId_scope_status_rank', (q) => q.eq('workspaceId', args.workspaceId).eq('scope', scope).eq('status', status))
      : ctx.db.query('workItems').withIndex('by_workspaceId_userId_scope_status_rank', (q) => q.eq('workspaceId', args.workspaceId).eq('userId', args.userId).eq('scope', scope).eq('status', status))
    const last = await column.order('desc').first()
    const now = Date.now()
    const row = { userId: args.userId, workspaceId: args.workspaceId, scope, title: args.title.trim(), description: args.description ?? '', status, blocked: args.blocked ?? false, priority: args.priority ?? 2, rank: rankBetween(last?.rank), parentId: args.parentId, assigneePrincipalId: args.assigneePrincipalId, reviewerUserId: args.reviewerUserId, startDate: args.startDate, dueDate: args.dueDate, doneWhen: args.doneWhen, context: args.context, createdAt: now, updatedAt: now }
    validateFields(row); await validatePeople(ctx, row); await validateParent(ctx, args, row)
    const id = await ctx.db.insert('workItems', row)
    await recordEvent(ctx, args, id, 'created', {})
    const saved = await ctx.db.get(id)
    if (!saved) fail('NOT_FOUND', 'Task not found')
    return saved
  },
})
const patchFields = {
  title: v.optional(v.string()), description: v.optional(v.string()), status: v.optional(workFields.status), blocked: v.optional(v.boolean()), priority: v.optional(workFields.priority), rank: v.optional(v.string()),
  assigneePrincipalId: v.optional(v.union(v.string(), v.null())), reviewerUserId: v.optional(v.union(v.string(), v.null())),
  startDate: v.optional(v.union(v.string(), v.null())), dueDate: v.optional(v.union(v.string(), v.null())), parentId: v.optional(v.union(v.id('workItems'), v.null())),
  doneWhen: workFields.doneWhen, context: workFields.context,
}
export const update = mutation({
  args: { ...workAuth, id: v.id('workItems'), expectedUpdatedAt: v.number(), patch: v.object(patchFields) }, returns: workDoc,
  handler: async (ctx, args) => {
    const access = await authorize(ctx, args)
    const row = await readable(ctx, args, args.id)
    if (!canEditResource(row, access.viewer) || (row.scope === 'workspace' && !canCreateInScope('content', 'workspace', access.viewer, access.policy))) fail('FORBIDDEN', 'You cannot edit this task')
    if (row.archivedAt !== undefined) fail('INVALID', 'Restore the task before editing it')
    if (row.updatedAt !== args.expectedUpdatedAt) fail('CONFLICT', 'This task changed. Reload it before saving')
    const p = args.patch
    const { assigneePrincipalId, reviewerUserId, startDate, dueDate, parentId, ...fields } = p
    const patch: Partial<Doc<'workItems'>> = { ...fields, updatedAt: Math.max(Date.now(), row.updatedAt + 1) }
    if (fields.title !== undefined) patch.title = fields.title.trim()
    if (assigneePrincipalId !== undefined) patch.assigneePrincipalId = assigneePrincipalId ?? undefined
    if (reviewerUserId !== undefined) patch.reviewerUserId = reviewerUserId ?? undefined
    if (startDate !== undefined) patch.startDate = startDate ?? undefined
    if (dueDate !== undefined) patch.dueDate = dueDate ?? undefined
    if (parentId !== undefined) patch.parentId = parentId ?? undefined
    const merged = { ...row, ...patch }
    validateFields(merged); await validatePeople(ctx, merged); await validateParent(ctx, args, merged, row._id)
    await ctx.db.patch(row._id, patch)
    for (const field of Object.keys(p)) {
      const kind = field === 'status' ? 'status' : field === 'assigneePrincipalId' ? 'assignee' : 'updated'
      await recordEvent(ctx, args, row._id, kind, { field })
    }
    return { ...merged }
  },
})

/** Work relations must remain in the same scope, so scope transitions have a domain guard. */
export const lifecycle = mutation({
  args: { ...workAuth, id: v.id('workItems'), action: v.union(v.literal('scope'), v.literal('archived'), v.literal('restored')), to: v.optional(workScope) }, returns: v.null(),
  handler: async (ctx, args) => {
    await authorize(ctx, args)
    const row = await readable(ctx, args, args.id)
    const now = Math.max(Date.now(), row.updatedAt + 1)
    if (args.action === 'scope') {
      if (!args.to) fail('INVALID', 'Target scope required')
      const children = await ctx.db.query('workItems').withIndex('by_parentId', (q) => q.eq('parentId', row._id)).first()
      if (row.parentId || children || row.blockedBy?.length) fail('INVALID', 'Detach related tasks before moving scope')
      const plan = await planMove(ctx, { kind: 'content', row, to: args.to, userId: args.userId })
      if (!plan.ok) fail('FORBIDDEN', plan.reason)
      const moved = { ...row, ...plan.patch }
      await validatePeople(ctx, moved)
      await ctx.db.patch(row._id, { ...plan.patch, updatedAt: now })
    } else if (args.action === 'archived') {
      const plan = await planArchive(ctx, { row, userId: args.userId, now })
      if (!plan.ok) fail('FORBIDDEN', plan.reason)
      await ctx.db.patch(row._id, { ...plan.patch, updatedAt: now })
    } else {
      const plan = await planRestore(ctx, { row, userId: args.userId })
      if (!plan.ok) fail('FORBIDDEN', plan.reason)
      const loader = scopeContextLoader(ctx, args.userId)
      if (!(await loader.canEdit(row))) fail('FORBIDDEN', 'You cannot restore this task')
      await ctx.db.patch(row._id, { scope: plan.scope, archivedAt: undefined, archivedBy: undefined, archivedFromScope: undefined, updatedAt: now })
    }
    await recordEvent(ctx, args, row._id, args.action, { ...(args.to ? { after: args.to } : {}) })
    return null
  },
})
