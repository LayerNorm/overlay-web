import type { MutationCtx } from '../_generated/server'
import type { Doc, Id } from '../_generated/dataModel'
import { rankBetween, rebalanceRanks } from '../../src/shared/work/rank'
import { fail, readable, type WorkActor } from './rules'
type Column = Pick<Doc<'workItems'>, 'workspaceId' | 'userId' | 'scope' | 'status'>
function column(ctx: MutationCtx, row: Column) {
  return row.scope === 'workspace'
    ? ctx.db.query('workItems').withIndex('by_workspaceId_scope_status_rank', (q) => q.eq('workspaceId', row.workspaceId).eq('scope', row.scope).eq('status', row.status))
    : ctx.db.query('workItems').withIndex('by_workspaceId_userId_scope_status_rank', (q) => q.eq('workspaceId', row.workspaceId).eq('userId', row.userId).eq('scope', row.scope).eq('status', row.status))
}
async function rebalance(ctx: MutationCtx, row: Column) {
  const rows = await column(ctx, row).filter((q) => q.eq(q.field('archivedAt'), undefined)).take(2001)
  if (rows.length > 2000) fail('INVALID', 'This column is too large to rebalance. Move tasks to another status first')
  const ranks = rebalanceRanks(rows.length)
  for (let i = 0; i < rows.length; i++) await ctx.db.patch(rows[i]._id, { rank: ranks[i] })
}
export async function appendRank(ctx: MutationCtx, row: Column) {
  const last = await column(ctx, row).filter((q) => q.eq(q.field('archivedAt'), undefined)).order('desc').first()
  try { return rankBetween(last?.rank) } catch {
    await rebalance(ctx, row)
    const refreshed = await column(ctx, row).filter((q) => q.eq(q.field('archivedAt'), undefined)).order('desc').first()
    return rankBetween(refreshed?.rank)
  }
}
export async function placementRank(ctx: MutationCtx, actor: WorkActor, row: Doc<'workItems'>, status: Doc<'workItems'>['status'], beforeId?: Id<'workItems'>, afterId?: Id<'workItems'>) {
  const target = { ...row, status }
  async function neighbor(id?: Id<'workItems'>) {
    if (!id) return null
    const other = await readable(ctx, actor, id)
    if (id === row._id || other.archivedAt !== undefined || other.scope !== row.scope || other.status !== status || (row.scope === 'personal' && other.userId !== row.userId)) fail('INVALID', 'Choose a neighboring task in the same scope and column')
    return other
  }
  if (!beforeId && !afterId) return appendRank(ctx, target)
  let before = await neighbor(beforeId); let after = await neighbor(afterId)
  if (before && after && before.rank >= after.rank) { await rebalance(ctx, target); before = await neighbor(beforeId); after = await neighbor(afterId) }
  // The gap must still be adjacent in the database, not just in a filtered/stale board.
  const next = await column(ctx, target).filter((q) => q.and(q.eq(q.field('archivedAt'), undefined), q.neq(q.field('_id'), row._id), before ? q.gt(q.field('rank'), before.rank) : q.eq(q.field('scope'), row.scope))).first()
  if (next?._id !== after?._id) fail('CONFLICT', 'This column changed. Refresh the board before moving the task')
  try { return rankBetween(before?.rank, after?.rank) } catch {
    await rebalance(ctx, target)
    before = await neighbor(beforeId); after = await neighbor(afterId)
    return rankBetween(before?.rank, after?.rank)
  }
}
