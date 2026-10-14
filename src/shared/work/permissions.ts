/**
 * Who may do what to a task. Builds on the shared Personal / Workspace rules: visibility, moving between scopes, and
 * archiving follow `resource-scope.ts` exactly. Editing is wider than for most content, because a workspace task is
 * worked on by its assignee, not only by whoever wrote it.
 */
import {
  DEFAULT_RESOURCE_SCOPE_POLICY,
  canEditResource,
  rowScope,
  type ResourceScopePolicy,
  type ResourceViewer,
  type ScopedRow,
} from '../workspaces/resource-scope'

export type WorkEditRow = ScopedRow & { assigneePrincipalId?: string | null }

/**
 * Edit fields, change status, comment. The creator, and owners and admins of workspace tasks, as for any content.
 * Plus: members of a workspace task, when the workspace lets members edit workspace content, or when it is assigned to
 * them. Guests and people outside the workspace never.
 */
export function canWorkOnItem(
  row: WorkEditRow,
  viewer: ResourceViewer,
  viewerPrincipalId: string | null,
  policy: ResourceScopePolicy = DEFAULT_RESOURCE_SCOPE_POLICY,
): boolean {
  if (canEditResource(row, viewer)) return true
  if (rowScope(row) !== 'workspace') return false
  if (viewer.role !== 'owner' && viewer.role !== 'admin' && viewer.role !== 'member') return false
  if (policy.workspaceContentEditors === 'members') return true
  return viewerPrincipalId !== null && row.assigneePrincipalId === viewerPrincipalId
}
