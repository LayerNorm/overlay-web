import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  AUTHORIZATION_CAPABILITIES,
  AUTHORIZATION_CAPABILITY_DEFINITIONS,
  accessRoleAllows,
  getAuthorizationCapabilityDefinition,
  isAuthorizationCapability,
  strongestAccessRole,
  type AuthorizationRole,
  type RoleRepository,
} from './index'

describe('@overlay/authz-contracts', () => {
  it('exposes a unique, industry-neutral capability registry', () => {
    assert.equal(new Set(AUTHORIZATION_CAPABILITIES).size, AUTHORIZATION_CAPABILITIES.length)
    assert.equal(AUTHORIZATION_CAPABILITIES.every(isAuthorizationCapability), true)
    assert.equal(isAuthorizationCapability('curriculum.manage'), false)
    assert.equal(isAuthorizationCapability('unknown.permission'), false)
    assert.equal(
      AUTHORIZATION_CAPABILITY_DEFINITIONS.some(({ key }) => key === 'knowledge.publish'),
      true,
    )
    assert.equal(getAuthorizationCapabilityDefinition('roles.manage').category, 'identity')
  })

  it('uses stable viewer, editor, and owner resource semantics', () => {
    assert.equal(accessRoleAllows('viewer', 'view'), true)
    assert.equal(accessRoleAllows('viewer', 'edit'), false)
    assert.equal(accessRoleAllows('editor', 'edit'), true)
    assert.equal(accessRoleAllows('editor', 'share'), false)
    assert.equal(accessRoleAllows('owner', 'delete'), true)
    assert.equal(strongestAccessRole(['viewer', 'owner', 'editor']), 'owner')
    assert.equal(strongestAccessRole([]), undefined)
  })

  it('allows administrators to define arbitrary role names over registered capabilities', async () => {
    const roles = new Map<string, AuthorizationRole>()
    const repository: RoleRepository = {
      async archive({ id }) {
        const role = roles.get(id)
        if (!role) return false
        roles.set(id, { ...role, archivedAt: Date.now(), updatedAt: Date.now() })
        return true
      },
      async create(input) {
        const now = Date.now()
        const role: AuthorizationRole = {
          ...input,
          isSystem: input.isSystem ?? false,
          createdAt: now,
          updatedAt: now,
        }
        roles.set(role.id, role)
        return role
      },
      async get(id) {
        return roles.get(id) ?? null
      },
      async list() {
        return [...roles.values()]
      },
      async update(input) {
        const role = roles.get(input.id)
        if (!role) return null
        const updated = { ...role, ...input, updatedAt: Date.now() }
        roles.set(input.id, updated)
        return updated
      },
    }

    const role = await repository.create({
      id: 'role_custom',
      name: 'Any organization-defined role',
      capabilities: ['knowledge.read', 'models.use'],
    })
    assert.equal(role.name, 'Any organization-defined role')
    assert.deepEqual(role.capabilities, ['knowledge.read', 'models.use'])
  })
})
