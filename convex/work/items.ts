import { v } from 'convex/values'
import { mutation, query, type MutationCtx } from '../_generated/server'
import { requireAccessToken, validateServerSecret } from '../lib/auth'
import { assertCanCreateInScope, getReadableRow, listScopedRows, scopeContextLoader } from '../lib/resourceScope'
import { scopeMutations } from '../lib/scopeMutations'
import type { Doc, Id } from '../_generated/dataModel'
import { nextWorkItemOrderKey } from '../../src/shared/work/work-items'

const scopeArg = v.optional(v.union(v.literal('personal'), v.literal('workspace')))
const viewArg = v.optional(v.union(v.literal('personal'), v.literal('workspace'), v.literal('archived')))
const statusArg = v.optional(v.union(
  v.literal('todo'), v.literal('in_progress'), v.literal('in_review'), v.literal('done'),
))
const priorityArg = v.optional(v.union(
  v.literal('none'), v.literal('low'), v.literal('medium'), v.literal('high'), v.literal('urgent'),
))

const workItemDoc = v.any()

// Archiving/restoring and Personal <-> Workspace moves share the scoped-resource rules.
export const { setScope, archive, restore } = scopeMutations('workItems', 'content', {
  // Subtasks move, archive, and restore with their parent.
  descendants: async (db, id) => {
    const realDb = db as MutationCtx['db']
    const rows = await realDb
      .query('workItems')
      .withIndex('by_parentItemId', (q) => q.eq('parentItemId', id as Id<'workItems'>))
      .collect()
    return rows.map((row) => row._id as string)
  },
})

async function authorizeUserAccess(params: {
  accessToken?: string
  serverSecret?: string
  userId: string
}) {
  if (validateServerSecret(params.serverSecret)) return
  await requireAccessToken(params.accessToken ?? '', params.userId)
}

function workItemScopeKey(userId: string, workspaceId: string | undefined): string {
  return workspaceId ? `workspace:${workspaceId}` : `personal:${userId}`
}

/** Allocates the next `OVR-<n>` number for the item's scope, incrementing its counter. */
async function allocateItemNumber(ctx: MutationCtx, scopeKey: string): Promise<number> {
  const counter = await ctx.db
    .query('workItemCounters')
    .withIndex('by_scopeKey', (q) => q.eq('scopeKey', scopeKey))
    .unique()
  if (!counter) {
    await ctx.db.insert('workItemCounters', { scopeKey, nextNumber: 2 })
    return 1
  }
  await ctx.db.patch(counter._id, { nextNumber: counter.nextNumber + 1 })
  return counter.nextNumber
}

/** The orderKey to append after the last item the caller can read in `status` (and parent, when given). */
async function appendOrderKey(
  ctx: MutationCtx,
  args: {
    userId: string
    workspaceId: string | undefined
    scope: 'personal' | 'workspace'
    status: Doc<'workItems'>['status']
    parentItemId?: Id<'workItems'>
  },
): Promise<string> {
  const rows = args.workspaceId !== undefined
    ? await ctx.db
        .query('workItems')
        .withIndex('by_workspaceId_status', (q) => q.eq('workspaceId', args.workspaceId!).eq('status', args.status))
        .collect()
    : await ctx.db
        .query('workItems')
        .withIndex('by_userId', (q) => q.eq('userId', args.userId))
        .collect()
  const column = rows.filter((row) =>
    row.status === args.status &&
    row.deletedAt === undefined &&
    row.archivedAt === undefined &&
    (row.scope ?? 'personal') === args.scope &&
    row.parentItemId === args.parentItemId &&
    (args.workspaceId !== undefined ? row.workspaceId === args.workspaceId : row.workspaceId === undefined),
  )
  return nextWorkItemOrderKey(column.map((row) => row.orderKey))
}

function sortWorkItems(rows: Doc<'workItems'>[]): Doc<'workItems'>[] {
  return [...rows].sort((a, b) => (a.orderKey < b.orderKey ? -1 : a.orderKey > b.orderKey ? 1 : a.createdAt - b.createdAt))
}

export const list = query({
  args: {
    userId: v.string(),
    workspaceId: v.optional(v.string()),
    accessToken: v.optional(v.string()),
    serverSecret: v.optional(v.string()),
    view: viewArg,
    status: statusArg,
    assigneeUserId: v.optional(v.string()),
    parentItemId: v.optional(v.id('workItems')),
    includeDeleted: v.optional(v.boolean()),
    limit: v.optional(v.number()),
  },
  returns: v.array(workItemDoc),
  handler: async (ctx, { userId, workspaceId, accessToken, serverSecret, view, status, assigneeUserId, parentItemId, includeDeleted, limit }) => {
    try {
      await authorizeUserAccess({ userId, accessToken, serverSecret })
    } catch {
      return []
    }
    const pageLimit = Math.min(500, Math.max(1, Math.floor(limit ?? 500)))
    const filter = (rows: Doc<'workItems'>[]) => sortWorkItems(
      rows
        .filter((row) => (includeDeleted ? true : !row.deletedAt))
        .filter((row) => (status === undefined ? true : row.status === status))
        .filter((row) => (assigneeUserId === undefined ? true : row.assigneeUserId === assigneeUserId))
        .filter((row) => (parentItemId === undefined ? true : row.parentItemId === parentItemId)),
    ).slice(0, pageLimit)

    if (workspaceId !== undefined) {
      const scoped = await listScopedRows(ctx, {
        userId, workspaceId, view,
        fetchMine: async () => await ctx.db.query('workItems')
          .withIndex('by_workspaceId_userId', (q) => q.eq('workspaceId', workspaceId).eq('userId', userId)).collect(),
        fetchShared: async (ws) => await ctx.db.query('workItems')
          .withIndex('by_workspaceId_scope_archivedAt', (q) => q.eq('workspaceId', ws).eq('scope', 'workspace')).collect(),
      })
      return filter(scoped)
    }
    const mine = await ctx.db.query('workItems').withIndex('by_userId', (q) => q.eq('userId', userId)).collect()
    // Rows from before workspaces: everything active that is theirs (archived view shows their archived ones).
    return filter(mine.filter((row) => (view === 'archived' ? row.archivedAt !== undefined : row.archivedAt === undefined)))
  },
})

export const get = query({
  args: {
    itemId: v.id('workItems'),
    userId: v.string(),
    workspaceId: v.optional(v.string()),
    accessToken: v.optional(v.string()),
    serverSecret: v.optional(v.string()),
  },
  returns: v.union(v.object({ item: workItemDoc, children: v.array(workItemDoc) }), v.null()),
  handler: async (ctx, { itemId, userId, workspaceId, accessToken, serverSecret }) => {
    try {
      await authorizeUserAccess({ userId, accessToken, serverSecret })
    } catch {
      return null
    }
    const item = await getReadableRow(ctx, { row: await ctx.db.get(itemId), userId, workspaceId })
    if (!item || item.deletedAt) return null
    const children = await ctx.db
      .query('workItems')
      .withIndex('by_parentItemId', (q) => q.eq('parentItemId', itemId))
      .collect()
    const loader = scopeContextLoader(ctx, userId)
    const readableChildren: Doc<'workItems'>[] = []
    for (const child of children) {
      if (!child.deletedAt && (await loader.canRead(child))) readableChildren.push(child)
    }
    return { item, children: sortWorkItems(readableChildren) }
  },
})

export const create = mutation({
  args: {
    userId: v.string(),
    workspaceId: v.optional(v.string()),
    accessToken: v.optional(v.string()),
    serverSecret: v.optional(v.string()),
    scope: scopeArg,
    title: v.string(),
    description: v.optional(v.string()),
    status: statusArg,
    priority: priorityArg,
    assigneeUserId: v.optional(v.string()),
    startDate: v.optional(v.number()),
    dueDate: v.optional(v.number()),
    labels: v.optional(v.array(v.string())),
    parentItemId: v.optional(v.id('workItems')),
    orderKey: v.optional(v.string()),
  },
  returns: v.id('workItems'),
  handler: async (ctx, args) => {
    await authorizeUserAccess(args)
    const scope = await assertCanCreateInScope(ctx, { kind: 'content', scope: args.scope, workspaceId: args.workspaceId, userId: args.userId })
    const status = args.status ?? 'todo'
    let parentItemId = args.parentItemId
    if (parentItemId !== undefined) {
      const parent = await getReadableRow(ctx, { row: await ctx.db.get(parentItemId), userId: args.userId, workspaceId: args.workspaceId })
      // One level of nesting only: a subtask may not get its own subtasks.
      if (!parent || parent.deletedAt || parent.parentItemId !== undefined) throw new Error('WORK_ITEM_PARENT_INVALID')
      if (parent.workspaceId !== args.workspaceId) throw new Error('WORK_ITEM_PARENT_INVALID')
    } else {
      parentItemId = undefined
    }
    const orderKey = args.orderKey ?? await appendOrderKey(ctx, {
      userId: args.userId,
      workspaceId: args.workspaceId,
      scope,
      status,
      parentItemId,
    })
    const now = Date.now()
    const itemNumber = await allocateItemNumber(ctx, workItemScopeKey(args.userId, args.workspaceId))
    return await ctx.db.insert('workItems', {
      userId: args.userId,
      reporterUserId: args.userId,
      workspaceId: args.workspaceId,
      scope,
      title: args.title.trim() || 'Untitled task',
      description: args.description?.trim() || undefined,
      status,
      priority: args.priority ?? 'none',
      assigneeUserId: args.assigneeUserId,
      startDate: args.startDate,
      dueDate: args.dueDate,
      orderKey,
      parentItemId,
      itemNumber,
      labels: args.labels,
      createdAt: now,
      updatedAt: now,
    })
  },
})

export const update = mutation({
  args: {
    itemId: v.id('workItems'),
    userId: v.string(),
    workspaceId: v.optional(v.string()),
    accessToken: v.optional(v.string()),
    serverSecret: v.optional(v.string()),
    title: v.optional(v.string()),
    description: v.optional(v.string()),
    status: statusArg,
    priority: priorityArg,
    assigneeUserId: v.optional(v.string()),
    clearAssignee: v.optional(v.boolean()),
    startDate: v.optional(v.number()),
    dueDate: v.optional(v.number()),
    clearDates: v.optional(v.boolean()),
    labels: v.optional(v.array(v.string())),
    parentItemId: v.optional(v.id('workItems')),
    orderKey: v.optional(v.string()),
    expectedUpdatedAt: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, { itemId, userId, workspaceId, accessToken, serverSecret, ...updates }) => {
    await authorizeUserAccess({ userId, accessToken, serverSecret })
    const item = await ctx.db.get(itemId)
    if (!item || item.deletedAt || (workspaceId !== undefined && item.workspaceId !== workspaceId) || !(await scopeContextLoader(ctx, userId).canEdit(item))) {
      throw new Error('Unauthorized')
    }
    if (updates.expectedUpdatedAt !== undefined && item.updatedAt !== updates.expectedUpdatedAt) {
      throw new Error(`WORK_ITEM_REVISION_CONFLICT:${item.updatedAt}`)
    }
    const patch: Partial<Doc<'workItems'>> = { updatedAt: Date.now() }
    if (updates.title !== undefined) patch.title = updates.title.trim() || item.title
    if (updates.description !== undefined) patch.description = updates.description.trim() || undefined
    if (updates.priority !== undefined) patch.priority = updates.priority
    if (updates.clearAssignee) patch.assigneeUserId = undefined
    else if (updates.assigneeUserId !== undefined) patch.assigneeUserId = updates.assigneeUserId
    if (updates.clearDates) {
      patch.startDate = undefined
      patch.dueDate = undefined
    } else {
      if (updates.startDate !== undefined) patch.startDate = updates.startDate
      if (updates.dueDate !== undefined) patch.dueDate = updates.dueDate
    }
    if (updates.labels !== undefined) patch.labels = updates.labels
    if (updates.parentItemId !== undefined) {
      const parent = await getReadableRow(ctx, { row: await ctx.db.get(updates.parentItemId), userId, workspaceId })
      if (!parent || parent.deletedAt || parent.parentItemId !== undefined || updates.parentItemId === itemId) {
        throw new Error('WORK_ITEM_PARENT_INVALID')
      }
      patch.parentItemId = updates.parentItemId
    }
    if (updates.status !== undefined && updates.status !== item.status) {
      patch.status = updates.status
      // A column move re-seats the item: explicit key wins, otherwise append to the target column.
      patch.orderKey = updates.orderKey ?? await appendOrderKey(ctx, {
        userId,
        workspaceId: item.workspaceId,
        scope: item.scope ?? 'personal',
        status: updates.status,
        parentItemId: item.parentItemId,
      })
    } else if (updates.orderKey !== undefined) {
      patch.orderKey = updates.orderKey
    }
    await ctx.db.patch(itemId, patch)
    return null
  },
})

/** Drag reorder / cross-column move: the caller computes the key between the new neighbors. */
export const reorder = mutation({
  args: {
    itemId: v.id('workItems'),
    userId: v.string(),
    workspaceId: v.optional(v.string()),
    accessToken: v.optional(v.string()),
    serverSecret: v.optional(v.string()),
    status: statusArg,
    orderKey: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, { itemId, userId, workspaceId, accessToken, serverSecret, status, orderKey }) => {
    await authorizeUserAccess({ userId, accessToken, serverSecret })
    const item = await ctx.db.get(itemId)
    if (!item || item.deletedAt || (workspaceId !== undefined && item.workspaceId !== workspaceId) || !(await scopeContextLoader(ctx, userId).canEdit(item))) {
      throw new Error('Unauthorized')
    }
    await ctx.db.patch(itemId, {
      orderKey,
      ...(status !== undefined ? { status } : {}),
      updatedAt: Date.now(),
    })
    return null
  },
})

/** Soft delete: sets deletedAt and cascades to the item's subtasks. */
export const remove = mutation({
  args: {
    itemId: v.id('workItems'),
    userId: v.string(),
    workspaceId: v.optional(v.string()),
    accessToken: v.optional(v.string()),
    serverSecret: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, { itemId, userId, workspaceId, accessToken, serverSecret }) => {
    await authorizeUserAccess({ userId, accessToken, serverSecret })
    const item = await ctx.db.get(itemId)
    if (!item || item.deletedAt || (workspaceId !== undefined && item.workspaceId !== workspaceId) || !(await scopeContextLoader(ctx, userId).canEdit(item))) {
      throw new Error('Unauthorized')
    }
    const now = Date.now()
    await ctx.db.patch(itemId, { deletedAt: now, updatedAt: now })
    const children = await ctx.db
      .query('workItems')
      .withIndex('by_parentItemId', (q) => q.eq('parentItemId', itemId))
      .collect()
    for (const child of children) {
      if (!child.deletedAt) await ctx.db.patch(child._id, { deletedAt: now, updatedAt: now })
    }
    return null
  },
})

export const search = query({
  args: {
    userId: v.string(),
    workspaceId: v.optional(v.string()),
    accessToken: v.optional(v.string()),
    serverSecret: v.optional(v.string()),
    text: v.string(),
    limit: v.optional(v.number()),
  },
  returns: v.array(workItemDoc),
  handler: async (ctx, { userId, workspaceId, accessToken, serverSecret, text, limit }) => {
    try {
      await authorizeUserAccess({ userId, accessToken, serverSecret })
    } catch {
      return []
    }
    const needle = text.trim()
    if (!needle) return []
    const pageLimit = Math.min(100, Math.max(1, Math.floor(limit ?? 25)))
    const rows = await ctx.db
      .query('workItems')
      .withSearchIndex('search_title', (q) => {
        const scoped = q.search('title', needle)
        return workspaceId !== undefined ? scoped.eq('workspaceId', workspaceId) : scoped.eq('userId', userId)
      })
      .take(pageLimit * 3)
    const loader = scopeContextLoader(ctx, userId)
    const out: Doc<'workItems'>[] = []
    for (const row of rows) {
      if (row.deletedAt || row.archivedAt !== undefined) continue
      if (!(await loader.canRead(row))) continue
      out.push(row)
      if (out.length >= pageLimit) break
    }
    return sortWorkItems(out)
  },
})
