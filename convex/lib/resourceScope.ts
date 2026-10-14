import type { GenericDatabaseReader } from 'convex/server'
import type { DataModel } from '../_generated/dataModel'
import {
  DEFAULT_RESOURCE_SCOPE_POLICY,
  archivePatch,
  canCreateInScope,
  canEditResource,
  canReadResource,
  checkMoveResource,
  scopeErrorMessage,
  rowInView,
  type MoveDenial,
  type ResourceKind,
  type ResourceScope,
  type ResourceScopePolicy,
  type ResourceView,
  type ResourceViewer,
  type ScopedRow,
} from '../../src/shared/workspaces/resource-scope'

type Reader = { db: GenericDatabaseReader<DataModel> }

export type ScopeContext = {
  viewer: ResourceViewer
  policy: ResourceScopePolicy
}

/** The viewer's active role in a workspace (null when not an active member) and the workspace's scope policy. */
export async function loadScopeContext(ctx: Reader, workspaceId: string, userId: string): Promise<ScopeContext> {
  const principal = await ctx.db
    .query('workspacePrincipals')
    .withIndex('by_workspaceId_userId', (q) => q.eq('workspaceId', workspaceId).eq('userId', userId))
    .unique()
  let role: ResourceViewer['role'] = null
  if (principal && !principal.archivedAt) {
    const membership = await ctx.db
      .query('workspaceMemberships')
      .withIndex('by_workspaceId_principalId', (q) => q.eq('workspaceId', workspaceId).eq('principalId', principal.principalId))
      .unique()
    if (membership?.status === 'active') role = membership.role as ResourceViewer['role']
  }
  const row = await ctx.db
    .query('workspaceSharingPolicies')
    .withIndex('by_workspaceId', (q) => q.eq('workspaceId', workspaceId))
    .unique()
  const policy: ResourceScopePolicy = {
    workspaceExtensionsEditors: row?.workspaceExtensionsEditors ?? DEFAULT_RESOURCE_SCOPE_POLICY.workspaceExtensionsEditors,
    workspaceContentEditors: row?.workspaceContentEditors ?? DEFAULT_RESOURCE_SCOPE_POLICY.workspaceContentEditors,
    memberCanMoveScope: row?.memberCanMoveScope ?? DEFAULT_RESOURCE_SCOPE_POLICY.memberCanMoveScope,
  }
  return { viewer: { userId, role }, policy }
}

/**
 * Per-call cache of scope contexts, so a list over many rows looks up each workspace once. Rows with no workspace
 * (from before workspaces) are creator-only, as they always were.
 */
export function scopeContextLoader(ctx: Reader, userId: string) {
  const cache = new Map<string, Promise<ScopeContext>>()
  const load = (workspaceId: string) => {
    let entry = cache.get(workspaceId)
    if (!entry) {
      entry = loadScopeContext(ctx, workspaceId, userId)
      cache.set(workspaceId, entry)
    }
    return entry
  }
  return {
    load,
    async canRead(row: ScopedRow & { workspaceId?: string }): Promise<boolean> {
      if (!row.workspaceId) return row.userId === userId
      return canReadResource(row, (await load(row.workspaceId)).viewer)
    },
    async canEdit(row: ScopedRow & { workspaceId?: string }): Promise<boolean> {
      if (!row.workspaceId) return row.userId === userId
      return canEditResource(row, (await load(row.workspaceId)).viewer)
    },
    async inView(row: ScopedRow & { workspaceId?: string }, view: ResourceView): Promise<boolean> {
      if (!row.workspaceId) return row.userId === userId && (row.archivedAt !== undefined ? view === 'archived' : view === 'personal')
      return rowInView(row, view, (await load(row.workspaceId)).viewer)
    },
  }
}

/**
 * Rows of a table that `userId` can see in `workspaceId` for a view: their own (personal, workspace, or archived) plus
 * other members' workspace-scoped rows. `view` omitted means everything active (personal and workspace, not archived).
 */
export async function readableRowsInWorkspace<Row extends ScopedRow & { workspaceId?: string }>(args: {
  mine: Row[]
  workspaceShared: Row[]
  view?: ResourceView
  scope: ScopeContext
}): Promise<Row[]> {
  const byId = new Map<string, Row>()
  for (const row of [...args.mine, ...args.workspaceShared]) byId.set(String((row as unknown as { _id: string })._id), row)
  return [...byId.values()].filter((row) => {
    if (!canReadResource(row, args.scope.viewer)) return false
    if (args.view) return rowInView(row, args.view, args.scope.viewer)
    return row.archivedAt === undefined
  })
}

export type ScopeAction =
  | { ok: true }
  | { ok: false; reason: MoveDenial | 'not_found' | 'forbidden' | 'workspace_creation_restricted' | 'already_archived' | 'not_archived' }

export { scopeErrorMessage }

/** Checks creating a row in `scope`; throws the Convex error the callers surface. */
export async function assertCanCreateInScope(
  ctx: Reader,
  args: { kind: ResourceKind; scope: ResourceScope | undefined; workspaceId: string | undefined; userId: string },
): Promise<ResourceScope> {
  const scope = args.scope ?? 'personal'
  if (scope === 'personal') return 'personal'
  if (!args.workspaceId) throw new Error('RESOURCE_SCOPE_FORBIDDEN:workspace_required')
  const { viewer, policy } = await loadScopeContext(ctx, args.workspaceId, args.userId)
  if (!canCreateInScope(args.kind, 'workspace', viewer, policy)) throw new Error('RESOURCE_SCOPE_FORBIDDEN:workspace_creation_restricted')
  return 'workspace'
}

type MutableScopedRow = ScopedRow & { workspaceId?: string }

/** The patch for moving a row to `to`, or the reason it is refused. */
export async function planMove(
  ctx: Reader,
  args: { kind: ResourceKind; row: MutableScopedRow | null; to: ResourceScope; userId: string },
): Promise<{ ok: true; patch: { scope: ResourceScope } } | { ok: false; reason: string }> {
  if (!args.row) return { ok: false, reason: 'not_found' }
  if (!args.row.workspaceId) return { ok: false, reason: 'forbidden' }
  const { viewer, policy } = await loadScopeContext(ctx, args.row.workspaceId, args.userId)
  const check = checkMoveResource(args.kind, args.row, args.to, viewer, policy)
  return check.ok ? { ok: true, patch: { scope: args.to } } : { ok: false, reason: check.reason }
}

/** The patch for archiving a row (who may: anyone who can edit it). */
export async function planArchive(
  ctx: Reader,
  args: { row: MutableScopedRow | null; userId: string; now: number },
): Promise<{ ok: true; patch: ReturnType<typeof archivePatch> } | { ok: false; reason: string }> {
  if (!args.row) return { ok: false, reason: 'not_found' }
  if (args.row.archivedAt !== undefined) return { ok: false, reason: 'already_archived' }
  const loader = scopeContextLoader(ctx, args.userId)
  if (!(await loader.canEdit(args.row))) return { ok: false, reason: 'forbidden' }
  const viewer = args.row.workspaceId ? (await loader.load(args.row.workspaceId)).viewer : { userId: args.userId, role: null }
  return { ok: true, patch: archivePatch(args.row, viewer, args.now) }
}

/** Restoring an archived row returns it to the scope it was archived from. */
export async function planRestore(
  ctx: Reader,
  args: { row: MutableScopedRow | null; userId: string },
): Promise<{ ok: true; scope: ResourceScope } | { ok: false; reason: string }> {
  if (!args.row) return { ok: false, reason: 'not_found' }
  if (args.row.archivedAt === undefined) return { ok: false, reason: 'not_archived' }
  const loader = scopeContextLoader(ctx, args.userId)
  if (!(await loader.canEdit(args.row))) return { ok: false, reason: 'forbidden' }
  return { ok: true, scope: args.row.archivedFromScope ?? args.row.scope ?? 'personal' }
}

type ScopedTable = 'files' | 'skills' | 'mcpServers' | 'workspaceConnectors' | 'automations' | 'workItems'

/**
 * Gathers the rows `userId` can see for a list: with a workspace, their own rows plus other members' workspace-scoped
 * ones (filtered by the view); without a workspace (rows from before workspaces), just their own, as before.
 */
export async function listScopedRows<Row extends ScopedRow & { workspaceId?: string }>(
  ctx: Reader,
  args: {
    userId: string
    workspaceId: string | undefined
    view: ResourceView | undefined
    /** All the viewer's own rows (in the workspace when one is given). */
    fetchMine: () => Promise<Row[]>
    /** Workspace-scoped rows (active and archived) in the workspace, from the `by_workspaceId_scope_archivedAt` index. */
    fetchShared: (workspaceId: string) => Promise<Row[]>
  },
): Promise<Row[]> {
  const mine = await args.fetchMine()
  if (!args.workspaceId) {
    return mine.filter((row) => (args.view === 'archived' ? row.archivedAt !== undefined : row.archivedAt === undefined))
  }
  const scope = await loadScopeContext(ctx, args.workspaceId, args.userId)
  const workspaceShared = await args.fetchShared(args.workspaceId)
  return readableRowsInWorkspace({ mine, workspaceShared, view: args.view, scope })
}

/** Reads one row if the viewer may see it (optionally restricted to one workspace); otherwise null. */
export async function getReadableRow<Row extends ScopedRow & { workspaceId?: string }>(
  ctx: Reader,
  args: { row: Row | null; userId: string; workspaceId?: string },
): Promise<Row | null> {
  const { row } = args
  if (!row) return null
  if (args.workspaceId !== undefined && row.workspaceId !== args.workspaceId) return null
  return (await scopeContextLoader(ctx, args.userId).canRead(row)) ? row : null
}

export type { ScopedTable }
