import { v } from 'convex/values'
import { mutation, query, type MutationCtx } from '../_generated/server'
import type { Id } from '../_generated/dataModel'
import { requireAccessToken, validateServerSecret } from '../lib/auth'
import { assertCanCreateInScope, getReadableRow, listScopedRows, loadScopeContext } from '../lib/resourceScope'
import { scopeMutations } from '../lib/scopeMutations'
import {
  assertAssignable,
  assertDateOrder,
  assertReviewer,
  canWork,
  endRank,
  loadWorkItem,
  loadWorkViewer,
  logWorkEvent,
  needsRebalance,
  normalizeContext,
  normalizeDate,
  normalizeDescription,
  normalizeDoneWhen,
  normalizePriority,
  normalizeTitle,
  rebalanceColumn,
  type WorkItemDoc,
} from '../lib/workItems'
import { checkParent } from '../../src/shared/work/graph'
import { compareRanked, rankBetween } from '../../src/shared/work/rank'
import { DEFAULT_WORK_PRIORITY, DEFAULT_WORK_STATUS, WORK_LIMITS } from '../../src/shared/work/status'
import { rowScope } from '../../src/shared/workspaces/resource-scope'

const scopeArg = v.optional(v.union(v.literal('personal'), v.literal('workspace')))
const viewArg = v.optional(v.union(v.literal('personal'), v.literal('workspace'), v.literal('archived')))
const statusArg = v.union(v.literal('backlog'), v.literal('todo'), v.literal('progress'), v.literal('review'), v.literal('done'))
const doneWhenArg = v.array(v.object({ text: v.string(), checked: v.boolean() }))
const contextArg = v.array(v.object({
  type: v.union(v.literal('file'), v.literal('note'), v.literal('chat'), v.literal('link')),
  id: v.string(),
  label: v.string(),
}))

const auth = {
  userId: v.string(),
  workspaceId: v.string(),
  accessToken: v.optional(v.string()),
  serverSecret: v.optional(v.string()),
}

async function authorize(params: { accessToken?: string; serverSecret?: string; userId: string }) {
  if (validateServerSecret(params.serverSecret)) return
  await requireAccessToken(params.accessToken ?? '', params.userId)
}

/** Ids of everything below a task (children, their children), for moving or archiving them together. */
async function descendantIds(db: unknown, id: string): Promise<string[]> {
  const reader = db as { query: MutationCtx['db']['query'] }
  const out: string[] = []
  let frontier = [id]
  for (let depth = 0; depth < WORK_LIMITS.maxDepth && frontier.length > 0; depth += 1) {
    const next: string[] = []
    for (const parent of frontier) {
      const children = await reader.query('workItems').withIndex('by_parentId', (q) => q.eq('parentId', parent as Id<'workItems'>)).collect()
      for (const child of children) next.push(String(child._id))
    }
    out.push(...next)
    frontier = next
  }
  return out
}

// Moving, archiving, and restoring follow the shared Personal / Workspace rules; each is written to the task's log.
export const { setScope, archive, restore } = scopeMutations('workItems', 'content', {
  descendants: descendantIds,
  afterApply: async (rawCtx, change) => {
    const ctx = rawCtx as MutationCtx
    const row = change.row as unknown as WorkItemDoc
    await logWorkEvent(ctx, {
      workItemId: change.id as Id<'workItems'>,
      workspaceId: row.workspaceId,
      actorPrincipalId: (await loadWorkViewer(ctx, row.workspaceId, change.userId)).principalId,
      kind: change.action,
      data: change.action === 'scope' ? { from: rowScope(row), to: change.to } : undefined,
    })
  },
})

/** The people and agents a task in this workspace can be given to, and who is asking. */
export const context = query({
  args: { ...auth },
  handler: async (ctx, { userId, workspaceId, accessToken, serverSecret }) => {
    try {
      await authorize({ userId, accessToken, serverSecret })
    } catch {
      return null
    }
    const viewer = await loadWorkViewer(ctx, workspaceId, userId)
    if (viewer.viewer.role === null || viewer.viewer.role === 'guest') return null
    const principals = await ctx.db.query('workspacePrincipals').withIndex('by_workspaceId', (q) => q.eq('workspaceId', workspaceId)).collect()
    const memberships = await ctx.db.query('workspaceMemberships').withIndex('by_workspaceId', (q) => q.eq('workspaceId', workspaceId)).collect()
    const roleByPrincipal = new Map(memberships.filter((m) => m.status === 'active').map((m) => [m.principalId, m.role]))
    const assignees = principals
      .filter((p) => p.archivedAt === undefined && p.type !== 'service' && (p.type === 'agent' || (roleByPrincipal.has(p.principalId) && roleByPrincipal.get(p.principalId) !== 'guest')))
      .map((p) => ({ principalId: p.principalId, type: p.type, userId: p.userId ?? null, displayName: p.displayName }))
      .sort((a, b) => (a.type === b.type ? a.displayName.localeCompare(b.displayName) : a.type === 'human' ? -1 : 1))
    return { principalId: viewer.principalId, role: viewer.viewer.role, canCreateInWorkspace: await canCreateWorkspaceTask(ctx, workspaceId, userId), assignees }
  },
})

async function canCreateWorkspaceTask(ctx: MutationCtx | Parameters<typeof loadScopeContext>[0], workspaceId: string, userId: string) {
  try {
    await assertCanCreateInScope(ctx, { kind: 'content', scope: 'workspace', workspaceId, userId })
    return true
  } catch {
    return false
  }
}

export const list = query({
  args: {
    ...auth,
    /** personal, workspace, or archived; omitted means everything active that the caller can see. */
    view: viewArg,
  },
  handler: async (ctx, { userId, workspaceId, accessToken, serverSecret, view }) => {
    try {
      await authorize({ userId, accessToken, serverSecret })
    } catch {
      return []
    }
    const rows = await listScopedRows(ctx, {
      userId, workspaceId, view,
      fetchMine: async () => await ctx.db.query('workItems')
        .withIndex('by_workspaceId_userId_archivedAt', (q) => q.eq('workspaceId', workspaceId).eq('userId', userId)).collect(),
      fetchShared: async (ws) => await ctx.db.query('workItems')
        .withIndex('by_workspaceId_scope_archivedAt', (q) => q.eq('workspaceId', ws).eq('scope', 'workspace')).collect(),
    })
    return rows
      .sort((a, b) => compareRanked({ rank: a.rank, createdAt: a.createdAt, id: a._id }, { rank: b.rank, createdAt: b.createdAt, id: b._id }))
      .slice(0, WORK_LIMITS.listCap)
  },
})

export const get = query({
  args: { ...auth, id: v.string() },
  handler: async (ctx, { id, userId, workspaceId, accessToken, serverSecret }) => {
    try {
      await authorize({ userId, accessToken, serverSecret })
    } catch {
      return null
    }
    return await getReadableRow(ctx, { row: await loadWorkItem(ctx, id), userId, workspaceId })
  },
})

/** A parent must be an active task in the same workspace and scope that the caller can see, and must not make a loop. */
async function assertParent(ctx: MutationCtx, args: { id?: string; parentId: string; workspaceId: string; scope: 'personal' | 'workspace'; userId: string }) {
  const parent = await getReadableRow(ctx, { row: await loadWorkItem(ctx, args.parentId), userId: args.userId, workspaceId: args.workspaceId })
  if (!parent || parent.archivedAt !== undefined) throw new Error('WORK_INVALID:parent')
  if (rowScope(parent) !== args.scope) throw new Error('WORK_INVALID:parent_scope')
  const parents = new Map<string, string | undefined>()
  const children = new Map<string, string[]>()
  // The chain above the new parent.
  let cursor: WorkItemDoc | null = parent
  for (let i = 0; i <= WORK_LIMITS.maxDepth && cursor; i += 1) {
    parents.set(String(cursor._id), cursor.parentId ? String(cursor.parentId) : undefined)
    cursor = cursor.parentId ? await ctx.db.get(cursor.parentId) : null
  }
  // Everything below the task being moved (a new task has nothing below it).
  let frontier = args.id ? [args.id] : []
  for (let depth = 0; depth <= WORK_LIMITS.maxDepth && frontier.length > 0; depth += 1) {
    const next: string[] = []
    for (const node of frontier) {
      const rows = await ctx.db.query('workItems').withIndex('by_parentId', (q) => q.eq('parentId', node as Id<'workItems'>)).collect()
      children.set(node, rows.map((row) => String(row._id)))
      for (const row of rows) { parents.set(String(row._id), node); next.push(String(row._id)) }
    }
    frontier = next
  }
  const check = checkParent({ id: args.id ?? '(new)', parentId: String(parent._id), parentOf: (x) => parents.get(x), childrenOf: (x) => children.get(x) ?? [] })
  if (!check.ok) throw new Error(`WORK_INVALID:${check.reason}`)
  return parent
}

export const create = mutation({
  args: {
    ...auth,
    title: v.string(),
    scope: scopeArg,
    description: v.optional(v.string()),
    status: v.optional(statusArg),
    priority: v.optional(v.number()),
    assigneePrincipalId: v.optional(v.string()),
    reviewerUserId: v.optional(v.string()),
    startDate: v.optional(v.string()),
    dueDate: v.optional(v.string()),
    parentId: v.optional(v.string()),
    doneWhen: v.optional(doneWhenArg),
    context: v.optional(contextArg),
  },
  handler: async (ctx, args) => {
    await authorize(args)
    const scope = await assertCanCreateInScope(ctx, { kind: 'content', scope: args.scope, workspaceId: args.workspaceId, userId: args.userId })
    const viewer = await loadWorkViewer(ctx, args.workspaceId, args.userId)
    if (viewer.viewer.role === null || viewer.viewer.role === 'guest') throw new Error('Unauthorized')
    const title = normalizeTitle(args.title)
    const status = args.status ?? DEFAULT_WORK_STATUS
    const startDate = args.startDate !== undefined ? normalizeDate(args.startDate) : undefined
    const dueDate = args.dueDate !== undefined ? normalizeDate(args.dueDate) : undefined
    assertDateOrder(startDate, dueDate)
    if (args.assigneePrincipalId) {
      await assertAssignable(ctx, { workspaceId: args.workspaceId, scope, creatorPrincipalId: viewer.principalId, principalId: args.assigneePrincipalId })
    }
    if (args.reviewerUserId) {
      await assertReviewer(ctx, { workspaceId: args.workspaceId, scope, creatorUserId: args.userId, reviewerUserId: args.reviewerUserId })
    }
    let parentId: Id<'workItems'> | undefined
    if (args.parentId) parentId = (await assertParent(ctx, { parentId: args.parentId, workspaceId: args.workspaceId, scope, userId: args.userId }))._id
    const now = Date.now()
    const id = await ctx.db.insert('workItems', {
      scope,
      workspaceId: args.workspaceId,
      userId: args.userId,
      title,
      ...(args.description !== undefined ? { description: normalizeDescription(args.description) } : {}),
      status,
      blocked: false,
      priority: args.priority !== undefined ? normalizePriority(args.priority) : DEFAULT_WORK_PRIORITY,
      rank: await endRank(ctx, args.workspaceId, status),
      ...(args.assigneePrincipalId ? { assigneePrincipalId: args.assigneePrincipalId } : {}),
      ...(args.reviewerUserId ? { reviewerUserId: args.reviewerUserId } : {}),
      ...(startDate !== undefined ? { startDate } : {}),
      ...(dueDate !== undefined ? { dueDate } : {}),
      ...(parentId ? { parentId } : {}),
      ...(args.doneWhen ? { doneWhen: normalizeDoneWhen(args.doneWhen) } : {}),
      ...(args.context ? { context: normalizeContext(args.context) } : {}),
      createdAt: now,
      updatedAt: now,
    })
    await logWorkEvent(ctx, { workItemId: id, workspaceId: args.workspaceId, actorPrincipalId: viewer.principalId, kind: 'created', data: { status, scope } })
    return await ctx.db.get(id)
  },
})

export const update = mutation({
  args: {
    ...auth,
    id: v.string(),
    title: v.optional(v.string()),
    description: v.optional(v.union(v.string(), v.null())),
    status: v.optional(statusArg),
    blocked: v.optional(v.boolean()),
    priority: v.optional(v.number()),
    assigneePrincipalId: v.optional(v.union(v.string(), v.null())),
    reviewerUserId: v.optional(v.union(v.string(), v.null())),
    startDate: v.optional(v.union(v.string(), v.null())),
    dueDate: v.optional(v.union(v.string(), v.null())),
    parentId: v.optional(v.union(v.string(), v.null())),
    doneWhen: v.optional(doneWhenArg),
    context: v.optional(contextArg),
  },
  handler: async (ctx, args) => {
    await authorize(args)
    const viewer = await loadWorkViewer(ctx, args.workspaceId, args.userId)
    const row = await getReadableRow(ctx, { row: await loadWorkItem(ctx, args.id), userId: args.userId, workspaceId: args.workspaceId })
    if (!row || !canWork(row, viewer)) throw new Error('Unauthorized')
    if (row.archivedAt !== undefined) throw new Error('WORK_INVALID:archived')
    const scope = rowScope(row)
    const patch: Partial<WorkItemDoc> = {}
    const events: Array<{ kind: Parameters<typeof logWorkEvent>[1]['kind']; data?: unknown }> = []

    if (args.title !== undefined) {
      const title = normalizeTitle(args.title)
      if (title !== row.title) { patch.title = title; events.push({ kind: 'title', data: { from: row.title, to: title } }) }
    }
    if (args.description !== undefined) patch.description = args.description === null ? undefined : normalizeDescription(args.description)
    if (args.priority !== undefined && args.priority !== row.priority) {
      patch.priority = normalizePriority(args.priority)
      events.push({ kind: 'priority', data: { from: row.priority, to: args.priority } })
    }
    if (args.blocked !== undefined && args.blocked !== row.blocked) {
      patch.blocked = args.blocked
      events.push({ kind: 'blocked', data: { to: args.blocked } })
    }
    if (args.status !== undefined && args.status !== row.status) {
      patch.status = args.status
      patch.rank = await endRank(ctx, row.workspaceId, args.status)
      events.push({ kind: 'status', data: { from: row.status, to: args.status } })
    }
    if (args.assigneePrincipalId !== undefined && (args.assigneePrincipalId ?? undefined) !== row.assigneePrincipalId) {
      if (args.assigneePrincipalId !== null) {
        const creatorPrincipalId = (await loadWorkViewer(ctx, row.workspaceId, row.userId)).principalId
        await assertAssignable(ctx, { workspaceId: row.workspaceId, scope, creatorPrincipalId, principalId: args.assigneePrincipalId })
      }
      patch.assigneePrincipalId = args.assigneePrincipalId ?? undefined
      events.push({ kind: 'assignee', data: { from: row.assigneePrincipalId ?? null, to: args.assigneePrincipalId } })
    }
    if (args.reviewerUserId !== undefined && (args.reviewerUserId ?? undefined) !== row.reviewerUserId) {
      if (args.reviewerUserId !== null) {
        await assertReviewer(ctx, { workspaceId: row.workspaceId, scope, creatorUserId: row.userId, reviewerUserId: args.reviewerUserId })
      }
      patch.reviewerUserId = args.reviewerUserId ?? undefined
      events.push({ kind: 'reviewer', data: { from: row.reviewerUserId ?? null, to: args.reviewerUserId } })
    }
    if (args.startDate !== undefined || args.dueDate !== undefined) {
      const startDate = args.startDate === undefined ? row.startDate : args.startDate === null ? undefined : normalizeDate(args.startDate)
      const dueDate = args.dueDate === undefined ? row.dueDate : args.dueDate === null ? undefined : normalizeDate(args.dueDate)
      assertDateOrder(startDate, dueDate)
      if (startDate !== row.startDate || dueDate !== row.dueDate) {
        patch.startDate = startDate
        patch.dueDate = dueDate
        events.push({ kind: 'dates', data: { startDate: startDate ?? null, dueDate: dueDate ?? null } })
      }
    }
    if (args.parentId !== undefined && (args.parentId ?? undefined) !== (row.parentId ? String(row.parentId) : undefined)) {
      patch.parentId = args.parentId === null
        ? undefined
        : (await assertParent(ctx, { id: String(row._id), parentId: args.parentId, workspaceId: row.workspaceId, scope, userId: args.userId }))._id
    }
    if (args.doneWhen !== undefined) patch.doneWhen = normalizeDoneWhen(args.doneWhen)
    if (args.context !== undefined) patch.context = normalizeContext(args.context)

    if (Object.keys(patch).length === 0) return row
    await ctx.db.patch(row._id, { ...patch, updatedAt: Date.now() })
    for (const event of events) {
      await logWorkEvent(ctx, { workItemId: row._id, workspaceId: row.workspaceId, actorPrincipalId: viewer.principalId, ...event })
    }
    return await ctx.db.get(row._id)
  },
})

/**
 * Drops a task into a column: set its status and put it between two neighbours (either may be omitted for the top or
 * bottom). The server reads the neighbours' current ranks, so two people dragging at once still land sensibly.
 */
export const move = mutation({
  args: {
    ...auth,
    id: v.string(),
    status: v.optional(statusArg),
    afterId: v.optional(v.union(v.string(), v.null())),
    beforeId: v.optional(v.union(v.string(), v.null())),
  },
  handler: async (ctx, args) => {
    await authorize(args)
    const viewer = await loadWorkViewer(ctx, args.workspaceId, args.userId)
    const row = await getReadableRow(ctx, { row: await loadWorkItem(ctx, args.id), userId: args.userId, workspaceId: args.workspaceId })
    if (!row || !canWork(row, viewer)) throw new Error('Unauthorized')
    if (row.archivedAt !== undefined) throw new Error('WORK_INVALID:archived')
    const status = args.status ?? row.status

    const neighbour = async (id: string | null | undefined) => {
      if (!id || id === args.id) return null
      const found = await getReadableRow(ctx, { row: await loadWorkItem(ctx, id), userId: args.userId, workspaceId: args.workspaceId })
      return found && found.status === status ? found : null
    }
    const [above, below] = await Promise.all([neighbour(args.afterId), neighbour(args.beforeId)])
    const rank = above || below ? rankBetween(above?.rank ?? null, below?.rank ?? null) : await endRank(ctx, row.workspaceId, status)

    await ctx.db.patch(row._id, { status, rank, updatedAt: Date.now() })
    if (status !== row.status) {
      await logWorkEvent(ctx, { workItemId: row._id, workspaceId: row.workspaceId, actorPrincipalId: viewer.principalId, kind: 'status', data: { from: row.status, to: status } })
    }
    if (needsRebalance(rank)) await rebalanceColumn(ctx, row.workspaceId, status)
    return await ctx.db.get(row._id)
  },
})

export type WorkItemId = Id<'workItems'>
