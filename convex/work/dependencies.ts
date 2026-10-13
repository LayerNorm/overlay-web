import type { MutationCtx } from '../_generated/server'
import type { Doc, Id } from '../_generated/dataModel'
import { fail, readable, type WorkActor } from './rules'
export async function validateDependencies(
  ctx: MutationCtx,
  args: WorkActor,
  item: Doc<'workItems'>,
  blockedBy: Id<'workItems'>[],
) {
  if (blockedBy.length > 50 || new Set(blockedBy).size !== blockedBy.length)
    fail('INVALID', 'Choose at most 50 different dependencies')
  const pending = [...blockedBy]
  const visited = new Set<string>()
  while (pending.length) {
    const id = pending.pop()!
    if (id === item._id) fail('INVALID', 'Dependencies cannot form a cycle')
    if (visited.has(id)) continue
    visited.add(id)
    if (visited.size > 500) fail('INVALID', 'This dependency graph is too large to validate')
    const other = await readable(ctx, args, id)
    if (other.scope !== item.scope || (other.scope === 'personal' && other.userId !== item.userId))
      fail('INVALID', 'Dependencies must be in the same scope')
    if (blockedBy.includes(id) && other.archivedAt !== undefined)
      fail('INVALID', 'Choose a live dependency')
    pending.push(...(other.blockedBy ?? []))
  }
}
export async function syncDependencies(
  ctx: MutationCtx,
  item: Doc<'workItems'>,
  blockedBy: Id<'workItems'>[],
) {
  const edges = await ctx.db
    .query('workDependencies')
    .withIndex('by_fromItemId', (q) => q.eq('fromItemId', item._id))
    .take(51)
  for (const edge of edges) if (!blockedBy.includes(edge.toItemId)) await ctx.db.delete(edge._id)
  const existing = new Set(edges.map((edge) => edge.toItemId))
  for (const toItemId of blockedBy)
    if (!existing.has(toItemId))
      await ctx.db.insert('workDependencies', {
        workspaceId: item.workspaceId,
        userId: item.userId,
        fromItemId: item._id,
        toItemId,
      })
}
export async function hasIncomingDependency(ctx: MutationCtx, id: Id<'workItems'>) {
  return Boolean(
    await ctx.db
      .query('workDependencies')
      .withIndex('by_toItemId', (q) => q.eq('toItemId', id))
      .first(),
  )
}
