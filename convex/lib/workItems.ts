import type { Doc, Id } from '../_generated/dataModel'
import type { MutationCtx, QueryCtx } from '../_generated/server'
import { loadScopeContext, type ScopeContext } from './resourceScope'
import { canWorkOnItem } from '../../src/shared/work/permissions'
import {
  WORK_LIMITS,
  isWorkDate,
  type WorkContextRef,
  type WorkDoneWhen,
  type WorkEventKind,
} from '../../src/shared/work/status'
import { rankBetween, needsRebalance, spreadRanks, compareRanked } from '../../src/shared/work/rank'

type Ctx = QueryCtx | MutationCtx
export type WorkItemDoc = Doc<'workItems'>

/** The row for an id string, or null when it is not a work item id. */
export async function loadWorkItem(ctx: Ctx, id: string): Promise<WorkItemDoc | null> {
  const normalized = ctx.db.normalizeId('workItems', id)
  return normalized ? await ctx.db.get(normalized) : null
}

/** The principal id of a person in a workspace. Falls back to a stable placeholder for people from before principals. */
export async function principalIdForUser(ctx: Ctx, workspaceId: string, userId: string): Promise<string> {
  const principal = await ctx.db
    .query('workspacePrincipals')
    .withIndex('by_workspaceId_userId', (q) => q.eq('workspaceId', workspaceId).eq('userId', userId))
    .unique()
  return principal?.principalId ?? `user:${userId}`
}

/** What a viewer may do to a row: the scope context plus their principal, loaded once. */
export async function loadWorkViewer(ctx: Ctx, workspaceId: string, userId: string): Promise<ScopeContext & { principalId: string }> {
  const [scope, principalId] = await Promise.all([loadScopeContext(ctx, workspaceId, userId), principalIdForUser(ctx, workspaceId, userId)])
  return { ...scope, principalId }
}

export function canWork(row: WorkItemDoc, viewer: ScopeContext & { principalId: string }): boolean {
  return canWorkOnItem(row, viewer.viewer, viewer.principalId, viewer.policy)
}

export async function logWorkEvent(
  ctx: MutationCtx,
  args: { workItemId: Id<'workItems'>; workspaceId: string; actorPrincipalId: string; kind: WorkEventKind; data?: unknown },
) {
  await ctx.db.insert('workItemEvents', {
    workItemId: args.workItemId,
    workspaceId: args.workspaceId,
    actorPrincipalId: args.actorPrincipalId,
    kind: args.kind,
    ...(args.data !== undefined ? { data: args.data } : {}),
    createdAt: Date.now(),
  })
}

/**
 * Whether `principalId` can be assigned a task in `scope`. A personal task is only ever the creator's own; a workspace
 * task may go to any active person (not a guest) or agent of the workspace.
 */
export async function assertAssignable(
  ctx: Ctx,
  args: { workspaceId: string; scope: 'personal' | 'workspace'; creatorPrincipalId: string; principalId: string },
) {
  if (args.scope === 'personal') {
    if (args.principalId !== args.creatorPrincipalId) throw new Error('WORK_INVALID:personal_assignee')
    return
  }
  const principal = await ctx.db
    .query('workspacePrincipals')
    .withIndex('by_principalId', (q) => q.eq('principalId', args.principalId))
    .unique()
  if (!principal || principal.workspaceId !== args.workspaceId || principal.archivedAt !== undefined) throw new Error('WORK_INVALID:assignee')
  if (principal.type === 'human') {
    const membership = await ctx.db
      .query('workspaceMemberships')
      .withIndex('by_workspaceId_principalId', (q) => q.eq('workspaceId', args.workspaceId).eq('principalId', args.principalId))
      .unique()
    if (membership?.status !== 'active' || membership.role === 'guest') throw new Error('WORK_INVALID:assignee')
  }
}

/** A reviewer is a person who can read the task: the creator for a personal one, any active non-guest member otherwise. */
export async function assertReviewer(
  ctx: Ctx,
  args: { workspaceId: string; scope: 'personal' | 'workspace'; creatorUserId: string; reviewerUserId: string },
) {
  if (args.scope === 'personal') {
    if (args.reviewerUserId !== args.creatorUserId) throw new Error('WORK_INVALID:personal_reviewer')
    return
  }
  const { viewer } = await loadScopeContext(ctx, args.workspaceId, args.reviewerUserId)
  if (viewer.role === null || viewer.role === 'guest') throw new Error('WORK_INVALID:reviewer')
}

export function normalizeTitle(title: string): string {
  const trimmed = title.trim()
  if (!trimmed) throw new Error('WORK_INVALID:title_required')
  if (trimmed.length > WORK_LIMITS.title) throw new Error('WORK_INVALID:title_too_long')
  return trimmed
}

export function normalizeDescription(description: string): string {
  if (description.length > WORK_LIMITS.description) throw new Error('WORK_INVALID:description_too_long')
  return description
}

export function normalizeDate(value: string): string {
  if (!isWorkDate(value)) throw new Error('WORK_INVALID:date')
  return value
}

export function assertDateOrder(startDate: string | undefined, dueDate: string | undefined) {
  if (startDate !== undefined && dueDate !== undefined && startDate > dueDate) throw new Error('WORK_INVALID:date_order')
}

export function normalizePriority(priority: number): number {
  if (priority !== 1 && priority !== 2 && priority !== 3) throw new Error('WORK_INVALID:priority')
  return priority
}

export function normalizeDoneWhen(items: WorkDoneWhen[]): WorkDoneWhen[] {
  const cleaned = items
    .map((item) => ({ text: item.text.trim(), checked: item.checked }))
    .filter((item) => item.text.length > 0)
  if (cleaned.length > WORK_LIMITS.doneWhenItems || cleaned.some((item) => item.text.length > WORK_LIMITS.doneWhenText)) {
    throw new Error('WORK_INVALID:done_when')
  }
  return cleaned
}

export function normalizeContext(items: WorkContextRef[]): WorkContextRef[] {
  if (items.length > WORK_LIMITS.contextItems) throw new Error('WORK_INVALID:context')
  return items.map((item) => {
    const label = item.label.trim()
    if (!item.id || item.id.length > WORK_LIMITS.contextId || !label || label.length > WORK_LIMITS.contextLabel) throw new Error('WORK_INVALID:context')
    return { type: item.type, id: item.id, label }
  })
}

/**
 * The rank that puts a task at the end of a column. Appending keeps lengthening the last rank, so when it has grown
 * long the column is renumbered first and the new rank is taken from the short ones.
 */
export async function endRank(ctx: MutationCtx, workspaceId: string, status: WorkItemDoc['status']): Promise<string> {
  const lastRank = async () => (await ctx.db
    .query('workItems')
    .withIndex('by_workspaceId_status_rank', (q) => q.eq('workspaceId', workspaceId).eq('status', status))
    .order('desc')
    .first())?.rank ?? null
  const rank = rankBetween(await lastRank(), null)
  if (!needsRebalance(rank)) return rank
  await rebalanceColumn(ctx, workspaceId, status)
  return rankBetween(await lastRank(), null)
}

/**
 * Re-spreads the ranks of one column so they are short again, keeping the order everyone sees. Every row in the column
 * is renumbered (hidden personal ones included) so relative order between a person's own and shared tasks holds.
 */
export async function rebalanceColumn(ctx: MutationCtx, workspaceId: string, status: WorkItemDoc['status']) {
  const rows = await ctx.db
    .query('workItems')
    .withIndex('by_workspaceId_status_rank', (q) => q.eq('workspaceId', workspaceId).eq('status', status))
    .collect()
  const ordered = rows.map((row) => ({ row, rank: row.rank, createdAt: row.createdAt, id: String(row._id) })).sort(compareRanked)
  const ranks = spreadRanks(ordered.length)
  await Promise.all(ordered.map(({ row }, index) => (row.rank === ranks[index] ? null : ctx.db.patch(row._id, { rank: ranks[index] }))))
}

export { needsRebalance }
