import type {
  WorkspaceAccess,
  WorkspaceSummary,
} from '@overlay/workspace-contracts'

export function toWorkspaceSummary(
  access: WorkspaceAccess,
  options: { memberCount?: number } = {},
): WorkspaceSummary {
  return {
    id: access.workspace.id,
    name: access.workspace.name,
    slug: access.workspace.slug,
    kind: access.workspace.kind,
    status: access.workspace.status,
    role: access.membership.role,
    ...(options.memberCount === undefined ? {} : { memberCount: options.memberCount }),
  }
}
