import 'server-only'

import { randomUUID } from 'node:crypto'
import {
  canJoinTeam,
  canManageWorkspace,
  type WorkspaceAccess,
  type WorkspaceInvitation,
  type WorkspaceMembership,
  type WorkspaceMembershipRole,
  type WorkspaceMember,
  type WorkspacePrincipal,
  type WorkspacePrincipalType,
  type WorkspaceResourceGuest,
  type WorkspaceResourceScope,
  type WorkspaceTeam,
  type WorkspaceTeamMember,
  type WorkspaceTeamWithMembers,
} from '@overlay/workspace-contracts'
import type { WorkspaceRepository } from './WorkspaceRepository'

export class WorkspaceServiceError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
    readonly code:
      | 'conflict'
      | 'forbidden'
      | 'invitation_expired'
      | 'invitation_invalid'
      | 'last_owner'
      | 'not_found'
      | 'validation',
  ) {
    super(message)
    this.name = 'WorkspaceServiceError'
  }
}

export class WorkspaceService {
  constructor(
    private readonly repository: WorkspaceRepository,
    private readonly options: {
      createId?: () => string
      now?: () => number
      invitationTtlMs?: number
    } = {},
  ) {}

  async ensurePersonalWorkspace(args: {
    userId: string
    displayName?: string
    email?: string
  }): Promise<WorkspaceAccess> {
    const userId = required(args.userId, 'userId')
    return await this.repository.ensurePersonalWorkspace({
      workspaceId: this.id(),
      slug: `personal-${slugify(userId)}`,
      principalId: this.id(),
      userId,
      displayName: optional(args.displayName) ?? optional(args.email) ?? 'Personal',
      email: normalizeOptionalEmail(args.email),
      now: this.now(),
    })
  }

  async listForUser(userId: string): Promise<WorkspaceAccess[]> {
    return await this.repository.listForUser(required(userId, 'userId'))
  }

  async assertAccountDeletionAllowed(userId: string): Promise<void> {
    const accesses = await this.repository.listForUser(required(userId, 'userId'), {
      includeArchived: true,
    })
    for (const access of accesses) {
      if (
        access.workspace.kind !== 'organization'
        || access.workspace.status !== 'active'
        || access.membership.role !== 'owner'
        || access.membership.status !== 'active'
      ) {
        continue
      }
      const memberships = await this.repository.listMemberships({
        workspaceId: access.workspace.id,
        status: 'active',
      })
      const hasAnotherOwner = memberships.some((membership) => (
        membership.role === 'owner'
        && membership.principalId !== access.principal.id
      ))
      if (!hasAnotherOwner) {
        throw new WorkspaceServiceError(
          `Transfer ownership of ${access.workspace.name} before deleting your account`,
          409,
          'last_owner',
        )
      }
    }
  }

  async resolveActiveWorkspace(
    userId: string,
    requestedWorkspaceId?: string,
  ): Promise<WorkspaceAccess> {
    userId = required(userId, 'userId')
    if (optional(requestedWorkspaceId)) {
      const requested = await this.repository.getAccess({
        userId,
        workspaceId: requestedWorkspaceId!.trim(),
      })
      return requireUsableAccess(requested)
    }

    const active = await this.repository.getActiveWorkspace(userId)
    if (isUsableAccess(active)) return active
    const available = await this.repository.listForUser(userId)
    const fallback = available.find(isUsableAccess)
    if (fallback) {
      return requireUsableAccess(await this.repository.setActiveWorkspace({
        userId,
        workspaceId: fallback.workspace.id,
        now: this.now(),
      }))
    }
    const personal = await this.ensurePersonalWorkspace({ userId })
    return requireUsableAccess(await this.repository.setActiveWorkspace({
      userId,
      workspaceId: personal.workspace.id,
      now: this.now(),
    }))
  }

  async setActiveWorkspace(userId: string, workspaceId: string): Promise<WorkspaceAccess> {
    const access = await this.repository.setActiveWorkspace({
      userId: required(userId, 'userId'),
      workspaceId: required(workspaceId, 'workspaceId'),
      now: this.now(),
    })
    return requireUsableAccess(access)
  }

  async createOrganization(args: {
    actorUserId: string
    name: string
    slug?: string
    displayName?: string
    email?: string
  }): Promise<WorkspaceAccess> {
    const actorUserId = required(args.actorUserId, 'actorUserId')
    const name = required(args.name, 'name')
    return await this.repository.createOrganization({
      workspaceId: this.id(),
      ownerPrincipalId: this.id(),
      actorUserId,
      ownerDisplayName: optional(args.displayName) ?? optional(args.email) ?? actorUserId,
      ownerEmail: normalizeOptionalEmail(args.email),
      name,
      slug: normalizeOptionalSlug(args.slug) ?? slugify(name),
      now: this.now(),
    })
  }

  async archiveWorkspace(args: {
    actorUserId: string
    workspaceId: string
  }): Promise<WorkspaceAccess['workspace']> {
    const actor = await this.requireActor(args, ['owner'])
    if (actor.workspace.kind === 'personal') {
      throw validation('Personal workspaces cannot be archived')
    }
    const archived = await this.repository.archiveWorkspace({
      workspaceId: actor.workspace.id,
      archivedByPrincipalId: actor.principal.id,
      now: this.now(),
    })
    if (!archived) throw notFound()
    return archived
  }

  async createPrincipal(args: {
    actorUserId: string
    workspaceId: string
    type: Exclude<WorkspacePrincipalType, 'human'>
    displayName: string
    agentId?: string
    serviceId?: string
  }): Promise<WorkspacePrincipal> {
    const actor = await this.requireManager(args)
    const displayName = required(args.displayName, 'displayName')
    if (args.type === 'agent' && !optional(args.agentId)) {
      throw validation('agentId is required for an agent principal')
    }
    if (args.type === 'service' && !optional(args.serviceId)) {
      throw validation('serviceId is required for a service principal')
    }
    return await this.repository.createPrincipal({
      id: this.id(),
      workspaceId: actor.workspace.id,
      type: args.type,
      agentId: optional(args.agentId),
      serviceId: optional(args.serviceId),
      displayName,
      createdByPrincipalId: actor.principal.id,
      now: this.now(),
    })
  }

  async setMembershipRole(args: {
    actorUserId: string
    workspaceId: string
    principalId: string
    role: WorkspaceMembershipRole
  }): Promise<WorkspaceMembership> {
    const actor = await this.requireManager(args)
    const target = await this.repository.getMembership({
      workspaceId: actor.workspace.id,
      principalId: required(args.principalId, 'principalId'),
    })
    if (!target) throw notFound()
    if (
      (target.role === 'owner' || args.role === 'owner')
      && actor.membership.role !== 'owner'
    ) {
      throw forbidden()
    }
    const result = await this.repository.setMembershipRole({
      workspaceId: args.workspaceId,
      principalId: target.principalId,
      role: args.role,
      now: this.now(),
    })
    if (result.status === 'updated') return result.membership
    if (result.status === 'last_owner') throw lastOwner()
    if (result.status === 'owner_must_be_human') {
      throw validation('Only human principals can own a workspace')
    }
    throw notFound()
  }

  async setMembershipStatus(args: {
    actorUserId: string
    workspaceId: string
    principalId: string
    status: WorkspaceMembership['status']
  }): Promise<WorkspaceMembership> {
    const actor = await this.requireManager(args)
    const target = await this.repository.getMembership({
      workspaceId: actor.workspace.id,
      principalId: required(args.principalId, 'principalId'),
    })
    if (!target) throw notFound()
    if (target.role === 'owner' && actor.membership.role !== 'owner') throw forbidden()
    const result = await this.repository.setMembershipStatus({
      workspaceId: args.workspaceId,
      principalId: target.principalId,
      status: args.status,
      now: this.now(),
    })
    if (result.status === 'updated') return result.membership
    if (result.status === 'last_owner') throw lastOwner()
    throw notFound()
  }

  async removeMember(args: {
    actorUserId: string
    workspaceId: string
    principalId: string
  }): Promise<void> {
    const actor = await this.requireManager(args)
    const target = await this.repository.getMembership({
      workspaceId: actor.workspace.id,
      principalId: required(args.principalId, 'principalId'),
    })
    if (!target) throw notFound()
    if (target.role === 'owner' && actor.membership.role !== 'owner') throw forbidden()
    const result = await this.repository.removeMembership({
      workspaceId: args.workspaceId,
      principalId: target.principalId,
    })
    if (result.status === 'removed') return
    if (result.status === 'last_owner') throw lastOwner()
    throw notFound()
  }

  async transferOwnership(args: {
    actorUserId: string
    workspaceId: string
    toPrincipalId: string
  }): Promise<WorkspaceMembership> {
    const actor = await this.requireActor(args, ['owner'])
    const result = await this.repository.transferOwnership({
      workspaceId: actor.workspace.id,
      fromPrincipalId: actor.principal.id,
      toPrincipalId: required(args.toPrincipalId, 'toPrincipalId'),
      now: this.now(),
    })
    if (result.status === 'transferred') return result.newOwnerMembership
    if (result.status === 'target_not_human') {
      throw validation('Ownership can be transferred only to a human member')
    }
    if (result.status === 'target_inactive') {
      throw validation('Ownership can be transferred only to an active member')
    }
    throw notFound()
  }

  async listMembers(args: {
    actorUserId: string
    workspaceId: string
  }): Promise<WorkspaceMember[]> {
    const actor = await this.requireActiveMember(args)
    const [principals, memberships] = await Promise.all([
      this.repository.listPrincipals({
        workspaceId: actor.workspace.id,
        includeArchived: false,
      }),
      this.repository.listMemberships({
        workspaceId: actor.workspace.id,
        status: 'active',
      }),
    ])
    const principalsById = new Map(principals.map((principal) => [principal.id, principal]))
    return memberships.flatMap((membership) => {
      const principal = principalsById.get(membership.principalId)
      return principal ? [{ principal, membership }] : []
    })
  }

  async createTeam(args: {
    actorUserId: string
    workspaceId: string
    name: string
    description?: string
  }): Promise<WorkspaceTeam> {
    const actor = await this.requireWorkspaceCreator(args)
    return await this.repository.createTeam({
      id: this.id(),
      workspaceId: actor.workspace.id,
      name: required(args.name, 'name'),
      description: optional(args.description),
      createdByPrincipalId: actor.principal.id,
      now: this.now(),
    })
  }

  async addTeamMember(args: {
    actorUserId: string
    workspaceId: string
    teamId: string
    principalId: string
  }): Promise<WorkspaceTeamMember> {
    const actor = await this.requireActiveMember(args)
    const [team, principal] = await Promise.all([
      this.repository.getTeam(required(args.teamId, 'teamId')),
      this.repository.getPrincipal(required(args.principalId, 'principalId')),
    ])
    if (!team || team.workspaceId !== actor.workspace.id || team.archivedAt) throw notFound()
    this.requireTeamManager(actor, team)
    if (!principal || principal.workspaceId !== actor.workspace.id || principal.archivedAt) {
      throw notFound()
    }
    if (!canJoinTeam(principal)) {
      throw validation('Teams may contain only human and agent principals')
    }
    return await this.repository.addTeamMember({
      teamId: team.id,
      workspaceId: actor.workspace.id,
      principalId: principal.id,
      principalType: principal.type,
      addedByPrincipalId: actor.principal.id,
      now: this.now(),
    })
  }

  async listTeams(args: {
    actorUserId: string
    workspaceId: string
  }): Promise<WorkspaceTeamWithMembers[]> {
    const actor = await this.requireActiveMember(args)
    const teams = await this.repository.listTeams({
      workspaceId: actor.workspace.id,
      includeArchived: false,
    })
    return await Promise.all(teams.map(async (team) => ({
      team,
      members: await this.repository.listTeamMembers(team.id),
    })))
  }

  async archiveTeam(args: {
    actorUserId: string
    workspaceId: string
    teamId: string
  }): Promise<void> {
    const actor = await this.requireActiveMember(args)
    const team = await this.repository.getTeam(required(args.teamId, 'teamId'))
    if (!team || team.workspaceId !== actor.workspace.id || team.archivedAt) throw notFound()
    this.requireTeamManager(actor, team)
    if (!await this.repository.archiveTeam({ teamId: team.id, now: this.now() })) throw notFound()
  }

  async removeTeamMember(args: {
    actorUserId: string
    workspaceId: string
    teamId: string
    principalId: string
  }): Promise<void> {
    const actor = await this.requireActiveMember(args)
    const team = await this.repository.getTeam(required(args.teamId, 'teamId'))
    if (!team || team.workspaceId !== actor.workspace.id || team.archivedAt) throw notFound()
    this.requireTeamManager(actor, team)
    if (!await this.repository.removeTeamMember({
      teamId: team.id,
      principalId: required(args.principalId, 'principalId'),
    })) throw notFound()
  }

  async invite(args: {
    actorUserId: string
    workspaceId: string
    email: string
    role: Exclude<WorkspaceMembershipRole, 'owner'>
    expiresAt?: number
  }): Promise<WorkspaceInvitation> {
    const actor = await this.requireManager(args)
    const now = this.now()
    const email = normalizeEmail(args.email)
    const principals = await this.repository.listPrincipals({
      workspaceId: actor.workspace.id,
      includeArchived: false,
      type: 'human',
    })
    if (principals.some((principal) => principal.email?.toLowerCase() === email)) {
      throw new WorkspaceServiceError(
        'This person is already a workspace member',
        409,
        'conflict',
      )
    }
    const expiresAt = args.expiresAt
      ?? now + (this.options.invitationTtlMs ?? 7 * 24 * 60 * 60 * 1_000)
    if (expiresAt <= now) throw validation('Invitation expiry must be in the future')
    return await this.repository.createInvitationReplacingPending({
      id: this.id(),
      workspaceId: actor.workspace.id,
      email,
      role: args.role,
      invitedByPrincipalId: actor.principal.id,
      expiresAt,
      now,
    })
  }

  async acceptInvitation(args: {
    invitationId: string
    userId: string
    email: string
    displayName?: string
  }): Promise<WorkspaceAccess> {
    const now = this.now()
    const email = normalizeEmail(args.email)
    const result = await this.repository.acceptInvitation({
      invitationId: required(args.invitationId, 'invitationId'),
      principalId: this.id(),
      userId: required(args.userId, 'userId'),
      email,
      displayName: optional(args.displayName) ?? email,
      now,
    })
    if (result.status === 'accepted') return result.access
    if (result.status === 'expired') {
      throw new WorkspaceServiceError('Invitation has expired', 410, 'invitation_expired')
    }
    if (result.status === 'email_mismatch') {
      throw new WorkspaceServiceError(
        'Sign in with the email address that was invited',
        403,
        'invitation_invalid',
      )
    }
    if (result.status === 'not_pending') {
      throw new WorkspaceServiceError('Invitation is no longer available', 409, 'invitation_invalid')
    }
    throw notFound('Invitation not found')
  }

  async cancelInvitation(args: {
    actorUserId: string
    workspaceId: string
    invitationId: string
  }): Promise<WorkspaceInvitation> {
    const actor = await this.requireManager(args)
    const invitation = await this.repository.getInvitation(
      required(args.invitationId, 'invitationId'),
    )
    if (!invitation || invitation.workspaceId !== actor.workspace.id) throw notFound()
    const cancelled = await this.repository.cancelInvitation({
      invitationId: invitation.id,
      cancelledByPrincipalId: actor.principal.id,
      now: this.now(),
    })
    if (!cancelled) {
      throw new WorkspaceServiceError('Invitation is no longer pending', 409, 'conflict')
    }
    return cancelled
  }

  async listInvitations(args: {
    actorUserId: string
    workspaceId: string
  }): Promise<WorkspaceInvitation[]> {
    const actor = await this.requireManager(args)
    await this.repository.expireInvitations({
      workspaceId: actor.workspace.id,
      now: this.now(),
    })
    return await this.repository.listInvitations({ workspaceId: actor.workspace.id })
  }

  async resendInvitation(args: {
    actorUserId: string
    workspaceId: string
    invitationId: string
  }): Promise<WorkspaceInvitation> {
    const actor = await this.requireManager(args)
    const existing = await this.repository.getInvitation(
      required(args.invitationId, 'invitationId'),
    )
    if (!existing || existing.workspaceId !== actor.workspace.id) throw notFound()
    if (existing.status === 'accepted' || existing.status === 'cancelled') {
      throw new WorkspaceServiceError('Invitation can no longer be resent', 409, 'conflict')
    }
    const now = this.now()
    return await this.repository.createInvitationReplacingPending({
      id: this.id(),
      workspaceId: actor.workspace.id,
      email: existing.email,
      role: existing.role,
      invitedByPrincipalId: actor.principal.id,
      expiresAt: now + (this.options.invitationTtlMs ?? 7 * 24 * 60 * 60 * 1_000),
      now,
    })
  }

  async addResourceGuest(args: {
    actorUserId: string
    workspaceId: string
    resourceType: string
    resourceId: string
    principalId: string
    accessRole: WorkspaceResourceGuest['accessRole']
    expiresAt?: number
  }): Promise<WorkspaceResourceGuest> {
    const actor = await this.requireManager(args)
    await this.assertResourceWorkspace({
      actorUserId: args.actorUserId,
      workspaceId: actor.workspace.id,
      resourceType: args.resourceType,
      resourceId: args.resourceId,
    })
    const principal = await this.repository.getPrincipal(required(args.principalId, 'principalId'))
    if (
      !principal
      || principal.workspaceId !== actor.workspace.id
      || principal.type !== 'human'
      || principal.archivedAt
    ) {
      throw validation('Resource guests must be active human principals in this workspace')
    }
    const membership = await this.repository.getMembership({
      workspaceId: actor.workspace.id,
      principalId: principal.id,
    })
    if (!membership || membership.role !== 'guest' || membership.status !== 'active') {
      throw validation('Resource guests require an active workspace guest membership')
    }
    return await this.repository.createResourceGuest({
      id: this.id(),
      workspaceId: actor.workspace.id,
      resourceType: required(args.resourceType, 'resourceType'),
      resourceId: required(args.resourceId, 'resourceId'),
      principalId: principal.id,
      accessRole: args.accessRole,
      status: 'active',
      grantedByPrincipalId: actor.principal.id,
      expiresAt: args.expiresAt,
      now: this.now(),
    })
  }

  async bindResource(args: {
    actorUserId: string
    workspaceId: string
    resourceType: string
    resourceId: string
  }): Promise<WorkspaceResourceScope> {
    const actor = await this.requireActiveMember(args)
    return await this.repository.bindResource({
      workspaceId: actor.workspace.id,
      resourceType: required(args.resourceType, 'resourceType'),
      resourceId: required(args.resourceId, 'resourceId'),
      now: this.now(),
    })
  }

  async assertResourceWorkspace(args: {
    actorUserId: string
    workspaceId: string
    resourceType: string
    resourceId: string
  }): Promise<WorkspaceResourceScope> {
    const actor = await this.requireActiveMember(args)
    const scope = await this.repository.getResourceWorkspace({
      resourceType: required(args.resourceType, 'resourceType'),
      resourceId: required(args.resourceId, 'resourceId'),
    })
    if (!scope) throw notFound('Resource scope not found')
    if (scope.workspaceId !== actor.workspace.id) throw notFound('Resource not found')
    return scope
  }

  async listResourceGuests(args: {
    actorUserId: string
    workspaceId: string
  }): Promise<WorkspaceResourceGuest[]> {
    const actor = await this.requireManager(args)
    return await this.repository.listResourceGuests({
      workspaceId: actor.workspace.id,
      includeInactive: true,
    })
  }

  async revokeResourceGuest(args: {
    actorUserId: string
    workspaceId: string
    resourceGuestId: string
  }): Promise<WorkspaceResourceGuest> {
    const actor = await this.requireManager(args)
    const guests = await this.repository.listResourceGuests({
      workspaceId: actor.workspace.id,
      includeInactive: true,
    })
    const guest = guests.find((candidate) => candidate.id === args.resourceGuestId)
    if (!guest) throw notFound()
    const revoked = await this.repository.revokeResourceGuest({
      id: guest.id,
      revokedByPrincipalId: actor.principal.id,
      now: this.now(),
    })
    if (!revoked) throw notFound()
    return revoked
  }

  private async requireManager(args: {
    actorUserId: string
    workspaceId: string
  }): Promise<WorkspaceAccess> {
    const access = await this.requireActiveMember(args)
    if (!canManageWorkspace(access.membership.role)) throw forbidden()
    return access
  }

  private async requireWorkspaceCreator(args: {
    actorUserId: string
    workspaceId: string
  }): Promise<WorkspaceAccess> {
    const access = await this.requireActiveMember(args)
    if (access.membership.role === 'guest') throw forbidden()
    return access
  }

  private requireTeamManager(access: WorkspaceAccess, team: WorkspaceTeam): void {
    if (
      !canManageWorkspace(access.membership.role)
      && team.createdByPrincipalId !== access.principal.id
    ) {
      throw forbidden()
    }
  }

  private async requireActor(
    args: { actorUserId: string; workspaceId: string },
    roles: WorkspaceMembershipRole[],
  ): Promise<WorkspaceAccess> {
    const access = await this.requireActiveMember(args)
    if (!roles.includes(access.membership.role)) throw forbidden()
    return access
  }

  private async requireActiveMember(args: {
    actorUserId: string
    workspaceId: string
  }): Promise<WorkspaceAccess> {
    const access = await this.repository.getAccess({
      userId: required(args.actorUserId, 'actorUserId'),
      workspaceId: required(args.workspaceId, 'workspaceId'),
    })
    return requireUsableAccess(access)
  }

  private id(): string {
    return (this.options.createId ?? randomUUID)()
  }

  private now(): number {
    return (this.options.now ?? Date.now)()
  }
}

function isUsableAccess(access: WorkspaceAccess | null): access is WorkspaceAccess {
  return Boolean(
    access
    && access.workspace.status === 'active'
    && !access.principal.archivedAt
    && access.membership.status === 'active',
  )
}

function requireUsableAccess(access: WorkspaceAccess | null): WorkspaceAccess {
  if (!isUsableAccess(access)) throw notFound()
  return access
}

function required(value: string, field: string): string {
  const normalized = value.trim()
  if (!normalized) throw validation(`${field} is required`)
  return normalized
}

function optional(value: string | undefined): string | undefined {
  const normalized = value?.trim()
  return normalized || undefined
}

function normalizeEmail(value: string): string {
  const email = required(value, 'email').toLowerCase()
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw validation('email is invalid')
  return email
}

function normalizeOptionalEmail(value: string | undefined): string | undefined {
  return value === undefined ? undefined : normalizeEmail(value)
}

function normalizeOptionalSlug(value: string | undefined): string | undefined {
  const slug = optional(value)?.toLowerCase()
  if (!slug) return undefined
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    throw validation('slug must contain lowercase letters, numbers, and single hyphens')
  }
  return slug
}

function slugify(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 63)
  return slug || 'workspace'
}

function validation(message: string): WorkspaceServiceError {
  return new WorkspaceServiceError(message, 400, 'validation')
}

function forbidden(): WorkspaceServiceError {
  return new WorkspaceServiceError('Forbidden', 403, 'forbidden')
}

function notFound(message = 'Workspace resource not found'): WorkspaceServiceError {
  return new WorkspaceServiceError(message, 404, 'not_found')
}

function lastOwner(): WorkspaceServiceError {
  return new WorkspaceServiceError(
    'Transfer ownership before removing or changing the final owner',
    409,
    'last_owner',
  )
}
