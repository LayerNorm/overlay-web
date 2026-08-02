import 'server-only'

import { randomUUID } from 'node:crypto'
import type {
  WorkspaceResourceGrant,
  WorkspaceResourceShareResponse,
  WorkspaceShareAccessRole,
  WorkspaceShareDirectory,
  WorkspaceShareImpact,
  WorkspaceShareImpactPrincipal,
  WorkspaceShareResourceType,
  WorkspaceShareTargetType,
} from '@overlay/workspace-contracts'
import {
  shareRoleAllows,
  shareRoleRejection,
  strongestShareRole,
} from '@/shared/share/share-access-policy'
import type { ResourceAction, ResourceOwnerRepository } from '@overlay/authz-contracts'
import type { ActConversationRepository } from '@/server/conversations/ActConversationRepository'
import type { ConversationCollaborationRepository } from '@/server/conversations/ConversationCollaborationRepository'
import type { WorkspaceAgentRepository } from '@/server/agents/WorkspaceAgentRepository'
import type { WorkspaceRepository } from '@/server/workspaces/WorkspaceRepository'
import type { WorkspaceService } from '@/server/workspaces/WorkspaceService'
import type { WorkspaceSharingRepository } from './WorkspaceSharingRepository'

/** A resource the actor reaches through sharing, plus how it reaches them. */
export type AccessibleResource = {
  ownerUserId: string
  resourceId: string
  accessRole: WorkspaceShareAccessRole
  targetType: WorkspaceShareTargetType
}

export class WorkspaceSharingServiceError extends Error {
  constructor(
    public readonly code: 'forbidden' | 'not_found' | 'confirmation_required' | 'validation',
    message: string,
  ) {
    super(message)
    this.name = 'WorkspaceSharingServiceError'
  }
}

export class WorkspaceSharingService {
  constructor(private readonly deps: {
    agents: WorkspaceAgentRepository
    collaboration: ConversationCollaborationRepository
    conversations: ActConversationRepository
    repository: WorkspaceSharingRepository
    resourceOwners: ResourceOwnerRepository
    workspaceRepository: WorkspaceRepository
    workspaces: WorkspaceService
    id?: () => string
    now?: () => number
  }) {}

  async getResourceShares(args: {
    actorUserId: string
    workspaceId: string
    resourceType: WorkspaceShareResourceType
    resourceId: string
  }): Promise<WorkspaceResourceShareResponse> {
    const access = await this.requireManager(args)
    const [grants, directory, policy] = await Promise.all([
      this.deps.repository.listForResource({ ...args, workspaceId: access.workspace.id }),
      this.directory(args.actorUserId, access.workspace.id),
      this.deps.workspaces.getSharingPolicy({
        actorUserId: args.actorUserId,
        workspaceId: access.workspace.id,
      }),
    ])
    return {
      grants,
      directory,
      canManage: true,
      publicLinksEnabled: policy.publicLinksEnabled,
    }
  }

  /**
   * Discloses who a grant would newly reach before it exists, and who already
   * has access some other way. Team and room targets stay dynamic, so the
   * preview says so instead of pretending the list is final.
   */
  async previewGrantImpact(args: {
    actorUserId: string
    workspaceId: string
    resourceType: WorkspaceShareResourceType
    resourceId: string
    targetType: WorkspaceShareTargetType
    targetId: string
  }): Promise<WorkspaceShareImpact> {
    const access = await this.requireManager(args)
    await this.requireTarget({ ...args, workspaceId: access.workspace.id })
    const [target, existing] = await Promise.all([
      this.resolveTarget({ ...args, workspaceId: access.workspace.id }),
      this.deps.repository.listForResource({ ...args, workspaceId: access.workspace.id }),
    ])
    const alreadyReached = await this.principalsReachedByGrants({
      grants: existing.filter((grant) => grant.resourceId === args.resourceId),
      workspaceId: access.workspace.id,
      actorUserId: args.actorUserId,
    })
    return {
      targetName: target.name,
      targetType: args.targetType,
      dynamic: args.targetType !== 'principal',
      gaining: target.principals.filter((principal) => !alreadyReached.has(principal.principalId)),
      retaining: target.principals.filter((principal) => alreadyReached.has(principal.principalId)),
      losing: [],
    }
  }

  /**
   * Revocation warning: everyone this grant is currently reaching, minus anyone
   * another surviving grant still reaches.
   */
  async previewRevocationImpact(args: {
    actorUserId: string
    workspaceId: string
    resourceType: WorkspaceShareResourceType
    resourceId: string
    grantId: string
  }): Promise<WorkspaceShareImpact> {
    const access = await this.requireManager(args)
    const grants = await this.deps.repository.listForResource({
      ...args,
      workspaceId: access.workspace.id,
    })
    const grant = grants.find((candidate) => candidate.id === args.grantId)
    if (!grant) throw notFound()
    const [target, keptAccess] = await Promise.all([
      this.resolveTarget({
        actorUserId: args.actorUserId,
        workspaceId: access.workspace.id,
        targetType: grant.targetType,
        targetId: grant.targetId,
      }),
      this.principalsReachedByGrants({
        grants: grants.filter((candidate) => candidate.id !== grant.id),
        workspaceId: access.workspace.id,
        actorUserId: args.actorUserId,
      }),
    ])
    return {
      targetName: target.name,
      targetType: grant.targetType,
      dynamic: grant.targetType !== 'principal',
      gaining: [],
      losing: target.principals.filter((principal) => !keptAccess.has(principal.principalId)),
      retaining: target.principals.filter((principal) => keptAccess.has(principal.principalId)),
    }
  }

  async upsertGrant(args: {
    actorUserId: string
    workspaceId: string
    resourceType: WorkspaceShareResourceType
    resourceId: string
    targetType: WorkspaceShareTargetType
    targetId: string
    accessRole: WorkspaceShareAccessRole
    confirmRoomExpansion?: boolean
  }): Promise<WorkspaceResourceGrant> {
    const access = await this.requireManager(args)
    validateRole(args.resourceType, args.accessRole)
    await this.requireTarget({ ...args, workspaceId: access.workspace.id })
    if (
      args.targetType === 'room'
      && ['conversation', 'project', 'knowledge_base'].includes(args.resourceType)
      && !args.confirmRoomExpansion
    ) {
      throw new WorkspaceSharingServiceError(
        'confirmation_required',
        'Confirm that everyone who can join this room should inherit access, including future members',
      )
    }
    return await this.deps.repository.upsert({
      id: (this.deps.id ?? randomUUID)(),
      workspaceId: access.workspace.id,
      resourceType: args.resourceType,
      resourceId: required(args.resourceId, 'resourceId'),
      targetType: args.targetType,
      targetId: required(args.targetId, 'targetId'),
      accessRole: args.accessRole,
      grantedByPrincipalId: access.principal.id,
      now: (this.deps.now ?? Date.now)(),
    })
  }

  async removeGrant(args: {
    actorUserId: string
    workspaceId: string
    resourceType: WorkspaceShareResourceType
    resourceId: string
    grantId: string
  }): Promise<void> {
    await this.requireManager(args)
    const grants = await this.deps.repository.listForResource(args)
    if (!grants.some((grant) => grant.id === args.grantId)) throw notFound()
    if (!await this.deps.repository.remove({
      grantId: required(args.grantId, 'grantId'),
      workspaceId: args.workspaceId,
    })) throw notFound()
  }

  async checkAccess(args: {
    action: ResourceAction
    actorUserId: string
    workspaceId: string
    resourceType: WorkspaceShareResourceType
    resourceId: string
  }): Promise<{ allowed: boolean; accessRole?: WorkspaceShareAccessRole; ownerUserId?: string }> {
    const access = await this.deps.workspaces.resolveActiveWorkspace(args.actorUserId, args.workspaceId)
    const scope = await this.deps.workspaceRepository.getResourceWorkspace({
      resourceType: args.resourceType,
      resourceId: args.resourceId,
    })
    if (!scope || scope.workspaceId !== access.workspace.id) return { allowed: false }
    const ownerUserId = await this.deps.resourceOwners.getOwner(args)
    if (ownerUserId === args.actorUserId) return { allowed: true, accessRole: 'editor', ownerUserId }
    const targets = await this.effectiveTargets(args.actorUserId, access.workspace.id, access.principal.id)
    const grants = await this.deps.repository.listForTargets({
      workspaceId: access.workspace.id,
      resourceType: args.resourceType,
      ...targets,
    })
    const accessRole = strongestRole(grants
      .filter((grant) => grant.resourceId === args.resourceId)
      .map((grant) => grant.accessRole))
    return {
      allowed: Boolean(accessRole && roleAllows(accessRole, args.action)),
      accessRole,
      ownerUserId: ownerUserId ?? undefined,
    }
  }

  async listAccessibleResources(args: {
    action: ResourceAction
    actorUserId: string
    workspaceId: string
    resourceType: WorkspaceShareResourceType
  }): Promise<AccessibleResource[]> {
    const access = await this.deps.workspaces.resolveActiveWorkspace(args.actorUserId, args.workspaceId)
    const targets = await this.effectiveTargets(args.actorUserId, access.workspace.id, access.principal.id)
    const grants = await this.deps.repository.listForTargets({
      workspaceId: access.workspace.id,
      resourceType: args.resourceType,
      ...targets,
    })
    const grantsByResource = new Map<string, WorkspaceResourceGrant[]>()
    for (const grant of grants) {
      grantsByResource.set(grant.resourceId, [
        ...(grantsByResource.get(grant.resourceId) ?? []),
        grant,
      ])
    }
    const values = await Promise.all([...grantsByResource].map(async ([resourceId, resourceGrants]) => {
      const accessRole = strongestRole(resourceGrants.map((grant) => grant.accessRole))!
      const strongest = resourceGrants.find((grant) => grant.accessRole === accessRole)!
      const ownerUserId = await this.deps.resourceOwners.getOwner({
        resourceType: args.resourceType,
        resourceId,
      })
      return { resourceId, accessRole, ownerUserId, targetType: strongest.targetType }
    }))
    return values.filter((value): value is AccessibleResource => Boolean(
      value.ownerUserId
      && value.ownerUserId !== args.actorUserId
      && roleAllows(value.accessRole, args.action),
    ))
  }

  private async directory(actorUserId: string, workspaceId: string): Promise<WorkspaceShareDirectory> {
    const [members, teams, accessibleRoomIds, conversations] = await Promise.all([
      this.deps.workspaces.listMembers({ actorUserId, workspaceId }),
      this.deps.workspaces.listTeams({ actorUserId, workspaceId }),
      this.deps.collaboration.listAccessibleConversationIds({ actorUserId, workspaceId }),
      this.deps.conversations.listConversations({ userId: actorUserId, workspaceId }),
    ])
    const accessible = new Set(accessibleRoomIds)
    const actor = await this.deps.workspaces.resolveActiveWorkspace(actorUserId, workspaceId)
    return {
      principals: members
        .filter(({ principal, membership }) => !principal.archivedAt && membership.status === 'active')
        .map(({ principal }) => ({
          id: principal.id,
          name: principal.displayName,
          description: principal.email,
          kind: principal.type === 'agent' ? 'agent' as const : 'human' as const,
          targetType: 'principal' as const,
        })),
      teams: teams.map(({ team, members: teamMembers }) => ({
        id: team.id,
        name: team.name,
        description: team.description ?? `${teamMembers.length} members`,
        kind: 'team' as const,
        targetType: 'team' as const,
      })),
      rooms: conversations
        .filter((conversation) => conversation.conversationType !== 'personal' && accessible.has(conversation._id))
        .map((conversation) => ({
          id: conversation._id,
          name: conversation.title,
          kind: conversation.conversationType === 'channel' ? 'channel' as const : 'dm' as const,
          targetType: 'room' as const,
        })),
      canInvite: actor.membership.role === 'owner' || actor.membership.role === 'admin',
    }
  }

  private async requireManager(args: {
    actorUserId: string
    workspaceId: string
    resourceType: WorkspaceShareResourceType
    resourceId: string
  }) {
    const access = await this.deps.workspaces.resolveActiveWorkspace(args.actorUserId, args.workspaceId)
    const resourceId = required(args.resourceId, 'resourceId')
    let scope = await this.deps.workspaceRepository.getResourceWorkspace({
      resourceType: args.resourceType,
      resourceId,
    })
    const ownerUserId = await this.deps.resourceOwners.getOwner({
      resourceType: args.resourceType,
      resourceId,
    })
    let ownsResource = ownerUserId === args.actorUserId
    if (args.resourceType === 'agent') {
      const agent = await this.deps.agents.get({ agentId: resourceId, workspaceId: access.workspace.id })
      ownsResource = Boolean(agent && (
        agent.createdByPrincipalId === access.principal.id
        || access.membership.role === 'owner'
        || access.membership.role === 'admin'
      ))
    }
    if (!ownsResource) throw new WorkspaceSharingServiceError('forbidden', 'Only the resource owner can manage access')
    if (!scope) {
      scope = await this.deps.workspaces.bindResource({
        actorUserId: args.actorUserId,
        workspaceId: access.workspace.id,
        resourceType: args.resourceType,
        resourceId,
      })
    }
    if (scope.workspaceId !== access.workspace.id) throw notFound()
    return access
  }

  private async requireTarget(args: {
    actorUserId: string
    workspaceId: string
    targetType: WorkspaceShareTargetType
    targetId: string
  }) {
    const targetId = required(args.targetId, 'targetId')
    if (args.targetType === 'principal') {
      const members = await this.deps.workspaces.listMembers(args)
      if (!members.some(({ principal, membership }) => (
        principal.id === targetId && !principal.archivedAt && membership.status === 'active'
      ))) throw notFound('Share target not found')
      return
    }
    if (args.targetType === 'team') {
      const teams = await this.deps.workspaces.listTeams(args)
      if (!teams.some(({ team }) => team.id === targetId && !team.archivedAt)) {
        throw notFound('Share target not found')
      }
      return
    }
    const accessible = await this.deps.collaboration.listAccessibleConversationIds(args)
    if (!accessible.includes(targetId)) throw notFound('Share target not found')
  }

  /** Name plus the human and agent principals a grant target currently reaches. */
  private async resolveTarget(args: {
    actorUserId: string
    workspaceId: string
    targetType: WorkspaceShareTargetType
    targetId: string
  }): Promise<{ name: string; principals: WorkspaceShareImpactPrincipal[] }> {
    if (args.targetType === 'principal') {
      const members = await this.deps.workspaces.listMembers(args)
      const member = members.find(({ principal }) => principal.id === args.targetId)
      if (!member) throw notFound('Share target not found')
      return {
        name: member.principal.displayName,
        principals: [{
          principalId: member.principal.id,
          name: member.principal.displayName,
          kind: member.principal.type === 'agent' ? 'agent' : 'human',
        }],
      }
    }
    if (args.targetType === 'team') {
      const [teams, members] = await Promise.all([
        this.deps.workspaces.listTeams(args),
        this.deps.workspaces.listMembers(args),
      ])
      const team = teams.find(({ team: candidate }) => candidate.id === args.targetId)
      if (!team) throw notFound('Share target not found')
      const namesByPrincipal = new Map(members.map(({ principal }) => [principal.id, principal]))
      return {
        name: team.team.name,
        principals: team.members.map((member) => ({
          principalId: member.principalId,
          name: namesByPrincipal.get(member.principalId)?.displayName ?? 'Workspace principal',
          kind: member.principalType === 'agent' ? 'agent' : 'human',
          via: team.team.name,
        })),
      }
    }
    const participants = await this.deps.collaboration.listParticipants({
      actorUserId: args.actorUserId,
      conversationId: args.targetId,
      workspaceId: args.workspaceId,
    })
    const conversations = await this.deps.conversations.listConversations({
      userId: args.actorUserId,
      workspaceId: args.workspaceId,
    })
    const room = conversations.find((conversation) => conversation._id === args.targetId)
    const name = room?.title ?? 'Room'
    return {
      name,
      principals: participants
        .filter((participant) => participant.status === 'active')
        .map((participant) => ({
          principalId: participant.principalId,
          name: participant.displayName,
          kind: participant.principalType === 'agent' ? 'agent' : 'human',
          via: name,
        })),
    }
  }

  /** Every principal the supplied grants currently reach, expanded dynamically. */
  private async principalsReachedByGrants(args: {
    actorUserId: string
    grants: WorkspaceResourceGrant[]
    workspaceId: string
  }): Promise<Set<string>> {
    const reached = new Set<string>()
    for (const grant of args.grants) {
      try {
        const target = await this.resolveTarget({
          actorUserId: args.actorUserId,
          workspaceId: args.workspaceId,
          targetType: grant.targetType,
          targetId: grant.targetId,
        })
        for (const principal of target.principals) reached.add(principal.principalId)
      } catch (_error) {
        // A target that no longer resolves reaches nobody; the stale grant is
        // still listed in the dialog so it can be removed.
      }
    }
    return reached
  }

  private async effectiveTargets(actorUserId: string, workspaceId: string, principalId: string) {
    const [teams, roomIds] = await Promise.all([
      this.deps.workspaces.listTeams({ actorUserId, workspaceId }),
      this.deps.collaboration.listAccessibleConversationIds({ actorUserId, workspaceId }),
    ])
    return {
      principalIds: [principalId],
      teamIds: teams
        .filter(({ members }) => members.some((member) => member.principalId === principalId))
        .map(({ team }) => team.id),
      roomIds,
    }
  }
}

function validateRole(resourceType: WorkspaceShareResourceType, role: WorkspaceShareAccessRole) {
  const rejection = shareRoleRejection(resourceType, role)
  if (rejection) throw new WorkspaceSharingServiceError('validation', rejection)
}

/**
 * Delete and share are owner-only actions that a share grant never confers, so
 * they are rejected here even when the grant is the strongest available.
 */
function roleAllows(role: WorkspaceShareAccessRole, action: ResourceAction) {
  if (action === 'delete' || action === 'share') return false
  return shareRoleAllows(role, action)
}

function strongestRole(roles: WorkspaceShareAccessRole[]): WorkspaceShareAccessRole | undefined {
  return strongestShareRole(roles)
}

function required(value: string, field: string) {
  const normalized = value.trim()
  if (!normalized) throw new WorkspaceSharingServiceError('validation', `${field} is required`)
  return normalized
}

function notFound(message = 'Shared resource not found') {
  return new WorkspaceSharingServiceError('not_found', message)
}
