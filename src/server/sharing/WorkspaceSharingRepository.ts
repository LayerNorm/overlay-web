import 'server-only'

import type {
  WorkspaceResourceGrant,
  WorkspaceShareAccessRole,
  WorkspaceShareResourceType,
  WorkspaceShareTargetType,
} from '@overlay/workspace-contracts'

export type UpsertWorkspaceResourceGrant = {
  id: string
  workspaceId: string
  resourceType: WorkspaceShareResourceType
  resourceId: string
  targetType: WorkspaceShareTargetType
  targetId: string
  accessRole: WorkspaceShareAccessRole
  grantedByPrincipalId: string
  now: number
}

export interface WorkspaceSharingRepository {
  upsert(input: UpsertWorkspaceResourceGrant): Promise<WorkspaceResourceGrant>
  remove(args: { grantId: string; workspaceId: string }): Promise<boolean>
  listForResource(args: {
    workspaceId: string
    resourceType: WorkspaceShareResourceType
    resourceId: string
  }): Promise<WorkspaceResourceGrant[]>
  listForTargets(args: {
    workspaceId: string
    resourceType?: WorkspaceShareResourceType
    principalIds: string[]
    teamIds: string[]
    roomIds: string[]
  }): Promise<WorkspaceResourceGrant[]>
}
