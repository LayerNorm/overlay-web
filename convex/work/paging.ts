import type { QueryCtx } from '../_generated/server'
import type { WorkActor } from './rules'
import { fail } from './rules'
import { listScopedRows } from '../lib/resourceScope'
type Scope = 'personal' | 'workspace'
type View = Scope | 'archived'
export async function workPage(
  ctx: QueryCtx,
  args: WorkActor & { view?: View; cursor?: string; limit?: number },
) {
  const scopes: Scope[] =
    args.view && args.view !== 'archived' ? [args.view] : ['personal', 'workspace']
  let scope = scopes[0]
  let cursor: string | null = null
  if (args.cursor) {
    try {
      const decoded: unknown = JSON.parse(args.cursor)
      if (
        !decoded ||
        typeof decoded !== 'object' ||
        !('scope' in decoded) ||
        !scopes.includes(decoded.scope as Scope) ||
        !('cursor' in decoded) ||
        (decoded.cursor !== null && typeof decoded.cursor !== 'string') ||
        !('view' in decoded) ||
        decoded.view !== (args.view ?? 'all')
      )
        throw new Error()
      scope = decoded.scope as Scope
      cursor = decoded.cursor
    } catch {
      fail('INVALID', 'Invalid task cursor')
    }
  }
  const limit = args.limit ?? 200
  if (!Number.isInteger(limit) || limit < 1 || limit > 200)
    fail('INVALID', 'Limit must be between 1 and 200')
  const source =
    scope === 'personal'
      ? ctx.db.query('workItems').withIndex('by_workspaceId_userId_scope_archivedAt', (q) => {
          const prefix = q
            .eq('workspaceId', args.workspaceId)
            .eq('userId', args.userId)
            .eq('scope', 'personal')
          return args.view === 'archived'
            ? prefix.gt('archivedAt', 0)
            : prefix.eq('archivedAt', undefined)
        })
      : ctx.db.query('workItems').withIndex('by_workspaceId_scope_archivedAt', (q) => {
          const prefix = q.eq('workspaceId', args.workspaceId).eq('scope', 'workspace')
          return args.view === 'archived'
            ? prefix.gt('archivedAt', 0)
            : prefix.eq('archivedAt', undefined)
        })
  const page = await source.paginate({ numItems: limit, cursor })
  const data = await listScopedRows(ctx, {
    userId: args.userId,
    workspaceId: args.workspaceId,
    view: args.view,
    fetchMine: async () => (scope === 'personal' ? page.page : []),
    fetchShared: async () => (scope === 'workspace' ? page.page : []),
  })
  const nextScope = scopes[scopes.indexOf(scope) + 1]
  const next = !page.isDone
    ? { scope, cursor: page.continueCursor }
    : nextScope
      ? { scope: nextScope, cursor: null }
      : null
  return {
    data,
    hasMore: next !== null,
    nextCursor: next ? JSON.stringify({ ...next, view: args.view ?? 'all' }) : null,
  }
}
