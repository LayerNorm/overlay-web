import type {
  WorkspaceAccess,
  WorkspaceSummary,
} from '@overlay/workspace-contracts'
import type { WorkspaceService } from '@/server/workspaces/WorkspaceService'

export function toWorkspaceSummary(
  access: WorkspaceAccess,
  options: { memberCount?: number; humanMemberCount?: number } = {},
): WorkspaceSummary {
  return {
    id: access.workspace.id,
    name: access.workspace.name,
    slug: access.workspace.slug,
    kind: access.workspace.kind,
    status: access.workspace.status,
    role: access.membership.role,
    ...(options.memberCount === undefined ? {} : { memberCount: options.memberCount }),
    ...(options.humanMemberCount === undefined ? {} : { humanMemberCount: options.humanMemberCount }),
  }
}

export async function toWorkspaceSummaryWithRoutingHandle(
  service: Pick<WorkspaceService, 'resolveWorkspaceHandle'>,
  userId: string,
  access: WorkspaceAccess,
  options: { memberCount?: number; humanMemberCount?: number } = {},
): Promise<WorkspaceSummary> {
  const summary = toWorkspaceSummary(access, options)
  try {
    const resolution = await service.resolveWorkspaceHandle({
      userId,
      handle: access.workspace.slug,
    })
    return resolution?.workspaceId === access.workspace.id
      ? { ...summary, routingHandle: resolution.canonicalHandle }
      : summary
  } catch (_error) {
    return summary
  }
}
