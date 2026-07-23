import assert from 'node:assert/strict'
import test from 'node:test'
import type {
  AuthorizationGroup,
  AuthorizationRepositories,
  AuthorizationRole,
  GroupMembership,
  GroupRoleAssignment,
  ResourceGrant,
  UserRoleAssignment,
} from '@overlay/authz-contracts'
import { AuditService } from '@/server/admin/AuditService'
import type { AuditEventRecord, AuditRepository } from '@/server/admin/AuditRepository'
import { AdministrativeAuthorizationError } from '@/server/admin/AdministrativeService'
import {
  AuthorizationAdministrationService,
  type AuthorizationAdministrationActor,
} from './AuthorizationAdministrationService'

const ACTOR: AuthorizationAdministrationActor = {
  actorType: 'user',
  actorUserId: 'admin_1',
  requestId: 'request_1',
}

test('administration service manages roles, groups, assignments, and grants with audit records', async () => {
  const fixture = createFixture()

  const role = await fixture.service.createRole(ACTOR, {
    name: 'Knowledge publisher',
    capabilities: ['knowledge.read', 'knowledge.publish'],
  })
  const group = await fixture.service.createGroup(ACTOR, { name: 'Curriculum team' })
  const membership = await fixture.service.addGroupMember(ACTOR, {
    groupId: group.id,
    userId: 'user_1',
  })
  const assignment = await fixture.service.assignRole(ACTOR, {
    subjectType: 'group',
    subjectId: group.id,
    roleId: role.id,
  })
  const grant = await fixture.service.upsertResourceGrant(ACTOR, {
    resourceType: 'knowledge_base',
    resourceId: 'kb_1',
    principalType: 'group',
    principalId: group.id,
    accessRole: 'editor',
  })

  assert.match(role.id, /^role_/)
  assert.match(group.id, /^group_/)
  assert.equal(membership.source, 'local')
  assert.equal('groupId' in assignment && assignment.groupId, group.id)
  assert.match(grant.id, /^grant_/)
  assert.deepEqual(await fixture.service.listAssignments(ACTOR, {
    subjectType: 'group',
    subjectId: group.id,
  }), [assignment])
  assert.deepEqual(await fixture.service.listRoleAssignments(ACTOR, role.id), {
    users: [],
    groups: [assignment],
  })
  assert.deepEqual(await fixture.service.listResourceGrants(ACTOR, {
    resourceType: 'knowledge_base',
    resourceId: 'kb_1',
  }), [grant])
  assert.deepEqual(fixture.auditEvents.map(({ action }) => action), [
    'authorization.role.create',
    'authorization.group.create',
    'authorization.group_member.add',
    'authorization.role.assign',
    'authorization.resource_grant.upsert',
  ])
})

test('administration service rejects missing granular administration capabilities', async () => {
  const fixture = createFixture({ administrator: false })

  await assert.rejects(
    fixture.service.listRoles(ACTOR),
    AdministrativeAuthorizationError,
  )
  assert.equal(fixture.auditEvents.length, 0)
})

test('administration service protects system roles and externally managed groups', async () => {
  const fixture = createFixture()
  fixture.roles.set('role_system', {
    id: 'role_system',
    name: 'System administrator',
    capabilities: ['roles.manage'],
    isSystem: true,
    createdAt: 1,
    updatedAt: 1,
  })
  fixture.groups.set('group_external', {
    id: 'group_external',
    name: 'Directory group',
    source: 'external',
    createdAt: 1,
    updatedAt: 1,
  })

  await assert.rejects(
    fixture.service.updateRole(ACTOR, { roleId: 'role_system', name: 'Changed' }),
    /System authorization roles cannot be modified/,
  )
  await assert.rejects(
    fixture.service.addGroupMember(ACTOR, { groupId: 'group_external', userId: 'user_1' }),
    /Externally managed authorization groups cannot be modified/,
  )
})

function createFixture(options: { administrator?: boolean } = {}) {
  const roles = new Map<string, AuthorizationRole>()
  const groups = new Map<string, AuthorizationGroup>()
  const memberships: GroupMembership[] = []
  const userAssignments: UserRoleAssignment[] = []
  const groupAssignments: GroupRoleAssignment[] = []
  const grants: ResourceGrant[] = []
  const auditEvents: AuditEventRecord[] = []
  const now = () => Date.now()

  const repositories: AuthorizationRepositories = {
    roles: {
      async create(input) {
        const value: AuthorizationRole = {
          ...input,
          isSystem: input.isSystem ?? false,
          createdAt: now(),
          updatedAt: now(),
        }
        roles.set(value.id, value)
        return value
      },
      async get(id) { return roles.get(id) ?? null },
      async list({ includeArchived = false } = {}) {
        return [...roles.values()].filter(({ archivedAt }) => includeArchived || !archivedAt)
      },
      async update(input) {
        const current = roles.get(input.id)
        if (!current) return null
        const updated = { ...current, ...input, updatedAt: now() }
        roles.set(input.id, updated)
        return updated
      },
      async archive({ id }) {
        const current = roles.get(id)
        if (!current) return false
        roles.set(id, { ...current, archivedAt: now(), updatedAt: now() })
        return true
      },
    },
    groups: {
      async create(input) {
        const value: AuthorizationGroup = {
          ...input,
          source: input.source ?? 'local',
          createdAt: now(),
          updatedAt: now(),
        }
        groups.set(value.id, value)
        return value
      },
      async get(id) { return groups.get(id) ?? null },
      async list({ includeArchived = false } = {}) {
        return [...groups.values()].filter(({ archivedAt }) => includeArchived || !archivedAt)
      },
      async update(input) {
        const current = groups.get(input.id)
        if (!current) return null
        const updated = { ...current, ...input, updatedAt: now() }
        groups.set(input.id, updated)
        return updated
      },
      async archive({ id }) {
        const current = groups.get(id)
        if (!current) return false
        groups.set(id, { ...current, archivedAt: now(), updatedAt: now() })
        return true
      },
      async addMember(input) {
        const value = { ...input, source: input.source ?? 'local', createdAt: now() }
        const index = memberships.findIndex(({ groupId, userId }) => (
          groupId === input.groupId && userId === input.userId
        ))
        if (index >= 0) memberships[index] = value
        else memberships.push(value)
        return value
      },
      async removeMember(input) {
        const index = memberships.findIndex(({ groupId, userId }) => (
          groupId === input.groupId && userId === input.userId
        ))
        if (index < 0) return false
        memberships.splice(index, 1)
        return true
      },
      async listMembers(groupId) { return memberships.filter((item) => item.groupId === groupId) },
      async listForUser(userId) {
        const groupIds = memberships.filter((item) => item.userId === userId).map(({ groupId }) => groupId)
        return groupIds.flatMap((id) => groups.get(id) ?? [])
      },
    },
    assignments: {
      async assignUser(input) {
        const value = { ...input, createdAt: now() }
        userAssignments.push(value)
        return value
      },
      async revokeUser(input) {
        const index = userAssignments.findIndex((item) => item.userId === input.userId && item.roleId === input.roleId)
        if (index < 0) return false
        userAssignments.splice(index, 1)
        return true
      },
      async listForUser(userId) { return userAssignments.filter((item) => item.userId === userId) },
      async listUsersForRole(roleId) { return userAssignments.filter((item) => item.roleId === roleId) },
      async assignGroup(input) {
        const value = { ...input, createdAt: now() }
        groupAssignments.push(value)
        return value
      },
      async revokeGroup(input) {
        const index = groupAssignments.findIndex((item) => item.groupId === input.groupId && item.roleId === input.roleId)
        if (index < 0) return false
        groupAssignments.splice(index, 1)
        return true
      },
      async listForGroups(groupIds) { return groupAssignments.filter((item) => groupIds.includes(item.groupId)) },
      async listGroupsForRole(roleId) { return groupAssignments.filter((item) => item.roleId === roleId) },
    },
    resourceGrants: {
      async upsert(input) {
        const existing = grants.find((item) => (
          item.resourceType === input.resourceType && item.resourceId === input.resourceId &&
          item.principalType === input.principalType && item.principalId === input.principalId
        ))
        const value = {
          ...input,
          id: existing?.id ?? input.id,
          createdAt: existing?.createdAt ?? now(),
          updatedAt: now(),
        }
        if (existing) grants.splice(grants.indexOf(existing), 1, value)
        else grants.push(value)
        return value
      },
      async remove(id) {
        const index = grants.findIndex((item) => item.id === id)
        if (index < 0) return false
        grants.splice(index, 1)
        return true
      },
      async listForResource(input) {
        return grants.filter((item) => item.resourceType === input.resourceType && item.resourceId === input.resourceId)
      },
      async listForPrincipals() { return [] },
    },
  }

  const auditRepository: AuditRepository = {
    async append(input) {
      const value: AuditEventRecord = {
        ...input,
        id: input.id ?? `audit_${auditEvents.length + 1}`,
        createdAt: input.createdAt ?? now(),
      }
      auditEvents.push(value)
      return value
    },
    async list() { return auditEvents },
  }
  const service = new AuthorizationAdministrationService({
    assertCapability: async () => {
      if (options.administrator === false) throw new AdministrativeAuthorizationError()
    },
    audit: new AuditService(auditRepository),
    repositories,
  })

  return { auditEvents, groups, roles, service }
}
