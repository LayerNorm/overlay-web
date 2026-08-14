import type {
  TeamMemberPrincipalType,
  Workspace,
  WorkspaceAccess,
  WorkspaceInvitation,
  WorkspaceMembership,
  WorkspaceMembershipRole,
  WorkspaceMembershipStatus,
  WorkspacePrincipal,
  WorkspacePrincipalType,
  WorkspaceResourceGuest,
  WorkspaceResourceScope,
  WorkspaceAuditExportRecord,
  WorkspaceIdentityMapping,
  WorkspaceSharingPolicy,
  WorkspaceSharingPolicyPatch,
  WorkspaceTeam,
  WorkspaceTeamMember,
} from '@overlay/workspace-contracts'

export type SetWorkspaceSharingPolicyInput = {
  workspaceId: string
  patch: WorkspaceSharingPolicyPatch
  updatedByPrincipalId: string
  now: number
}

export type EnsurePersonalWorkspaceInput = {
  workspaceId: string
  slug: string
  principalId: string
  userId: string
  displayName: string
  email?: string
  now: number
}

export type CreateOrganizationWorkspaceInput = {
  workspaceId: string
  ownerPrincipalId: string
  actorUserId: string
  ownerDisplayName: string
  ownerEmail?: string
  name: string
  slug: string
  now: number
}

export type CreateWorkspacePrincipalInput = {
  id: string
  workspaceId: string
  type: WorkspacePrincipalType
  userId?: string
  agentId?: string
  serviceId?: string
  displayName: string
  email?: string
  createdByPrincipalId?: string
  now: number
}

export type CreateWorkspaceInvitationInput = {
  id: string
  workspaceId: string
  email: string
  role: Exclude<WorkspaceMembershipRole, 'owner'>
  invitedByPrincipalId: string
  expiresAt: number
  now: number
}

export type AcceptWorkspaceInvitationInput = {
  invitationId: string
  principalId: string
  userId: string
  email: string
  displayName: string
  now: number
}

export type InvitationAcceptanceResult =
  | { status: 'accepted'; access: WorkspaceAccess; invitation: WorkspaceInvitation }
  | { status: 'not_found' | 'not_pending' | 'expired' | 'email_mismatch' }

export type MembershipMutationResult =
  | { status: 'updated'; membership: WorkspaceMembership }
  | { status: 'not_found' | 'last_owner' | 'owner_must_be_human' | 'personal_owner_bound' }

export type MembershipRemovalResult =
  | { status: 'removed' }
  | { status: 'not_found' | 'last_owner' | 'personal_owner_bound' }

export type OwnershipTransferResult =
  | {
    status: 'transferred'
    previousOwnerMembership: WorkspaceMembership
    newOwnerMembership: WorkspaceMembership
  }
  | {
    status:
      | 'not_found'
      | 'source_not_owner'
      | 'target_not_human'
      | 'target_inactive'
      | 'personal_owner_bound'
  }

export interface WorkspaceRepository {
  ensurePersonalWorkspace(input: EnsurePersonalWorkspaceInput): Promise<WorkspaceAccess>
  createOrganization(input: CreateOrganizationWorkspaceInput): Promise<WorkspaceAccess>
  getWorkspace(workspaceId: string): Promise<Workspace | null>
  listForUser(userId: string, options?: { includeArchived?: boolean }): Promise<WorkspaceAccess[]>
  getAccess(args: { workspaceId: string; userId: string }): Promise<WorkspaceAccess | null>
  getActiveWorkspace(userId: string): Promise<WorkspaceAccess | null>
  setActiveWorkspace(args: { userId: string; workspaceId: string; now: number }): Promise<WorkspaceAccess | null>
  archiveWorkspace(args: {
    workspaceId: string
    archivedByPrincipalId: string
    now: number
  }): Promise<Workspace | null>

  createPrincipal(input: CreateWorkspacePrincipalInput): Promise<WorkspacePrincipal>
  getPrincipal(principalId: string): Promise<WorkspacePrincipal | null>
  getHumanPrincipal(args: { workspaceId: string; userId: string }): Promise<WorkspacePrincipal | null>
  updatePrincipal(args: {
    principalId: string
    workspaceId: string
    displayName?: string
    email?: string
    now: number
  }): Promise<WorkspacePrincipal>
  listPrincipals(args: {
    workspaceId: string
    includeArchived?: boolean
    type?: WorkspacePrincipalType
  }): Promise<WorkspacePrincipal[]>
  archivePrincipal(args: { principalId: string; now: number }): Promise<boolean>

  getMembership(args: {
    workspaceId: string
    principalId: string
  }): Promise<WorkspaceMembership | null>
  listMemberships(args: {
    workspaceId: string
    status?: WorkspaceMembershipStatus
  }): Promise<WorkspaceMembership[]>
  setMembershipRole(args: {
    workspaceId: string
    principalId: string
    role: WorkspaceMembershipRole
    now: number
  }): Promise<MembershipMutationResult>
  setMembershipStatus(args: {
    workspaceId: string
    principalId: string
    status: WorkspaceMembershipStatus
    now: number
  }): Promise<MembershipMutationResult>
  removeMembership(args: {
    workspaceId: string
    principalId: string
  }): Promise<MembershipRemovalResult>
  transferOwnership(args: {
    workspaceId: string
    fromPrincipalId: string
    toPrincipalId: string
    now: number
  }): Promise<OwnershipTransferResult>

  createTeam(input: {
    id: string
    workspaceId: string
    name: string
    description?: string
    createdByPrincipalId: string
    now: number
  }): Promise<WorkspaceTeam>
  getTeam(teamId: string): Promise<WorkspaceTeam | null>
  listTeams(args: { workspaceId: string; includeArchived?: boolean }): Promise<WorkspaceTeam[]>
  archiveTeam(args: { teamId: string; now: number }): Promise<boolean>
  addTeamMember(input: {
    teamId: string
    workspaceId: string
    principalId: string
    principalType: TeamMemberPrincipalType
    addedByPrincipalId?: string
    now: number
  }): Promise<WorkspaceTeamMember>
  removeTeamMember(args: { teamId: string; principalId: string }): Promise<boolean>
  listTeamMembers(teamId: string): Promise<WorkspaceTeamMember[]>

  createInvitationReplacingPending(
    input: CreateWorkspaceInvitationInput,
  ): Promise<WorkspaceInvitation>
  getInvitation(invitationId: string): Promise<WorkspaceInvitation | null>
  listInvitations(args: {
    workspaceId: string
    status?: WorkspaceInvitation['status']
  }): Promise<WorkspaceInvitation[]>
  acceptInvitation(input: AcceptWorkspaceInvitationInput): Promise<InvitationAcceptanceResult>
  cancelInvitation(args: {
    invitationId: string
    cancelledByPrincipalId: string
    now: number
  }): Promise<WorkspaceInvitation | null>
  expireInvitations(args: { workspaceId?: string; now: number }): Promise<number>

  bindResource(input: {
    workspaceId: string
    resourceType: string
    resourceId: string
    now: number
  }): Promise<WorkspaceResourceScope>
  getResourceWorkspace(args: {
    resourceType: string
    resourceId: string
  }): Promise<WorkspaceResourceScope | null>
  listResourceIdsByWorkspace(args: {
    workspaceId: string
    resourceType: string
  }): Promise<string[]>

  getSharingPolicy(workspaceId: string): Promise<WorkspaceSharingPolicy | null>
  setSharingPolicy(input: SetWorkspaceSharingPolicyInput): Promise<WorkspaceSharingPolicy>

  upsertIdentityMapping(input: {
    id: string
    workspaceId: string
    principalId: string
    directory: string
    externalId: string
    externalGroupIds?: string[]
    now: number
  }): Promise<WorkspaceIdentityMapping>
  getIdentityMapping(args: {
    workspaceId: string
    directory: string
    externalId: string
  }): Promise<WorkspaceIdentityMapping | null>
  listIdentityMappings(args: {
    workspaceId: string
    includeDeprovisioned?: boolean
  }): Promise<WorkspaceIdentityMapping[]>
  deprovisionIdentityMapping(args: {
    workspaceId: string
    directory: string
    externalId: string
    now: number
  }): Promise<WorkspaceIdentityMapping | null>

  recordAuditExport(input: {
    id: string
    workspaceId: string
    requestedByPrincipalId: string
    fromRecordedAt?: number
    toRecordedAt: number
    eventCount: number
    now: number
  }): Promise<WorkspaceAuditExportRecord>
  listAuditExports(args: { workspaceId: string; limit?: number }): Promise<WorkspaceAuditExportRecord[]>

  createResourceGuest(input: {
    id: string
    workspaceId: string
    resourceType: string
    resourceId: string
    principalId: string
    accessRole: WorkspaceResourceGuest['accessRole']
    status?: WorkspaceResourceGuest['status']
    grantedByPrincipalId: string
    expiresAt?: number
    now: number
  }): Promise<WorkspaceResourceGuest>
  listResourceGuests(args: {
    workspaceId: string
    resourceType?: string
    resourceId?: string
    includeInactive?: boolean
  }): Promise<WorkspaceResourceGuest[]>
  revokeResourceGuest(args: {
    id: string
    revokedByPrincipalId: string
    now: number
  }): Promise<WorkspaceResourceGuest | null>
}
