import type {
  WorkspaceResourceGrant,
  WorkspaceResourceShareResponse,
  WorkspaceShareAccessRole,
  WorkspaceShareImpact,
  WorkspaceShareResourceType,
  WorkspaceShareTargetType,
} from '@overlay/workspace-contracts'
import type { HttpContext } from '../shared/http'

const WORKSPACE_HEADER = 'x-overlay-workspace-id'

export type WorkspaceShareResource = {
  workspaceId: string
  resourceType: WorkspaceShareResourceType
  resourceId: string
}

export class SharingClient {
  constructor(private readonly http: HttpContext) {}

  get(resource: WorkspaceShareResource, init?: RequestInit) {
    return this.http.json<WorkspaceResourceShareResponse>(this.path(resource), workspaceInit(resource.workspaceId, init))
  }

  grant(
    resource: WorkspaceShareResource,
    body: {
      targetType: WorkspaceShareTargetType
      targetId: string
      accessRole: WorkspaceShareAccessRole
      confirmRoomExpansion?: boolean
    },
    init?: RequestInit,
  ) {
    return this.http.json<{ grant: WorkspaceResourceGrant }>(
      '/api/v1/shares',
      this.http.jsonRequest({ ...resource, workspaceId: undefined, ...body }, {
        ...workspaceInit(resource.workspaceId, init),
        method: 'POST',
      }),
    )
  }

  /** Who a pending grant would reach, or who a revocation would cut off. */
  impact(
    resource: WorkspaceShareResource,
    target: { targetType: WorkspaceShareTargetType; targetId: string } | { grantId: string },
    init?: RequestInit,
  ) {
    return this.http.json<{ impact: WorkspaceShareImpact }>(
      this.http.appendQuery('/api/v1/shares/impact', {
        resourceType: resource.resourceType,
        resourceId: resource.resourceId,
        ...('grantId' in target
          ? { grantId: target.grantId }
          : { targetType: target.targetType, targetId: target.targetId }),
      }),
      workspaceInit(resource.workspaceId, init),
    )
  }

  revoke(resource: WorkspaceShareResource, grantId: string, init?: RequestInit) {
    return this.http.json<{ removed: true }>(
      '/api/v1/shares',
      this.http.jsonRequest({ ...resource, workspaceId: undefined, grantId }, {
        ...workspaceInit(resource.workspaceId, init),
        method: 'DELETE',
      }),
    )
  }

  private path(resource: WorkspaceShareResource) {
    return this.http.appendQuery('/api/v1/shares', {
      resourceType: resource.resourceType,
      resourceId: resource.resourceId,
    })
  }
}

function workspaceInit(workspaceId: string, init?: RequestInit): RequestInit {
  const headers = new Headers(init?.headers)
  headers.set(WORKSPACE_HEADER, workspaceId)
  return { ...init, headers }
}
