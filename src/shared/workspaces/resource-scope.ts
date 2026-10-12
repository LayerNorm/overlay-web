/**
 * Personal / Workspace / Archived scoping for workspace resources (files, notes, outputs, skills, MCP servers,
 * connectors, automations). One rule set, used by Convex and the server, so a list can never forget it.
 *
 * - `personal`: mine within this workspace; only I can see it.
 * - `workspace`: shared with the workspace's members.
 * - Archived is a state, not a scope: an archived row keeps the scope it was archived from, and restoring returns to it.
 *
 * See docs/plans/UNIFIED_SCOPES_PLAN.md.
 */

export const RESOURCE_SCOPES = ['personal', 'workspace'] as const
export type ResourceScope = (typeof RESOURCE_SCOPES)[number]

export const RESOURCE_VIEWS = ['personal', 'workspace', 'archived'] as const
export type ResourceView = (typeof RESOURCE_VIEWS)[number]

/** Who may create or edit workspace-scoped items. */
export const SCOPE_EDITORS = ['members', 'admins'] as const
export type ScopeEditors = (typeof SCOPE_EDITORS)[number]

/**
 * `extension`: skills, MCP servers, connectors (they hold credentials or run code).
 * `content`: notes, files, outputs, automations.
 */
export type ResourceKind = 'extension' | 'content'

/** The admin settings that govern scopes (stored on the workspace policy). */
export type ResourceScopePolicy = {
  workspaceExtensionsEditors: ScopeEditors
  workspaceContentEditors: ScopeEditors
  memberCanMoveScope: boolean
}

export const DEFAULT_RESOURCE_SCOPE_POLICY: ResourceScopePolicy = {
  workspaceExtensionsEditors: 'members',
  workspaceContentEditors: 'members',
  memberCanMoveScope: true,
}

export type ScopedRow = {
  userId: string
  scope?: ResourceScope
  archivedAt?: number
  archivedFromScope?: ResourceScope
}

export type ResourceViewer = {
  userId: string
  /** The viewer's active role in the workspace; null when they are not an active member. */
  role: 'owner' | 'admin' | 'member' | 'guest' | null
}

function isManager(viewer: ResourceViewer): boolean {
  return viewer.role === 'owner' || viewer.role === 'admin'
}

function isMember(viewer: ResourceViewer): boolean {
  return viewer.role === 'owner' || viewer.role === 'admin' || viewer.role === 'member'
}

/** A row's scope; rows from before scopes existed are personal. An archived row reports the scope it came from. */
export function rowScope(row: ScopedRow): ResourceScope {
  if (row.archivedAt !== undefined) return row.archivedFromScope ?? row.scope ?? 'personal'
  return row.scope ?? 'personal'
}

/** Which sidebar view a row belongs to. */
export function rowView(row: ScopedRow): ResourceView {
  return row.archivedAt !== undefined ? 'archived' : rowScope(row)
}

/** Personal rows are readable by their creator only; workspace rows by every active member (not guests). */
export function canReadResource(row: ScopedRow, viewer: ResourceViewer): boolean {
  if (!isMember(viewer)) return false
  return rowScope(row) === 'workspace' || row.userId === viewer.userId
}

/** Whether `viewer` may create something in `scope` (personal is always allowed for a member). */
export function canCreateInScope(
  kind: ResourceKind,
  scope: ResourceScope,
  viewer: ResourceViewer,
  policy: ResourceScopePolicy = DEFAULT_RESOURCE_SCOPE_POLICY,
): boolean {
  if (!isMember(viewer)) return false
  if (scope === 'personal') return true
  const editors = kind === 'extension' ? policy.workspaceExtensionsEditors : policy.workspaceContentEditors
  return editors === 'members' || isManager(viewer)
}

/**
 * Edit, archive, restore, delete. The creator always; owners and admins for workspace-scoped items.
 * Nobody else, and never someone else's personal item.
 */
export function canEditResource(row: ScopedRow, viewer: ResourceViewer): boolean {
  if (!isMember(viewer)) return false
  if (row.userId === viewer.userId) return true
  return rowScope(row) === 'workspace' && isManager(viewer)
}

export type MoveDenial = 'not_creator' | 'archived' | 'same_scope' | 'move_disabled' | 'workspace_creation_restricted'

/**
 * Moving an item between Personal and Workspace: only its creator, only when the policy lets members move items
 * (owners and admins always can, for items they created), and moving *to* Workspace needs permission to create there.
 * No one, admins included, moves someone else's item.
 */
export function checkMoveResource(
  kind: ResourceKind,
  row: ScopedRow,
  to: ResourceScope,
  viewer: ResourceViewer,
  policy: ResourceScopePolicy = DEFAULT_RESOURCE_SCOPE_POLICY,
): { ok: true } | { ok: false; reason: MoveDenial } {
  if (!isMember(viewer) || row.userId !== viewer.userId) return { ok: false, reason: 'not_creator' }
  if (row.archivedAt !== undefined) return { ok: false, reason: 'archived' }
  if (rowScope(row) === to) return { ok: false, reason: 'same_scope' }
  if (!policy.memberCanMoveScope && !isManager(viewer)) return { ok: false, reason: 'move_disabled' }
  if (to === 'workspace' && !canCreateInScope(kind, 'workspace', viewer, policy)) {
    return { ok: false, reason: 'workspace_creation_restricted' }
  }
  return { ok: true }
}

/** What an item row offers the viewer: the scope they may move it to, and whether they may archive or restore it. */
export type ScopeItemOptions = { moveTo: ResourceScope | null; canArchive: boolean; canRestore: boolean }

/**
 * The same rules the server enforces, as the buttons to show: only what will work. Move goes to the other scope;
 * archive and restore are for whoever may edit the item.
 */
export function scopeItemOptions(
  kind: ResourceKind,
  row: ScopedRow,
  viewer: ResourceViewer,
  policy: ResourceScopePolicy = DEFAULT_RESOURCE_SCOPE_POLICY,
): ScopeItemOptions {
  const archived = row.archivedAt !== undefined
  const editable = canEditResource(row, viewer)
  const to: ResourceScope = rowScope(row) === 'workspace' ? 'personal' : 'workspace'
  const move = checkMoveResource(kind, row, to, viewer, policy)
  return { moveTo: move.ok ? to : null, canArchive: editable && !archived, canRestore: editable && archived }
}

/** The fields to write when archiving: the row remembers who archived it and from which scope. */
export function archivePatch(row: ScopedRow, viewer: ResourceViewer, now: number): Required<Pick<ScopedRow, 'archivedAt' | 'archivedFromScope'>> & { archivedBy: string } {
  return { archivedAt: now, archivedBy: viewer.userId, archivedFromScope: rowScope(row) }
}

/** Does `row` appear in `view` for `viewer`? Combines visibility with the view's own filter. */
export function rowInView(row: ScopedRow, view: ResourceView, viewer: ResourceViewer): boolean {
  if (!canReadResource(row, viewer)) return false
  return rowView(row) === view
}

export function parseResourceView(value: unknown): ResourceView | undefined {
  return typeof value === 'string' && (RESOURCE_VIEWS as readonly string[]).includes(value) ? (value as ResourceView) : undefined
}

export function parseResourceScope(value: unknown): ResourceScope | undefined {
  return typeof value === 'string' && (RESOURCE_SCOPES as readonly string[]).includes(value) ? (value as ResourceScope) : undefined
}

/** Plain-language message for a failed move/archive/restore reason. */
export function scopeErrorMessage(reason: string): string {
  switch (reason) {
    case 'not_creator': return 'Only the person who created this can move it.'
    case 'archived': return 'Restore it first.'
    case 'same_scope': return 'It is already there.'
    case 'move_disabled': return 'This workspace does not let members move items between Personal and Workspace.'
    case 'workspace_creation_restricted': return 'Only owners and admins can create this in the workspace.'
    case 'already_archived': return 'It is already archived.'
    case 'not_archived': return 'It is not archived.'
    case 'not_found': return 'Not found.'
    default: return 'You do not have access to do that.'
  }
}
