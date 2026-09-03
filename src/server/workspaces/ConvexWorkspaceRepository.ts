import 'server-only'

import { randomUUID } from 'node:crypto'
import type {
  Workspace,
  WorkspaceAccess,
  WorkspaceInvitation,
  WorkspaceMembership,
  WorkspacePrincipal,
  WorkspaceResourceGuest,
  WorkspaceResourceScope,
  WorkspaceAuditExportRecord,
  WorkspaceIdentityMapping,
  WorkspaceSharingPolicy,
  WorkspaceTeam,
  WorkspaceTeamMember,
} from '@overlay/workspace-contracts'
import { lazyConvex as convex } from '@/server/database/lazy-convex'
import { getInternalApiSecret } from '@/server/shared/internal-api-secret'
import type {
  InvitationAcceptanceResult,
  MembershipMutationResult,
  MembershipRemovalResult,
  OwnershipTransferResult,
  WorkspacePlatformInstallationRecord,
  WorkspaceRepository,
} from './WorkspaceRepository'

const FUNCTION_PREFIX = 'collaboration/workspaces'

type ConvexWorkspace = Omit<Workspace, 'id'> & {
  workspaceId: string
  personalOwnerUserId?: string
}
type ConvexPrincipal = Omit<WorkspacePrincipal, 'id'> & { principalId: string }
type ConvexMembership = WorkspaceMembership
type ConvexInvitation = Omit<WorkspaceInvitation, 'id'> & { invitationId: string }
type ConvexTeam = Omit<WorkspaceTeam, 'id'> & { teamId: string }
type ConvexTeamMember = WorkspaceTeamMember & { teamMembershipId: string }
type ConvexPlatformInstallation = Omit<WorkspacePlatformInstallationRecord, 'id'> & { installationId: string }
type ConvexResourceGuest = Omit<WorkspaceResourceGuest, 'id'> & { resourceGuestId: string }
type ConvexResourceScope = WorkspaceResourceScope
type ConvexAccess = {
  workspace: ConvexWorkspace
  principal: ConvexPrincipal
  membership: ConvexMembership
}

export class ConvexWorkspaceRepository implements WorkspaceRepository {
  async ensurePersonalWorkspace(input: Parameters<WorkspaceRepository['ensurePersonalWorkspace']>[0]) {
    return access(await requiredMutation<ConvexAccess>('ensurePersonalWorkspaceByServer', {
      workspaceId: input.workspaceId,
      principalId: input.principalId,
      membershipId: randomUUID(),
      userId: input.userId,
      displayName: input.displayName,
      email: input.email,
      workspaceName: `${input.displayName.trim() || 'My'}’s workspace`,
      now: input.now,
    }))
  }

  async createOrganization(input: Parameters<WorkspaceRepository['createOrganization']>[0]) {
    return access(await requiredMutation<ConvexAccess>('createOrganizationByServer', {
      workspaceId: input.workspaceId,
      principalId: input.ownerPrincipalId,
      membershipId: randomUUID(),
      creatorUserId: input.actorUserId,
      creatorDisplayName: input.ownerDisplayName,
      creatorEmail: input.ownerEmail,
      name: input.name,
      slug: input.slug,
      now: input.now,
    }))
  }

  async getWorkspace(workspaceId: string) {
    const row = await query<ConvexWorkspace | null>('getWorkspaceByServer', { workspaceId })
    return row ? workspace(row) : null
  }

  async listForUser(
    userId: string,
    options: { includeArchived?: boolean } = {},
  ): Promise<WorkspaceAccess[]> {
    const rows = await query<ConvexAccess[]>('listForUserByServer', { userId }) ?? []
    return rows
      .map(access)
      .filter((entry) => options.includeArchived || entry.workspace.status === 'active')
  }

  async getAccess(args: Parameters<WorkspaceRepository['getAccess']>[0]) {
    const row = await query<ConvexAccess | null>('getAuthorizedWorkspaceByServer', args)
    return row ? access(row) : null
  }

  async getActiveWorkspace(userId: string) {
    const row = await mutation<ConvexAccess | null>('resolveActiveWorkspaceByServer', { userId })
    return row ? access(row) : null
  }

  async setActiveWorkspace(args: Parameters<WorkspaceRepository['setActiveWorkspace']>[0]) {
    try {
      const row = await mutation<ConvexAccess | null>('switchActiveWorkspaceByServer', args)
      return row ? access(row) : null
    } catch (error) {
      if (hasCode(error, 'WORKSPACE_NOT_FOUND') || hasCode(error, 'WORKSPACE_ACCESS_DENIED')) {
        return null
      }
      throw error
    }
  }

  async archiveWorkspace(args: Parameters<WorkspaceRepository['archiveWorkspace']>[0]) {
    try {
      const row = await mutation<ConvexWorkspace | null>('archiveByServer', args)
      return row ? workspace(row) : null
    } catch (error) {
      if (hasCode(error, 'WORKSPACE_NOT_FOUND')) return null
      throw error
    }
  }

  async createPrincipal(input: Parameters<WorkspaceRepository['createPrincipal']>[0]) {
    return principal(await requiredMutation<ConvexPrincipal>('createPrincipalByServer', {
      principalId: input.id,
      workspaceId: input.workspaceId,
      type: input.type,
      userId: input.userId,
      agentId: input.agentId,
      serviceId: input.serviceId,
      displayName: input.displayName,
      email: input.email,
      createdByPrincipalId: input.createdByPrincipalId,
      now: input.now,
    }))
  }

  async getPrincipal(principalId: string) {
    const row = await query<ConvexPrincipal | null>('getPrincipalByServer', { principalId })
    return row ? principal(row) : null
  }

  async getHumanPrincipal(args: Parameters<WorkspaceRepository['getHumanPrincipal']>[0]) {
    const row = await query<ConvexPrincipal | null>('getHumanPrincipalByServer', args)
    return row ? principal(row) : null
  }

  async updatePrincipal(args: Parameters<WorkspaceRepository['updatePrincipal']>[0]) {
    return principal(await requiredMutation<ConvexPrincipal>('updatePrincipalByServer', {
      principalId: args.principalId,
      workspaceId: args.workspaceId,
      displayName: args.displayName,
      email: args.email,
    }))
  }

  async listPrincipals(args: Parameters<WorkspaceRepository['listPrincipals']>[0]) {
    const rows = await query<ConvexPrincipal[]>('listPrincipalsByServer', {
      workspaceId: args.workspaceId,
      includeArchived: args.includeArchived ?? false,
      type: args.type,
    }) ?? []
    return rows.map(principal)
  }

  async archivePrincipal(args: Parameters<WorkspaceRepository['archivePrincipal']>[0]) {
    const result = await mutation<{ archived: boolean }>('archivePrincipalByServer', args)
    return result?.archived ?? false
  }

  async getMembership(args: Parameters<WorkspaceRepository['getMembership']>[0]) {
    const row = await query<ConvexMembership | null>('getMembershipByServer', args)
    return row ? membership(row) : null
  }

  async listMemberships(args: Parameters<WorkspaceRepository['listMemberships']>[0]) {
    const rows = await query<ConvexMembership[]>('listMembershipsByServer', args) ?? []
    return rows.map(membership)
  }

  async setMembershipRole(
    args: Parameters<WorkspaceRepository['setMembershipRole']>[0],
  ): Promise<MembershipMutationResult> {
    const existing = await this.getRawMembership(args.workspaceId, args.principalId)
    if (!existing) return { status: 'not_found' }
    try {
      const row = await requiredMutation<ConvexMembership>('updateMemberByServer', {
        workspaceId: args.workspaceId,
        principalId: args.principalId,
        role: args.role,
        now: args.now,
      })
      return { status: 'updated', membership: membership(row) }
    } catch (error) {
      if (hasCode(error, 'WORKSPACE_PERSONAL_OWNER_BOUND')) {
        return { status: 'personal_owner_bound' }
      }
      if (hasCode(error, 'WORKSPACE_LAST_OWNER_REQUIRED')) return { status: 'last_owner' }
      if (hasCode(error, 'WORKSPACE_OWNER_MUST_BE_HUMAN')) {
        return { status: 'owner_must_be_human' }
      }
      if (hasCode(error, 'WORKSPACE_MEMBERSHIP_NOT_FOUND')) return { status: 'not_found' }
      throw error
    }
  }

  async setMembershipStatus(
    args: Parameters<WorkspaceRepository['setMembershipStatus']>[0],
  ): Promise<MembershipMutationResult> {
    const existing = await this.getRawMembership(args.workspaceId, args.principalId)
    if (!existing) return { status: 'not_found' }
    try {
      const row = await requiredMutation<ConvexMembership>('updateMemberByServer', {
        workspaceId: args.workspaceId,
        principalId: args.principalId,
        status: args.status,
        now: args.now,
      })
      return { status: 'updated', membership: membership(row) }
    } catch (error) {
      if (hasCode(error, 'WORKSPACE_PERSONAL_OWNER_BOUND')) {
        return { status: 'personal_owner_bound' }
      }
      if (hasCode(error, 'WORKSPACE_LAST_OWNER_REQUIRED')) return { status: 'last_owner' }
      if (hasCode(error, 'WORKSPACE_MEMBERSHIP_NOT_FOUND')) return { status: 'not_found' }
      throw error
    }
  }

  async removeMembership(
    args: Parameters<WorkspaceRepository['removeMembership']>[0],
  ): Promise<MembershipRemovalResult> {
    const existing = await this.getRawMembership(args.workspaceId, args.principalId)
    if (!existing) return { status: 'not_found' }
    try {
      await mutation('removeMemberByServer', {
        workspaceId: args.workspaceId,
        principalId: args.principalId,
      })
      return { status: 'removed' }
    } catch (error) {
      if (hasCode(error, 'WORKSPACE_PERSONAL_OWNER_BOUND')) {
        return { status: 'personal_owner_bound' }
      }
      if (hasCode(error, 'WORKSPACE_LAST_OWNER_REQUIRED')) return { status: 'last_owner' }
      if (hasCode(error, 'WORKSPACE_MEMBERSHIP_NOT_FOUND')) return { status: 'not_found' }
      throw error
    }
  }

  async transferOwnership(
    args: Parameters<WorkspaceRepository['transferOwnership']>[0],
  ): Promise<OwnershipTransferResult> {
    const [source, target, targetPrincipal] = await Promise.all([
      this.getRawMembership(args.workspaceId, args.fromPrincipalId),
      this.getRawMembership(args.workspaceId, args.toPrincipalId),
      this.getPrincipal(args.toPrincipalId),
    ])
    if (!source || !target || !targetPrincipal || targetPrincipal.workspaceId !== args.workspaceId) {
      return { status: 'not_found' }
    }
    if (source.role !== 'owner' || source.status !== 'active') {
      return { status: 'source_not_owner' }
    }
    if (targetPrincipal.type !== 'human') return { status: 'target_not_human' }
    if (target.status !== 'active') return { status: 'target_inactive' }
    try {
      const result = await requiredMutation<{
        previousOwner: ConvexMembership
        owner: ConvexMembership
      }>('transferOwnershipByServer', args)
      return {
        status: 'transferred',
        previousOwnerMembership: membership(result.previousOwner),
        newOwnerMembership: membership(result.owner),
      }
    } catch (error) {
      if (hasCode(error, 'WORKSPACE_PERSONAL_OWNER_BOUND')) {
        return { status: 'personal_owner_bound' }
      }
      if (hasCode(error, 'WORKSPACE_TRANSFER_TARGET_NOT_HUMAN')) {
        return { status: 'target_not_human' }
      }
      if (hasCode(error, 'WORKSPACE_TRANSFER_TARGET_INVALID')) {
        return { status: 'target_inactive' }
      }
      if (hasCode(error, 'WORKSPACE_OWNER_REQUIRED')) return { status: 'source_not_owner' }
      throw error
    }
  }

  async createTeam(input: Parameters<WorkspaceRepository['createTeam']>[0]) {
    return team(await requiredMutation<ConvexTeam>('createTeamByServer', {
      teamId: input.id,
      workspaceId: input.workspaceId,
      name: input.name,
      description: input.description,
      createdByPrincipalId: input.createdByPrincipalId,
      now: input.now,
    }))
  }

  async getTeam(teamId: string) {
    const row = await query<ConvexTeam | null>('getTeamByServer', { teamId })
    return row ? team(row) : null
  }

  async listTeams(args: Parameters<WorkspaceRepository['listTeams']>[0]) {
    const rows = await query<ConvexTeam[]>('listTeamsOnlyByServer', {
      workspaceId: args.workspaceId,
      includeArchived: args.includeArchived ?? false,
    }) ?? []
    return rows.map(team)
  }

  async archiveTeam(args: Parameters<WorkspaceRepository['archiveTeam']>[0]) {
    const result = await mutation<{ archived: boolean }>('archiveTeamByServer', args)
    return result?.archived ?? false
  }

  async addTeamMember(input: Parameters<WorkspaceRepository['addTeamMember']>[0]) {
    return teamMember(await requiredMutation<ConvexTeamMember>('addTeamPrincipalByServer', {
      teamMembershipId: randomUUID(),
      teamId: input.teamId,
      workspaceId: input.workspaceId,
      principalId: input.principalId,
      principalType: input.principalType,
      addedByPrincipalId: input.addedByPrincipalId,
      now: input.now,
    }))
  }

  async removeTeamMember(args: Parameters<WorkspaceRepository['removeTeamMember']>[0]) {
    const existing = await this.getTeam(args.teamId)
    if (!existing) return false
    const result = await mutation<{ removed: boolean }>('removeTeamPrincipalByServer', {
      ...args,
      workspaceId: existing.workspaceId,
    })
    return result?.removed ?? false
  }

  async listTeamMembers(teamId: string) {
    const rows = await query<ConvexTeamMember[]>('listTeamMembersByServer', { teamId }) ?? []
    return rows.map(teamMember)
  }

  async createInvitationReplacingPending(
    input: Parameters<WorkspaceRepository['createInvitationReplacingPending']>[0],
  ) {
    return invitation(await requiredMutation<ConvexInvitation>('inviteByServer', {
      invitationId: input.id,
      workspaceId: input.workspaceId,
      email: input.email,
      role: input.role,
      invitedByPrincipalId: input.invitedByPrincipalId,
      expiresAt: input.expiresAt,
      now: input.now,
    }))
  }

  async getInvitation(invitationId: string) {
    const row = await query<ConvexInvitation | null>('getInvitationByServer', { invitationId })
    return row ? invitation(row) : null
  }

  async listInvitations(args: Parameters<WorkspaceRepository['listInvitations']>[0]) {
    const rows = await query<ConvexInvitation[]>('listInvitationsByServer', args) ?? []
    return rows.map(invitation)
  }

  async acceptInvitation(
    input: Parameters<WorkspaceRepository['acceptInvitation']>[0],
  ): Promise<InvitationAcceptanceResult> {
    const existing = await this.getInvitation(input.invitationId)
    if (!existing) return { status: 'not_found' }
    if (existing.status !== 'pending') return { status: 'not_pending' }
    if (existing.expiresAt <= input.now) {
      await this.expireInvitations({ workspaceId: existing.workspaceId, now: input.now })
      return { status: 'expired' }
    }
    if (existing.email.trim().toLowerCase() !== input.email.trim().toLowerCase()) {
      return { status: 'email_mismatch' }
    }
    try {
      const acceptedAccess = access(await requiredMutation<ConvexAccess>(
        'acceptInvitationByServer',
        {
          invitationId: input.invitationId,
          principalId: input.principalId,
          membershipId: randomUUID(),
          userId: input.userId,
          email: input.email,
          displayName: input.displayName,
          now: input.now,
        },
      ))
      const acceptedInvitation = await this.getInvitation(input.invitationId)
      if (!acceptedInvitation) throw new Error('Accepted invitation could not be reloaded')
      return {
        status: 'accepted',
        access: acceptedAccess,
        invitation: acceptedInvitation,
      }
    } catch (error) {
      if (hasCode(error, 'WORKSPACE_INVITATION_NOT_FOUND')) return { status: 'not_found' }
      if (hasCode(error, 'WORKSPACE_INVITATION_EXPIRED')) return { status: 'expired' }
      if (hasCode(error, 'WORKSPACE_INVITATION_EMAIL_MISMATCH')) {
        return { status: 'email_mismatch' }
      }
      if (String(error).includes('WORKSPACE_INVITATION_')) return { status: 'not_pending' }
      throw error
    }
  }

  async cancelInvitation(args: Parameters<WorkspaceRepository['cancelInvitation']>[0]) {
    const existing = await this.getInvitation(args.invitationId)
    if (!existing) return null
    try {
      const row = await mutation<ConvexInvitation | null>('cancelInvitationByServer', {
        invitationId: args.invitationId,
        workspaceId: existing.workspaceId,
        cancelledByPrincipalId: args.cancelledByPrincipalId,
        now: args.now,
      })
      return row ? invitation(row) : null
    } catch (error) {
      if (hasCode(error, 'WORKSPACE_INVITATION_NOT_FOUND')) return null
      throw error
    }
  }

  async expireInvitations(args: Parameters<WorkspaceRepository['expireInvitations']>[0]) {
    const result = await mutation<{ expired: number }>('expireInvitationsByServer', args)
    return result?.expired ?? 0
  }

  async createResourceGuest(input: Parameters<WorkspaceRepository['createResourceGuest']>[0]) {
    return resourceGuest(await requiredMutation<ConvexResourceGuest>(
      'createResourceGuestByServer',
      {
        resourceGuestId: input.id,
        workspaceId: input.workspaceId,
        resourceType: input.resourceType,
        resourceId: input.resourceId,
        principalId: input.principalId,
        accessRole: input.accessRole,
        status: input.status ?? 'active',
        grantedByPrincipalId: input.grantedByPrincipalId,
        expiresAt: input.expiresAt,
        now: input.now,
      },
    ))
  }

  async bindResource(input: Parameters<WorkspaceRepository['bindResource']>[0]) {
    return clean(await requiredMutation<ConvexResourceScope>('bindResourceByServer', input))
  }

  async getResourceWorkspace(
    args: Parameters<WorkspaceRepository['getResourceWorkspace']>[0],
  ) {
    const row = await query<ConvexResourceScope | null>('getResourceWorkspaceByServer', args)
    return row ? clean(row) : null
  }

  async listResourceIdsByWorkspace(args: {
    workspaceId: string
    resourceType: string
  }): Promise<string[]> {
    return await query<string[]>('listResourceIdsByWorkspaceByServer', {
      ...args,
      serverSecret: getInternalApiSecret(),
    }) ?? []
  }

  async getSharingPolicy(workspaceId: string): Promise<WorkspaceSharingPolicy | null> {
    const row = await query<WorkspaceSharingPolicy | null>('getSharingPolicyByServer', { workspaceId })
    return row ? clean(row) : null
  }

  async setSharingPolicy(input: Parameters<WorkspaceRepository['setSharingPolicy']>[0]) {
    // Convex distinguishes "leave alone" (absent) from "clear" (null), so only
    // keys present in the patch are forwarded.
    const patch = Object.fromEntries(
      Object.entries(input.patch).map(([key, value]) => [key, value === undefined ? null : value]),
    )
    return clean(await requiredMutation<WorkspaceSharingPolicy>('setSharingPolicyByServer', {
      workspaceId: input.workspaceId,
      patch,
      updatedByPrincipalId: input.updatedByPrincipalId,
      now: input.now,
    }))
  }

  async upsertIdentityMapping(input: Parameters<WorkspaceRepository['upsertIdentityMapping']>[0]) {
    return clean(await requiredMutation<WorkspaceIdentityMapping>('upsertIdentityMappingByServer', input))
  }

  async getIdentityMapping(args: Parameters<WorkspaceRepository['getIdentityMapping']>[0]) {
    const row = await query<WorkspaceIdentityMapping | null>('getIdentityMappingByServer', args)
    return row ? clean(row) : null
  }

  async listIdentityMappings(args: Parameters<WorkspaceRepository['listIdentityMappings']>[0]) {
    const rows = await query<WorkspaceIdentityMapping[]>('listIdentityMappingsByServer', args) ?? []
    return rows.map(clean)
  }

  async deprovisionIdentityMapping(
    args: Parameters<WorkspaceRepository['deprovisionIdentityMapping']>[0],
  ) {
    const row = await mutation<WorkspaceIdentityMapping | null>('deprovisionIdentityMappingByServer', args)
    return row ? clean(row) : null
  }

  async upsertPlatformInstallation(input: Parameters<WorkspaceRepository['upsertPlatformInstallation']>[0]) {
    return installation(await requiredPlatformMutation<ConvexPlatformInstallation>(
      'upsertPlatformInstallationByServer', input,
    ))
  }

  async getPlatformInstallation(args: Parameters<WorkspaceRepository['getPlatformInstallation']>[0]) {
    const row = await platformQuery<ConvexPlatformInstallation | null>('getPlatformInstallationByServer', args)
    return row ? installation(row) : null
  }

  async getPlatformInstallationByTeam(args: Parameters<WorkspaceRepository['getPlatformInstallationByTeam']>[0]) {
    const row = await platformQuery<ConvexPlatformInstallation | null>('getPlatformInstallationByTeamByServer', args)
    return row ? installation(row) : null
  }

  async listPlatformInstallations(args: Parameters<WorkspaceRepository['listPlatformInstallations']>[0]) {
    const rows = await platformQuery<ConvexPlatformInstallation[]>('listPlatformInstallationsByServer', args) ?? []
    return rows.map(installation)
  }

  async deletePlatformInstallation(args: Parameters<WorkspaceRepository['deletePlatformInstallation']>[0]) {
    return await platformMutation<boolean>('deletePlatformInstallationByServer', args) ?? false
  }

  async recordAuditExport(input: Parameters<WorkspaceRepository['recordAuditExport']>[0]) {
    return clean(await requiredMutation<WorkspaceAuditExportRecord>('recordAuditExportByServer', input))
  }

  async listAuditExports(args: Parameters<WorkspaceRepository['listAuditExports']>[0]) {
    const rows = await query<WorkspaceAuditExportRecord[]>('listAuditExportsByServer', args) ?? []
    return rows.map(clean)
  }

  async listResourceGuests(args: Parameters<WorkspaceRepository['listResourceGuests']>[0]) {
    const rows = await query<ConvexResourceGuest[]>('listResourceGuestsByServer', {
      workspaceId: args.workspaceId,
      resourceType: args.resourceType,
      resourceId: args.resourceId,
    }) ?? []
    return rows
      .map(resourceGuest)
      .filter((guest) => args.includeInactive || guest.status === 'active')
  }

  async revokeResourceGuest(args: Parameters<WorkspaceRepository['revokeResourceGuest']>[0]) {
    const existing = await query<ConvexResourceGuest | null>('getResourceGuestByServer', {
      resourceGuestId: args.id,
    })
    if (!existing) return null
    try {
      const row = await mutation<ConvexResourceGuest | null>('revokeResourceGuestByServer', {
        resourceGuestId: args.id,
        workspaceId: existing.workspaceId,
        revokedByPrincipalId: args.revokedByPrincipalId,
        now: args.now,
      })
      return row ? resourceGuest(row) : null
    } catch (error) {
      if (hasCode(error, 'WORKSPACE_RESOURCE_GUEST_NOT_FOUND')) return null
      throw error
    }
  }

  private async getRawMembership(
    workspaceId: string,
    principalId: string,
  ): Promise<ConvexMembership | null> {
    return await query<ConvexMembership | null>('getMembershipByServer', {
      workspaceId,
      principalId,
    })
  }
}

function query<T>(operation: string, args: Record<string, unknown>): Promise<T | null> {
  return convex.query<T>(
    `${FUNCTION_PREFIX}:${operation}`,
    { ...stripUndefined(args), serverSecret: getInternalApiSecret() },
    { throwOnError: true },
  )
}

function mutation<T>(
  operation: string,
  args: Record<string, unknown>,
): Promise<T | null> {
  return convex.mutation<T>(
    `${FUNCTION_PREFIX}:${operation}`,
    { ...stripUndefined(args), serverSecret: getInternalApiSecret() },
    { throwOnError: true },
  )
}

async function requiredMutation<T>(
  operation: string,
  args: Record<string, unknown>,
): Promise<T> {
  const result = await mutation<T>(operation, args)
  if (!result) throw new Error(`Convex workspace operation ${operation} returned no result`)
  return result
}

const PLATFORM_FUNCTION_PREFIX = 'collaboration/platformInstallations'

function platformQuery<T>(operation: string, args: Record<string, unknown>): Promise<T | null> {
  return convex.query<T>(
    `${PLATFORM_FUNCTION_PREFIX}:${operation}`,
    { ...stripUndefined(args), serverSecret: getInternalApiSecret() },
    { throwOnError: true },
  )
}

function platformMutation<T>(
  operation: string,
  args: Record<string, unknown>,
): Promise<T | null> {
  return convex.mutation<T>(
    `${PLATFORM_FUNCTION_PREFIX}:${operation}`,
    { ...stripUndefined(args), serverSecret: getInternalApiSecret() },
    { throwOnError: true },
  )
}

async function requiredPlatformMutation<T>(
  operation: string,
  args: Record<string, unknown>,
): Promise<T> {
  const result = await platformMutation<T>(operation, args)
  if (!result) throw new Error(`Convex platform installation operation ${operation} returned no result`)
  return result
}

function workspace(row: ConvexWorkspace): Workspace {
  const { workspaceId, personalOwnerUserId: _, ...value } = clean(row)
  return { ...value, id: workspaceId }
}

function principal(row: ConvexPrincipal): WorkspacePrincipal {
  const { principalId, ...value } = clean(row)
  return { ...value, id: principalId }
}

function membership(row: ConvexMembership): WorkspaceMembership {
  return clean(row)
}

function invitation(row: ConvexInvitation): WorkspaceInvitation {
  const { invitationId, ...value } = clean(row)
  return { ...value, id: invitationId }
}

function team(row: ConvexTeam): WorkspaceTeam {
  const { teamId, ...value } = clean(row)
  return { ...value, id: teamId }
}

function installation(row: ConvexPlatformInstallation): WorkspacePlatformInstallationRecord {
  const { installationId, ...value } = clean(row)
  return { ...value, id: installationId }
}

function teamMember(row: ConvexTeamMember): WorkspaceTeamMember {
  const { teamMembershipId: _, ...value } = clean(row)
  return value
}

function resourceGuest(row: ConvexResourceGuest): WorkspaceResourceGuest {
  const { resourceGuestId, ...value } = clean(row)
  return { ...value, id: resourceGuestId }
}

function access(row: ConvexAccess): WorkspaceAccess {
  return {
    workspace: workspace(row.workspace),
    principal: principal(row.principal),
    membership: membership(row.membership),
  }
}

function clean<T extends Record<string, unknown>>(row: T): T {
  const copy = { ...row }
  delete copy._id
  delete copy._creationTime
  return copy
}

function stripUndefined(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined))
}

function hasCode(error: unknown, code: string): boolean {
  return error instanceof Error ? error.message.includes(code) : String(error).includes(code)
}
