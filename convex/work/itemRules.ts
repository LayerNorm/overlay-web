import type { Doc, Id } from '../_generated/dataModel'
import type { MutationCtx } from '../_generated/server'
import { getReadableRow } from '../lib/resourceScope'
import { WORK_ITEM_LIMITS, isWorkItemOrderKey, nextWorkItemOrderKey } from '../../src/shared/work/work-items'

/** Rules shared by the work item mutations: field limits, numbering, assignees, nesting, and column order. */

export function invalid(field: string): never {
  throw new Error(`WORK_ITEM_INVALID:${field}`)
}

/** Size and shape limits; the API route checks the same limits so the caller gets a 400 with the field name. */
export function validateFields(fields: { title?: string; description?: string; labels?: string[]; orderKey?: string }) {
  if (fields.title !== undefined && fields.title.trim().length > WORK_ITEM_LIMITS.title) invalid('title')
  if (fields.description !== undefined && fields.description.length > WORK_ITEM_LIMITS.description) invalid('description')
  if (fields.labels !== undefined) {
    if (fields.labels.length > WORK_ITEM_LIMITS.labelCount) invalid('labels')
    if (fields.labels.some((label) => label.trim().length === 0 || label.trim().length > WORK_ITEM_LIMITS.labelLength)) invalid('labels')
  }
  if (fields.orderKey !== undefined && !isWorkItemOrderKey(fields.orderKey)) invalid('orderKey')
}

export function cleanLabels(labels: string[] | undefined): string[] | undefined {
  return labels === undefined ? undefined : [...new Set(labels.map((label) => label.trim()))]
}

/**
 * Item numbers are counted per scope: shared items share one counter per workspace, and each person's private items
 * have their own. One counter for both would let teammates infer how many private items exist from the gaps.
 */
export function workItemCounterKey(scope: 'personal' | 'workspace', userId: string, workspaceId: string | undefined): string {
  if (scope === 'workspace' && workspaceId) return `workspace:${workspaceId}`
  return workspaceId ? `personal:${userId}:${workspaceId}` : `personal:${userId}`
}

/** Allocates the next `OVR-<n>` number from `counterKey`, incrementing it. */
export async function allocateItemNumber(ctx: MutationCtx, counterKey: string): Promise<number> {
  const counter = await ctx.db
    .query('workItemCounters')
    .withIndex('by_scopeKey', (q) => q.eq('scopeKey', counterKey))
    .unique()
  if (!counter) {
    await ctx.db.insert('workItemCounters', { scopeKey: counterKey, nextNumber: 2 })
    return 1
  }
  await ctx.db.patch(counter._id, { nextNumber: counter.nextNumber + 1 })
  return counter.nextNumber
}

/**
 * Whether `assignee` (a workspace principal id) may be assigned an item in `scope`. A shared item can go to any active
 * member or any agent of the workspace; a private one only to its creator or an agent, since nobody else can see it.
 */
export async function isValidAssignee(
  ctx: { db: MutationCtx['db'] },
  args: { assignee: string; workspaceId: string | undefined; scope: 'personal' | 'workspace'; userId: string },
): Promise<boolean> {
  if (!args.workspaceId) return false
  const principal = await ctx.db
    .query('workspacePrincipals')
    .withIndex('by_principalId', (q) => q.eq('principalId', args.assignee))
    .first()
  if (!principal || principal.workspaceId !== args.workspaceId || principal.archivedAt !== undefined) return false
  if (principal.type === 'agent') return true
  if (principal.type !== 'human') return false
  if (args.scope === 'personal' && principal.userId !== args.userId) return false
  const membership = await ctx.db
    .query('workspaceMemberships')
    .withIndex('by_workspaceId_principalId', (q) => q.eq('workspaceId', args.workspaceId!).eq('principalId', args.assignee))
    .unique()
  return membership?.status === 'active'
}

export async function assertValidAssignee(
  ctx: { db: MutationCtx['db'] },
  args: { assignee: string; workspaceId: string | undefined; scope: 'personal' | 'workspace'; userId: string },
) {
  if (!(await isValidAssignee(ctx, args))) throw new Error('WORK_ITEM_ASSIGNEE_INVALID')
}

/**
 * A parent must be a live, readable, top-level item in the same workspace and scope as the child, and (when the child
 * already exists) the child must not have subtasks of its own: nesting is one level deep.
 */
export async function assertValidParent(
  ctx: MutationCtx,
  args: { parentId: Id<'workItems'>; userId: string; workspaceId: string | undefined; scope: 'personal' | 'workspace'; childId?: Id<'workItems'> },
) {
  const parent = await getReadableRow(ctx, { row: await ctx.db.get(args.parentId), userId: args.userId, workspaceId: args.workspaceId })
  if (
    !parent || parent.deletedAt || parent.archivedAt !== undefined || parent.parentItemId !== undefined ||
    parent._id === args.childId || parent.workspaceId !== args.workspaceId || (parent.scope ?? 'personal') !== args.scope
  ) throw new Error('WORK_ITEM_PARENT_INVALID')
  if (args.childId !== undefined) {
    const subtask = await ctx.db
      .query('workItems')
      .withIndex('by_parentItemId', (q) => q.eq('parentItemId', args.childId))
      .filter((q) => q.eq(q.field('deletedAt'), undefined))
      .first()
    if (subtask) throw new Error('WORK_ITEM_PARENT_INVALID')
  }
}

/**
 * The orderKey to append after the last item in a column (a status, under one parent), among the items the caller owns
 * or shares. Reads the newest key through the index instead of the whole column.
 */
export async function appendOrderKey(
  ctx: MutationCtx,
  args: {
    userId: string
    workspaceId: string | undefined
    scope: 'personal' | 'workspace'
    status: Doc<'workItems'>['status']
    parentItemId?: Id<'workItems'>
  },
): Promise<string> {
  const base = args.workspaceId !== undefined
    ? ctx.db.query('workItems').withIndex('by_workspaceId_status_orderKey', (q) => q.eq('workspaceId', args.workspaceId!).eq('status', args.status))
    : ctx.db.query('workItems').withIndex('by_userId_status_orderKey', (q) => q.eq('userId', args.userId).eq('status', args.status))
  const newest = await base
    .order('desc')
    .filter((q) => q.and(
      q.eq(q.field('deletedAt'), undefined),
      q.eq(q.field('archivedAt'), undefined),
      q.eq(q.field('parentItemId'), args.parentItemId),
      args.scope === 'workspace'
        ? q.eq(q.field('scope'), 'workspace')
        : q.and(q.or(q.eq(q.field('scope'), 'personal'), q.eq(q.field('scope'), undefined)), q.eq(q.field('userId'), args.userId)),
      args.workspaceId === undefined ? q.eq(q.field('workspaceId'), undefined) : q.eq(q.field('workspaceId'), args.workspaceId),
    ))
    .first()
  return nextWorkItemOrderKey(newest ? [newest.orderKey] : [])
}
