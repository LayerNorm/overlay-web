import assert from 'node:assert/strict'
import test from 'node:test'
import type {
  AuthorizationRepositories,
  AuthorizationRole,
  UserRoleAssignment,
} from '@overlay/authz-contracts'
import {
  FixedRoleAuthorizationBridge,
  MEMBER_AUTHORIZATION_CAPABILITIES,
  MEMBER_AUTHORIZATION_ROLE_ID,
} from './FixedRoleAuthorizationBridge'

test('default member provisioning is idempotent and preserves baseline product access', async () => {
  const roles = new Map<string, AuthorizationRole>()
  const assignments = new Map<string, UserRoleAssignment>()
  const bridge = new FixedRoleAuthorizationBridge(createRepositories(roles, assignments))

  await bridge.ensureDefaultUserRole('user_1')
  await bridge.ensureDefaultUserRole('user_1')

  assert.deepEqual(roles.get(MEMBER_AUTHORIZATION_ROLE_ID)?.capabilities, MEMBER_AUTHORIZATION_CAPABILITIES)
  assert.equal(assignments.size, 1)
  assert.equal(assignments.get(`user_1:${MEMBER_AUTHORIZATION_ROLE_ID}`)?.roleId, MEMBER_AUTHORIZATION_ROLE_ID)
})

test('migration provisions every unique existing user and administrative compatibility roles', async () => {
  const roles = new Map<string, AuthorizationRole>()
  const assignments = new Map<string, UserRoleAssignment>()
  const bridge = new FixedRoleAuthorizationBridge(createRepositories(roles, assignments))

  const count = await bridge.migrateUsers(['user_1', 'user_2', 'user_1'])
  await bridge.migrate([{
    userId: 'admin_1',
    role: 'admin',
    createdAt: 1,
    updatedAt: 1,
  }])

  assert.equal(count, 2)
  assert.ok(assignments.has(`user_1:${MEMBER_AUTHORIZATION_ROLE_ID}`))
  assert.ok(assignments.has(`user_2:${MEMBER_AUTHORIZATION_ROLE_ID}`))
  assert.ok(assignments.has(`admin_1:${MEMBER_AUTHORIZATION_ROLE_ID}`))
  assert.ok(assignments.has('admin_1:system:administrator'))
})

test('custom assignments suppress the default member role so capabilities can be restricted', async () => {
  const roles = new Map<string, AuthorizationRole>()
  const assignments = new Map<string, UserRoleAssignment>()
  const repositories = createRepositories(roles, assignments)
  await repositories.roles.create({
    id: 'role_restricted',
    name: 'Restricted',
    capabilities: ['conversations.read'],
  })
  await repositories.assignments.assignUser({ userId: 'user_1', roleId: 'role_restricted' })

  await new FixedRoleAuthorizationBridge(repositories).ensureDefaultUserRole('user_1')

  assert.deepEqual(
    (await repositories.assignments.listForUser('user_1')).map(({ roleId }) => roleId),
    ['role_restricted'],
  )
})

test('compatibility roles do not suppress baseline member provisioning', async () => {
  const roles = new Map<string, AuthorizationRole>()
  const assignments = new Map<string, UserRoleAssignment>()
  const repositories = createRepositories(roles, assignments)
  const bridge = new FixedRoleAuthorizationBridge(repositories)
  await bridge.ensureSystemRoles()
  await repositories.assignments.assignUser({ userId: 'user_1', roleId: 'system:administrator' })

  await bridge.ensureDefaultUserRole('user_1')
  await bridge.revokePrincipal('user_1')

  assert.deepEqual(
    (await repositories.assignments.listForUser('user_1')).map(({ roleId }) => roleId),
    [MEMBER_AUTHORIZATION_ROLE_ID],
  )
})

function createRepositories(
  roles: Map<string, AuthorizationRole>,
  assignments: Map<string, UserRoleAssignment>,
): AuthorizationRepositories {
  return {
    roles: {
      async create(input) {
        if (roles.has(input.id)) throw new Error('duplicate role')
        const now = Date.now()
        const role = { ...input, description: input.description, isSystem: input.isSystem ?? false, createdAt: now, updatedAt: now }
        roles.set(role.id, role)
        return role
      },
      async get(id) { return roles.get(id) ?? null },
      async list() { return [...roles.values()] },
      async update(input) {
        const current = roles.get(input.id)
        if (!current) return null
        const role = { ...current, ...input, updatedAt: Date.now() }
        roles.set(role.id, role)
        return role
      },
      async archive() { return false },
    },
    groups: {
      async create() { throw new Error('not used') },
      async get() { return null },
      async list() { return [] },
      async update() { throw new Error('not used') },
      async archive() { return false },
      async addMember() { throw new Error('not used') },
      async removeMember() { return false },
      async listMembers() { return [] },
      async listForUser() { return [] },
    },
    assignments: {
      async assignUser(input) {
        const assignment = { ...input, createdAt: Date.now() }
        assignments.set(`${input.userId}:${input.roleId}`, assignment)
        return assignment
      },
      async revokeUser(input) { return assignments.delete(`${input.userId}:${input.roleId}`) },
      async listForUser(userId) { return [...assignments.values()].filter((row) => row.userId === userId) },
      async listUsersForRole(roleId) { return [...assignments.values()].filter((row) => row.roleId === roleId) },
      async assignGroup() { throw new Error('not used') },
      async revokeGroup() { return false },
      async listForGroups() { return [] },
      async listGroupsForRole() { return [] },
    },
    resourceGrants: {
      async upsert() { throw new Error('not used') },
      async remove() { return false },
      async listForResource() { return [] },
      async listForPrincipals() { return [] },
    },
    resourceOwners: { async getOwner() { return null } },
  }
}
