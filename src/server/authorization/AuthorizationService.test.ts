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
import {
  AuthorizationDeniedError,
  AuthorizationService,
} from './AuthorizationService'
import { createAuthorizationCapabilityPolicy } from './runtime-capability-policy'
import { DEFAULT_OVERLAY_CAPABILITIES } from '@overlay/app-core'

test('authorization evaluator resolves direct and group capabilities', async () => {
  const fixture = createFixture()
  fixture.groups.push(group('research'))
  fixture.memberships.push({ groupId: 'research', userId: 'user_1', source: 'local', createdAt: 1 })
  fixture.roles.push(
    role('reader', ['knowledge.read']),
    role('publisher', ['knowledge.publish', 'files.read']),
  )
  fixture.userRoles.push({ userId: 'user_1', roleId: 'reader', createdAt: 1 })
  fixture.groupRoles.push({ groupId: 'research', roleId: 'publisher', createdAt: 1 })
  const service = new AuthorizationService({ repositories: fixture.repositories })

  const subject = await service.resolveSubject('user_1')
  assert.deepEqual(subject.groupIds, ['research'])
  assert.deepEqual(subject.roleIds, ['reader', 'publisher'])
  assert.deepEqual(
    [...subject.capabilities].sort(),
    ['files.read', 'knowledge.publish', 'knowledge.read'],
  )
  assert.equal((await service.checkCapability({
    userId: 'user_1',
    capability: 'knowledge.publish',
  })).allowed, true)
  assert.equal((await service.checkCapability({
    userId: 'user_1',
    capability: 'roles.manage',
  })).reason, 'capability_missing')
})

test('authorization evaluator honors deployment capability gates', async () => {
  const fixture = createFixture()
  fixture.roles.push(role('automation_user', ['automations.use']))
  fixture.userRoles.push({ userId: 'user_1', roleId: 'automation_user', createdAt: 1 })
  const service = new AuthorizationService({
    repositories: fixture.repositories,
    capabilityPolicy: createAuthorizationCapabilityPolicy({
      ...DEFAULT_OVERLAY_CAPABILITIES,
      automations: false,
    }),
  })

  const decision = await service.checkCapability({
    userId: 'user_1',
    capability: 'automations.use',
  })
  assert.equal(decision.allowed, false)
  assert.equal(decision.reason, 'capability_disabled')
})

test('resource authorization uses ownership and the strongest matching ACL', async () => {
  const fixture = createFixture()
  fixture.groups.push(group('research'))
  fixture.memberships.push({ groupId: 'research', userId: 'user_1', source: 'local', createdAt: 1 })
  fixture.roles.push(role('knowledge_user', ['knowledge.read', 'knowledge.edit', 'knowledge.delete']))
  fixture.userRoles.push({ userId: 'user_1', roleId: 'knowledge_user', createdAt: 1 })
  fixture.grants.push(
    grant('viewer', 'user', 'user_1', 'viewer'),
    grant('editor', 'group', 'research', 'editor'),
  )
  const service = new AuthorizationService({ repositories: fixture.repositories })

  const edit = await service.checkResourceAccess({
    userId: 'user_1',
    capability: 'knowledge.edit',
    resourceType: 'knowledge_base',
    resourceId: 'kb_1',
    action: 'edit',
  })
  assert.equal(edit.allowed, true)
  assert.equal(edit.effectiveAccessRole, 'editor')
  assert.equal(edit.reason, 'resource_access_granted')

  const remove = await service.checkResourceAccess({
    userId: 'user_1',
    capability: 'knowledge.delete',
    resourceType: 'knowledge_base',
    resourceId: 'kb_1',
    action: 'delete',
  })
  assert.equal(remove.allowed, false)
  assert.equal(remove.reason, 'resource_access_missing')

  const foreignUser = await service.checkResourceAccess({
    userId: 'user_2',
    capability: 'knowledge.edit',
    resourceType: 'knowledge_base',
    resourceId: 'kb_1',
    action: 'edit',
  })
  assert.equal(foreignUser.allowed, false)
  assert.equal(foreignUser.reason, 'capability_missing')

  const owner = await service.checkResourceAccess({
    userId: 'user_1',
    capability: 'knowledge.delete',
    resourceType: 'knowledge_base',
    resourceId: 'kb_owned',
    ownerUserId: 'user_1',
    action: 'delete',
  })
  assert.equal(owner.allowed, true)
  assert.equal(owner.reason, 'resource_owner')
})

test('resource authorization denies by default and deployment owner bypass is explicit', async () => {
  const fixture = createFixture()
  const service = new AuthorizationService({ repositories: fixture.repositories })
  await assert.rejects(
    service.assertResourceAccess({
      userId: 'user_1',
      capability: 'projects.read',
      resourceType: 'project',
      resourceId: 'project_1',
      action: 'view',
    }),
    AuthorizationDeniedError,
  )

  const ownerService = new AuthorizationService({
    repositories: fixture.repositories,
    isDeploymentOwner: (userId) => userId === 'deployment_owner',
  })
  const decision = await ownerService.checkResourceAccess({
    userId: 'deployment_owner',
    capability: 'roles.manage',
    resourceType: 'role',
    resourceId: 'role_1',
    action: 'delete',
  })
  assert.equal(decision.allowed, true)
  assert.equal(decision.reason, 'deployment_owner')
  assert.equal(decision.effectiveAccessRole, 'owner')
})

test('resource ownership is resolved server-side and granted lists exclude owned and stale resources', async () => {
  const fixture = createFixture()
  fixture.roles.push(role('reader', ['files.read']))
  fixture.userRoles.push({ userId: 'user_1', roleId: 'reader', createdAt: 1 })
  fixture.owners.set('file:shared', 'user_2')
  fixture.owners.set('file:owned', 'user_1')
  fixture.grants.push(
    grantForResource('grant_shared', 'shared', 'user', 'user_1', 'viewer'),
    grantForResource('grant_owned', 'owned', 'user', 'user_1', 'viewer'),
    grantForResource('grant_stale', 'stale', 'user', 'user_1', 'viewer'),
  )
  const service = new AuthorizationService({ repositories: fixture.repositories })
  const subject = await service.resolveSubject('user_1')

  assert.equal(await service.getResourceOwner({ resourceType: 'file', resourceId: 'shared' }), 'user_2')
  assert.deepEqual(await service.listAccessibleResources({
    action: 'view',
    resourceType: 'file',
    subject,
  }), [{ ownerUserId: 'user_2', resourceId: 'shared' }])
})

test('catalog resources stay open until an exact or wildcard policy is configured', async () => {
  const fixture = createFixture()
  fixture.roles.push(role('model_user', ['models.use']))
  fixture.userRoles.push({ userId: 'user_1', roleId: 'model_user', createdAt: 1 })
  const service = new AuthorizationService({ repositories: fixture.repositories })
  const subject = await service.resolveSubject('user_1')

  assert.equal((await service.checkResolvedCatalogResourceAccess({
    capability: 'models.use',
    resourceId: 'open-model',
    resourceType: 'model',
    subject,
  })).reason, 'resource_unrestricted')

  fixture.grants.push(catalogGrant('restricted', 'model', 'restricted-model', 'user', 'user_2'))
  assert.equal((await service.checkResolvedCatalogResourceAccess({
    capability: 'models.use',
    resourceId: 'restricted-model',
    resourceType: 'model',
    subject,
  })).allowed, false)

  fixture.grants.push(catalogGrant('wildcard', 'model', '*', 'role', 'model_user'))
  assert.deepEqual(await service.filterCatalogResourceIds({
    capability: 'models.use',
    resourceIds: ['open-model', 'restricted-model'],
    resourceType: 'model',
    subject,
  }), ['open-model', 'restricted-model'])
})

type Fixture = {
  grants: ResourceGrant[]
  groupRoles: GroupRoleAssignment[]
  groups: AuthorizationGroup[]
  memberships: GroupMembership[]
  owners: Map<string, string>
  repositories: AuthorizationRepositories
  roles: AuthorizationRole[]
  userRoles: UserRoleAssignment[]
}

function createFixture(): Fixture {
  const roles: AuthorizationRole[] = []
  const groups: AuthorizationGroup[] = []
  const memberships: GroupMembership[] = []
  const userRoles: UserRoleAssignment[] = []
  const groupRoles: GroupRoleAssignment[] = []
  const grants: ResourceGrant[] = []
  const owners = new Map<string, string>()
  return {
    roles,
    groups,
    memberships,
    userRoles,
    groupRoles,
    grants,
    owners,
    repositories: {
      roles: {
        async create() { throw new Error('not used') },
        async get(id) { return roles.find((value) => value.id === id) ?? null },
        async list() { return roles },
        async update() { throw new Error('not used') },
        async archive() { throw new Error('not used') },
      },
      groups: {
        async create() { throw new Error('not used') },
        async get(id) { return groups.find((value) => value.id === id) ?? null },
        async list() { return groups },
        async update() { throw new Error('not used') },
        async archive() { throw new Error('not used') },
        async addMember() { throw new Error('not used') },
        async removeMember() { throw new Error('not used') },
        async listMembers(groupId) { return memberships.filter((value) => value.groupId === groupId) },
        async listForUser(userId) {
          const ids = new Set(memberships.filter((value) => value.userId === userId).map(({ groupId }) => groupId))
          return groups.filter(({ id, archivedAt }) => ids.has(id) && !archivedAt)
        },
      },
      assignments: {
        async assignUser() { throw new Error('not used') },
        async revokeUser() { throw new Error('not used') },
        async listForUser(userId) { return userRoles.filter((value) => value.userId === userId) },
        async listUsersForRole(roleId) { return userRoles.filter((value) => value.roleId === roleId) },
        async assignGroup() { throw new Error('not used') },
        async revokeGroup() { throw new Error('not used') },
        async listForGroups(groupIds) {
          return groupRoles.filter((value) => groupIds.includes(value.groupId))
        },
        async listGroupsForRole(roleId) { return groupRoles.filter((value) => value.roleId === roleId) },
      },
      resourceGrants: {
        async upsert() { throw new Error('not used') },
        async remove() { throw new Error('not used') },
        async listForResource({ resourceType, resourceId }) {
          return grants.filter((value) => value.resourceType === resourceType && value.resourceId === resourceId)
        },
        async listForPrincipals({ userId, groupIds, roleIds, resourceType }) {
          return grants.filter((value) =>
            (!resourceType || value.resourceType === resourceType) && (
              (value.principalType === 'user' && value.principalId === userId) ||
              (value.principalType === 'group' && groupIds.includes(value.principalId)) ||
              (value.principalType === 'role' && roleIds.includes(value.principalId))
            ))
        },
      },
      resourceOwners: {
        async getOwner({ resourceType, resourceId }) {
          return owners.get(`${resourceType}:${resourceId}`) ?? null
        },
      },
    },
  }
}

function role(id: string, capabilities: AuthorizationRole['capabilities']): AuthorizationRole {
  return { id, name: id, capabilities, isSystem: false, createdAt: 1, updatedAt: 1 }
}

function group(id: string): AuthorizationGroup {
  return { id, name: id, source: 'local', createdAt: 1, updatedAt: 1 }
}

function grant(
  id: string,
  principalType: ResourceGrant['principalType'],
  principalId: string,
  accessRole: ResourceGrant['accessRole'],
): ResourceGrant {
  return {
    id,
    resourceType: 'knowledge_base',
    resourceId: 'kb_1',
    principalType,
    principalId,
    accessRole,
    createdAt: 1,
    updatedAt: 1,
  }
}

function grantForResource(
  id: string,
  resourceId: string,
  principalType: ResourceGrant['principalType'],
  principalId: string,
  accessRole: ResourceGrant['accessRole'],
): ResourceGrant {
  return { ...grant(id, principalType, principalId, accessRole), resourceType: 'file', resourceId }
}

function catalogGrant(
  id: string,
  resourceType: string,
  resourceId: string,
  principalType: ResourceGrant['principalType'],
  principalId: string,
): ResourceGrant {
  return {
    id,
    resourceType,
    resourceId,
    principalType,
    principalId,
    accessRole: 'viewer',
    createdAt: 1,
    updatedAt: 1,
  }
}
