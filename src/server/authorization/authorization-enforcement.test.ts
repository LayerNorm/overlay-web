import assert from 'node:assert/strict'
import test from 'node:test'
import type {
  AuthorizationRepositories,
  AuthorizationRole,
  UserRoleAssignment,
} from '@overlay/authz-contracts'
import { AuthorizationService } from './AuthorizationService'
import {
  evaluateAuthorizationRoute,
  firstDeniedCapability,
  getAuthorizationEnforcementMode,
} from './authorization-enforcement'

test('route enforcement requires every declared capability', async () => {
  const authorization = createAuthorization(['conversations.edit', 'models.use'])
  const evaluation = await evaluateAuthorizationRoute({
    authorization,
    mode: 'enforce',
    policy: {
      access: 'resource',
      capabilities: ['conversations.edit', 'models.use'],
      resource: { action: 'edit', type: 'conversation' },
    },
    userId: 'user_1',
  })

  assert.equal(evaluation.allowed, true)
  assert.equal(evaluation.decisions.length, 2)
  assert.equal(evaluation.subject?.userId, 'user_1')
})

test('observe records missing capabilities while enforce denies them', async () => {
  const authorization = createAuthorization(['conversations.edit'])
  const policy = {
    access: 'capability' as const,
    capabilities: ['conversations.edit', 'models.use'] as const,
  }

  const observed = await evaluateAuthorizationRoute({
    authorization,
    mode: 'observe',
    policy,
    userId: 'user_1',
  })
  assert.equal(observed.allowed, true)
  assert.equal(firstDeniedCapability(observed)?.capability, 'models.use')

  const enforced = await evaluateAuthorizationRoute({
    authorization,
    mode: 'enforce',
    policy,
    userId: 'user_1',
  })
  assert.equal(enforced.allowed, false)
  assert.equal(firstDeniedCapability(enforced)?.reason, 'capability_missing')
})

test('deployment owners bypass route capability requirements explicitly', async () => {
  const authorization = createAuthorization([], true)
  const evaluation = await evaluateAuthorizationRoute({
    authorization,
    mode: 'enforce',
    policy: { access: 'capability', capabilities: ['roles.manage'] },
    userId: 'deployment_owner',
  })

  assert.equal(evaluation.allowed, true)
  assert.equal(evaluation.decisions[0]?.reason, 'deployment_owner')
})

test('enforcement mode defaults to observe and only accepts explicit enforce', () => {
  assert.equal(getAuthorizationEnforcementMode(undefined), 'observe')
  assert.equal(getAuthorizationEnforcementMode('invalid'), 'observe')
  assert.equal(getAuthorizationEnforcementMode(' ENFORCE '), 'enforce')
})

function createAuthorization(
  capabilities: AuthorizationRole['capabilities'],
  deploymentOwner = false,
): AuthorizationService {
  const role: AuthorizationRole = {
    id: 'role_1',
    name: 'Role',
    capabilities,
    isSystem: false,
    createdAt: 1,
    updatedAt: 1,
  }
  const assignment: UserRoleAssignment = {
    userId: 'user_1',
    roleId: role.id,
    createdAt: 1,
  }
  const repositories: AuthorizationRepositories = {
    roles: {
      async create() { throw new Error('not used') },
      async get(id) { return id === role.id ? role : null },
      async list() { return [role] },
      async update() { throw new Error('not used') },
      async archive() { throw new Error('not used') },
    },
    groups: {
      async create() { throw new Error('not used') },
      async get() { return null },
      async list() { return [] },
      async update() { throw new Error('not used') },
      async archive() { throw new Error('not used') },
      async addMember() { throw new Error('not used') },
      async removeMember() { throw new Error('not used') },
      async listMembers() { return [] },
      async listForUser() { return [] },
    },
    assignments: {
      async assignUser() { throw new Error('not used') },
      async revokeUser() { throw new Error('not used') },
      async listForUser(userId) { return userId === 'user_1' ? [assignment] : [] },
      async listUsersForRole() { return [] },
      async assignGroup() { throw new Error('not used') },
      async revokeGroup() { throw new Error('not used') },
      async listForGroups() { return [] },
      async listGroupsForRole() { return [] },
    },
    resourceGrants: {
      async upsert() { throw new Error('not used') },
      async remove() { throw new Error('not used') },
      async listForResource() { return [] },
      async listForPrincipals() { return [] },
    },
    resourceOwners: {
      async getOwner() { return null },
    },
  }
  return new AuthorizationService({
    repositories,
    isDeploymentOwner: (userId) => deploymentOwner && userId === 'deployment_owner',
  })
}
