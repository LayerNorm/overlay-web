import 'server-only'

import { randomUUID } from 'node:crypto'
import {
  AUTHORIZATION_CAPABILITY_DEFINITIONS,
  type AuthorizationCapability,
  type AuthorizationPrincipalType,
  type AuthorizationRepositories,
  type ResourceAccessRole,
} from '@overlay/authz-contracts'
import type { AuditActorType } from '@/server/admin/AuditRepository'
import type { AuditService } from '@/server/admin/AuditService'

export type AuthorizationAdministrationActor = {
  actorApiKeyId?: string
  actorType: AuditActorType
  actorUserId: string
  ipAddress?: string
  requestId?: string
}

export type AuthorizationAdministrationServiceDeps = {
  assertAdministrator(userId: string): Promise<void>
  audit: AuditService
  prepareAuthorization?(): Promise<void>
  repositories: AuthorizationRepositories
}

export class AuthorizationAdministrationService {
  constructor(private readonly deps: AuthorizationAdministrationServiceDeps) {}

  async listCapabilities(actor: AuthorizationAdministrationActor) {
    await this.assertAdministrator(actor)
    return AUTHORIZATION_CAPABILITY_DEFINITIONS
  }

  async listRoles(actor: AuthorizationAdministrationActor, includeArchived = false) {
    await this.assertAdministrator(actor)
    await this.deps.prepareAuthorization?.()
    return await this.deps.repositories.roles.list({ includeArchived })
  }

  async createRole(actor: AuthorizationAdministrationActor, input: {
    name: string
    description?: string
    capabilities: AuthorizationCapability[]
  }) {
    await this.assertAdministrator(actor)
    const role = await this.deps.repositories.roles.create({
      id: prefixedId('role'),
      name: input.name,
      description: input.description,
      capabilities: input.capabilities,
      createdBy: actor.actorUserId,
      isSystem: false,
    })
    await this.audit(actor, 'authorization.role.create', 'authorization_role', role.id, {
      capabilities: role.capabilities,
      name: role.name,
    })
    return role
  }

  async updateRole(actor: AuthorizationAdministrationActor, input: {
    roleId: string
    name?: string
    description?: string
    capabilities?: AuthorizationCapability[]
  }) {
    await this.assertAdministrator(actor)
    const existing = await this.requireRole(input.roleId)
    assertMutableRole(existing)
    const role = await this.deps.repositories.roles.update({
      id: input.roleId,
      name: input.name,
      description: input.description,
      capabilities: input.capabilities,
    })
    if (!role) throw new Error('Authorization role not found')
    await this.audit(actor, 'authorization.role.update', 'authorization_role', role.id, {
      capabilities: role.capabilities,
      name: role.name,
    })
    return role
  }

  async archiveRole(actor: AuthorizationAdministrationActor, roleId: string): Promise<boolean> {
    await this.assertAdministrator(actor)
    const existing = await this.requireRole(roleId)
    assertMutableRole(existing)
    const archived = await this.deps.repositories.roles.archive({
      id: roleId,
      archivedBy: actor.actorUserId,
    })
    await this.audit(actor, 'authorization.role.archive', 'authorization_role', roleId, {
      archived,
    })
    return archived
  }

  async listGroups(actor: AuthorizationAdministrationActor, includeArchived = false) {
    await this.assertAdministrator(actor)
    return await this.deps.repositories.groups.list({ includeArchived })
  }

  async createGroup(actor: AuthorizationAdministrationActor, input: {
    name: string
    description?: string
  }) {
    await this.assertAdministrator(actor)
    const group = await this.deps.repositories.groups.create({
      id: prefixedId('group'),
      name: input.name,
      description: input.description,
      source: 'local',
      createdBy: actor.actorUserId,
    })
    await this.audit(actor, 'authorization.group.create', 'authorization_group', group.id, {
      name: group.name,
    })
    return group
  }

  async updateGroup(actor: AuthorizationAdministrationActor, input: {
    groupId: string
    name?: string
    description?: string
  }) {
    await this.assertAdministrator(actor)
    const existing = await this.requireGroup(input.groupId)
    assertMutableGroup(existing)
    const group = await this.deps.repositories.groups.update({
      id: input.groupId,
      name: input.name,
      description: input.description,
    })
    if (!group) throw new Error('Authorization group not found')
    await this.audit(actor, 'authorization.group.update', 'authorization_group', group.id, {
      name: group.name,
    })
    return group
  }

  async archiveGroup(actor: AuthorizationAdministrationActor, groupId: string): Promise<boolean> {
    await this.assertAdministrator(actor)
    const existing = await this.requireGroup(groupId)
    assertMutableGroup(existing)
    const archived = await this.deps.repositories.groups.archive({
      id: groupId,
      archivedBy: actor.actorUserId,
    })
    await this.audit(actor, 'authorization.group.archive', 'authorization_group', groupId, {
      archived,
    })
    return archived
  }

  async listGroupMembers(actor: AuthorizationAdministrationActor, groupId: string) {
    await this.assertAdministrator(actor)
    await this.requireGroup(groupId)
    return await this.deps.repositories.groups.listMembers(groupId)
  }

  async addGroupMember(actor: AuthorizationAdministrationActor, input: {
    groupId: string
    userId: string
  }) {
    await this.assertAdministrator(actor)
    const group = await this.requireGroup(input.groupId)
    assertMutableGroup(group)
    const membership = await this.deps.repositories.groups.addMember({
      groupId: input.groupId,
      userId: input.userId,
      source: 'local',
    })
    await this.audit(actor, 'authorization.group_member.add', 'authorization_group', input.groupId, {
      userId: input.userId,
    })
    return membership
  }

  async removeGroupMember(actor: AuthorizationAdministrationActor, input: {
    groupId: string
    userId: string
  }): Promise<boolean> {
    await this.assertAdministrator(actor)
    const group = await this.requireGroup(input.groupId)
    assertMutableGroup(group)
    const removed = await this.deps.repositories.groups.removeMember(input)
    await this.audit(actor, 'authorization.group_member.remove', 'authorization_group', input.groupId, {
      removed,
      userId: input.userId,
    })
    return removed
  }

  async listAssignments(actor: AuthorizationAdministrationActor, input: {
    subjectType: 'user' | 'group'
    subjectId: string
  }) {
    await this.assertAdministrator(actor)
    if (input.subjectType === 'user') {
      return await this.deps.repositories.assignments.listForUser(input.subjectId)
    }
    await this.requireGroup(input.subjectId)
    return await this.deps.repositories.assignments.listForGroups([input.subjectId])
  }

  async listRoleAssignments(actor: AuthorizationAdministrationActor, roleId: string) {
    await this.assertAdministrator(actor)
    await this.requireRole(roleId)
    const [users, groups] = await Promise.all([
      this.deps.repositories.assignments.listUsersForRole(roleId),
      this.deps.repositories.assignments.listGroupsForRole(roleId),
    ])
    return { users, groups }
  }

  async assignRole(actor: AuthorizationAdministrationActor, input: {
    subjectType: 'user' | 'group'
    subjectId: string
    roleId: string
  }) {
    await this.assertAdministrator(actor)
    const role = await this.requireRole(input.roleId)
    if (role.archivedAt) throw new Error('Cannot assign an archived authorization role')
    const assignment = input.subjectType === 'user'
      ? await this.deps.repositories.assignments.assignUser({
          userId: input.subjectId,
          roleId: input.roleId,
          assignedBy: actor.actorUserId,
        })
      : await this.assignGroupRole(actor, input)
    await this.audit(actor, 'authorization.role.assign', 'authorization_role', input.roleId, {
      subjectId: input.subjectId,
      subjectType: input.subjectType,
    })
    return assignment
  }

  async revokeRole(actor: AuthorizationAdministrationActor, input: {
    subjectType: 'user' | 'group'
    subjectId: string
    roleId: string
  }): Promise<boolean> {
    await this.assertAdministrator(actor)
    const revoked = input.subjectType === 'user'
      ? await this.deps.repositories.assignments.revokeUser({
          userId: input.subjectId,
          roleId: input.roleId,
        })
      : await this.deps.repositories.assignments.revokeGroup({
          groupId: input.subjectId,
          roleId: input.roleId,
        })
    await this.audit(actor, 'authorization.role.revoke', 'authorization_role', input.roleId, {
      revoked,
      subjectId: input.subjectId,
      subjectType: input.subjectType,
    })
    return revoked
  }

  async listResourceGrants(actor: AuthorizationAdministrationActor, input: {
    resourceType: string
    resourceId: string
  }) {
    await this.assertAdministrator(actor)
    return await this.deps.repositories.resourceGrants.listForResource(input)
  }

  async upsertResourceGrant(actor: AuthorizationAdministrationActor, input: {
    resourceType: string
    resourceId: string
    principalType: AuthorizationPrincipalType
    principalId: string
    accessRole: ResourceAccessRole
  }) {
    await this.assertAdministrator(actor)
    await this.requirePrincipal(input.principalType, input.principalId)
    const grant = await this.deps.repositories.resourceGrants.upsert({
      id: prefixedId('grant'),
      ...input,
      grantedBy: actor.actorUserId,
    })
    await this.audit(actor, 'authorization.resource_grant.upsert', input.resourceType, input.resourceId, {
      accessRole: input.accessRole,
      principalId: input.principalId,
      principalType: input.principalType,
    })
    return grant
  }

  async removeResourceGrant(actor: AuthorizationAdministrationActor, grantId: string): Promise<boolean> {
    await this.assertAdministrator(actor)
    const removed = await this.deps.repositories.resourceGrants.remove(grantId)
    await this.audit(actor, 'authorization.resource_grant.remove', 'authorization_resource_grant', grantId, {
      removed,
    })
    return removed
  }

  private async assignGroupRole(actor: AuthorizationAdministrationActor, input: {
    subjectId: string
    roleId: string
  }) {
    const group = await this.requireGroup(input.subjectId)
    if (group.archivedAt) throw new Error('Cannot assign a role to an archived authorization group')
    return await this.deps.repositories.assignments.assignGroup({
      groupId: input.subjectId,
      roleId: input.roleId,
      assignedBy: actor.actorUserId,
    })
  }

  private async requirePrincipal(type: AuthorizationPrincipalType, id: string): Promise<void> {
    if (type === 'role') {
      await this.requireRole(id)
    } else if (type === 'group') {
      await this.requireGroup(id)
    }
  }

  private async requireRole(roleId: string) {
    const role = await this.deps.repositories.roles.get(roleId)
    if (!role) throw new Error('Authorization role not found')
    return role
  }

  private async requireGroup(groupId: string) {
    const group = await this.deps.repositories.groups.get(groupId)
    if (!group) throw new Error('Authorization group not found')
    return group
  }

  private async assertAdministrator(actor: AuthorizationAdministrationActor): Promise<void> {
    await this.deps.assertAdministrator(actor.actorUserId)
  }

  private async audit(
    actor: AuthorizationAdministrationActor,
    action: string,
    resourceType: string,
    resourceId: string,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    await this.deps.audit.record({
      action,
      actorApiKeyId: actor.actorApiKeyId,
      actorType: actor.actorType,
      actorUserId: actor.actorUserId,
      ipAddress: actor.ipAddress,
      metadata,
      outcome: 'success',
      requestId: actor.requestId,
      resourceId,
      resourceType,
    })
  }
}

function prefixedId(prefix: string): string {
  return `${prefix}_${randomUUID()}`
}

function assertMutableRole(role: { isSystem: boolean }): void {
  if (role.isSystem) throw new Error('System authorization roles cannot be modified')
}

function assertMutableGroup(group: { source: 'local' | 'external' }): void {
  if (group.source === 'external') {
    throw new Error('Externally managed authorization groups cannot be modified')
  }
}
