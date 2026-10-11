import { v } from 'convex/values'
import { mutation, query, type MutationCtx } from '../_generated/server'
import { requireAccessToken, validateServerSecret } from '../lib/auth'
import { assertCanCreateInScope, getReadableRow, listScopedRows, scopeContextLoader } from '../lib/resourceScope'
import { scopeMutations } from '../lib/scopeMutations'
import type { Doc, Id } from '../_generated/dataModel'
import {
  allocateItemNumber,
  appendOrderKey,
  assertValidAssignee,
  assertValidParent,
  cleanLabels,
  isValidAssignee,
  validateFields,
  workItemCounterKey,
} from './itemRules'

const scopeArg = v.optional(v.union(v.literal('personal'), v.literal('workspace')))
const viewArg = v.optional(v.union(v.literal('personal'), v.literal('workspace'), v.literal('archived')))
const statusArg = v.optional(v.union(
  v.literal('todo'), v.literal('in_progress'), v.literal('in_review'), v.literal('done'),
))
const priorityArg = v.optional(v.union(
  v.literal('none'), v.literal('low'), v.literal('medium'), v.literal('high'), v.literal('urgent'),
))

const workItemDoc = v.any()

/** The most rows one list reads from a single source; newest first, so a busy workspace sees its recent work. */
const WORK_ITEM_SCAN_LIMIT = 2000

// Archiving/restoring and Personal <-> Workspace moves share the scoped-resource rules.
export const { setScope, archive, restore } = scopeMutations('workItems', 'content', {
  // A subtask's scope is its parent's: it moves with the parent, never on its own.
  // An item gets a number from the target scope's counter, and keeps an assignee only if they still fit.
  onMove: async (ctx, row, to, descendant) => {
    const item = row as unknown as Doc<'workItems'>
    if (!descendant && item.parentItemId !== undefined) return { ok: false, reason: 'subtask_follows_parent' }
    const itemNumber = await allocateItemNumber(ctx, workItemCounterKey(to, item.userId, item.workspaceId))
    const keepAssignee = item.assigneeUserId !== undefined &&
      await isValidAssignee(ctx, { assignee: item.assigneeUserId, workspaceId: item.workspaceId, scope: to, userId: item.userId })
    return { ok: true, patch: { itemNumber, ...(item.assigneeUserId !== undefined && !keepAssignee ? { assigneeUserId: undefined } : {}) } }
  },
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
          .withIndex('by_workspaceId_userId', (q) => q.eq('workspaceId', workspaceId).eq('userId', userId))
          .order('desc').take(WORK_ITEM_SCAN_LIMIT),
        fetchShared: async (ws) => await ctx.db.query('workItems')
          .withIndex('by_workspaceId_scope_archivedAt', (q) => q.eq('workspaceId', ws).eq('scope', 'workspace'))
          .order('desc').take(WORK_ITEM_SCAN_LIMIT),
      })
      return filter(scoped)
    }
    const mine = await ctx.db.query('workItems').withIndex('by_userId', (q) => q.eq('userId', userId)).order('desc').take(WORK_ITEM_SCAN_LIMIT)
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
      .take(WORK_ITEM_SCAN_LIMIT)
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
    validateFields(args)
    const scope = await assertCanCreateInScope(ctx, { kind: 'content', scope: args.scope, workspaceId: args.workspaceId, userId: args.userId })
    const status = args.status ?? 'todo'
    if (args.parentItemId !== undefined) {
      await assertValidParent(ctx, { parentId: args.parentItemId, userId: args.userId, workspaceId: args.workspaceId, scope })
    }
    if (args.assigneeUserId !== undefined) {
      await assertValidAssignee(ctx, { assignee: args.assigneeUserId, workspaceId: args.workspaceId, scope, userId: args.userId })
    }
    const orderKey = args.orderKey ?? await appendOrderKey(ctx, {
      userId: args.userId,
      workspaceId: args.workspaceId,
      scope,
      status,
      parentItemId: args.parentItemId,
    })
    const now = Date.now()
    const itemNumber = await allocateItemNumber(ctx, workItemCounterKey(scope, args.userId, args.workspaceId))
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
      parentItemId: args.parentItemId,
      itemNumber,
      labels: cleanLabels(args.labels),
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
    /** Clears both dates; `clearStartDate` / `clearDueDate` clear one. */
    clearDates: v.optional(v.boolean()),
    clearStartDate: v.optional(v.boolean()),
    clearDueDate: v.optional(v.boolean()),
    labels: v.optional(v.array(v.string())),
    parentItemId: v.optional(v.id('workItems')),
    /** Turns a subtask back into a top-level item. */
    clearParent: v.optional(v.boolean()),
    orderKey: v.optional(v.string()),
    expectedUpdatedAt: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, { itemId, userId, workspaceId, accessToken, serverSecret, ...updates }) => {
    await authorizeUserAccess({ userId, accessToken, serverSecret })
    validateFields(updates)
    const item = await ctx.db.get(itemId)
    if (!item || item.deletedAt || (workspaceId !== undefined && item.workspaceId !== workspaceId) || !(await scopeContextLoader(ctx, userId).canEdit(item))) {
      throw new Error('Unauthorized')
    }
    if (updates.expectedUpdatedAt !== undefined && item.updatedAt !== updates.expectedUpdatedAt) {
      throw new Error(`WORK_ITEM_REVISION_CONFLICT:${item.updatedAt}`)
    }
    if (updates.clearParent && updates.parentItemId !== undefined) throw new Error('WORK_ITEM_PARENT_INVALID')
    const itemScope = item.scope ?? 'personal'
    const patch: Partial<Doc<'workItems'>> = { updatedAt: Date.now() }
    if (updates.title !== undefined) patch.title = updates.title.trim() || item.title
    if (updates.description !== undefined) patch.description = updates.description.trim() || undefined
    if (updates.priority !== undefined) patch.priority = updates.priority
    if (updates.clearAssignee) patch.assigneeUserId = undefined
    else if (updates.assigneeUserId !== undefined) {
      await assertValidAssignee(ctx, { assignee: updates.assigneeUserId, workspaceId: item.workspaceId, scope: itemScope, userId })
      patch.assigneeUserId = updates.assigneeUserId
    }
    if (updates.clearDates || updates.clearStartDate) patch.startDate = undefined
    else if (updates.startDate !== undefined) patch.startDate = updates.startDate
    if (updates.clearDates || updates.clearDueDate) patch.dueDate = undefined
    else if (updates.dueDate !== undefined) patch.dueDate = updates.dueDate
    if (updates.labels !== undefined) patch.labels = cleanLabels(updates.labels)

    let parentItemId = item.parentItemId
    if (updates.clearParent) parentItemId = undefined
    else if (updates.parentItemId !== undefined && updates.parentItemId !== item.parentItemId) {
      await assertValidParent(ctx, {
        parentId: updates.parentItemId, userId, workspaceId: item.workspaceId, scope: itemScope, childId: itemId,
      })
      parentItemId = updates.parentItemId
    }
    patch.parentItemId = parentItemId

    const status = updates.status ?? item.status
    // Changing column (status or parent) re-seats the item: an explicit key wins, otherwise it goes to the end.
    if (status !== item.status || parentItemId !== item.parentItemId) {
      patch.status = status
      patch.orderKey = updates.orderKey ?? await appendOrderKey(ctx, {
        userId,
        workspaceId: item.workspaceId,
        scope: itemScope,
        status,
        parentItemId,
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
    validateFields({ orderKey })
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
      .take(WORK_ITEM_SCAN_LIMIT)
    for (const child of children) {
      if (!child.deletedAt) await ctx.db.patch(child._id, { deletedAt: now, updatedAt: now })
    }
    return null
  },
})

/**
 * Title search over what the caller can read: their own items plus the workspace's shared ones. Each source is its own
 * filtered search (live rows only), so other people's private matches never take up room in the results.
 */
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
    const mine = await ctx.db
      .query('workItems')
      .withSearchIndex('search_title', (q) => q.search('title', needle)
        .eq('userId', userId).eq('workspaceId', workspaceId).eq('archivedAt', undefined).eq('deletedAt', undefined))
      .take(pageLimit)
    const shared = workspaceId === undefined ? [] : await ctx.db
      .query('workItems')
      .withSearchIndex('search_title', (q) => q.search('title', needle)
        .eq('workspaceId', workspaceId).eq('scope', 'workspace').eq('archivedAt', undefined).eq('deletedAt', undefined))
      .take(pageLimit)
    const loader = scopeContextLoader(ctx, userId)
    const out = new Map<string, Doc<'workItems'>>()
    // Alternate between the two result lists (each is already best match first) so neither crowds out the other.
    for (let i = 0; i < pageLimit && out.size < pageLimit; i++) {
      for (const row of [mine[i], shared[i]]) {
        if (!row || out.has(row._id) || out.size >= pageLimit) continue
        if (await loader.canRead(row)) out.set(row._id, row)
      }
    }
    return sortWorkItems([...out.values()])
  },
})
