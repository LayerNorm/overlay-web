import assert from 'node:assert/strict'
import test from 'node:test'
import type { AuthorizationCapabilityDefinition, AuthorizationGroup, AuthorizationRole } from '@overlay/authz-contracts'
import { authorizationDescription, groupCapabilityDefinitions, groupIsEditable, roleIsEditable } from './authorization-ui'

test('groups capabilities without changing registry order', () => {
  const definitions: AuthorizationCapabilityDefinition[] = [
    { key: 'roles.read', category: 'identity', label: 'View roles' },
    { key: 'roles.manage', category: 'identity', label: 'Manage roles' },
    { key: 'audit.read', category: 'governance', label: 'View audit events' },
  ]
  assert.deepEqual(groupCapabilityDefinitions(definitions), [
    {
      category: 'identity',
      label: 'Identity',
      capabilities: definitions.slice(0, 2),
    },
    {
      category: 'governance',
      label: 'Governance',
      capabilities: definitions.slice(2),
    },
  ])
})

test('only active custom roles and local groups are editable', () => {
  const role = { id: 'role', isSystem: false } as AuthorizationRole
  const group = { id: 'group', source: 'local' } as AuthorizationGroup
  assert.equal(roleIsEditable(role), true)
  assert.equal(roleIsEditable({ ...role, isSystem: true }), false)
  assert.equal(roleIsEditable({ ...role, archivedAt: 1 }), false)
  assert.equal(groupIsEditable(group), true)
  assert.equal(groupIsEditable({ ...group, source: 'external' }), false)
  assert.equal(groupIsEditable({ ...group, archivedAt: 1 }), false)
})

test('normalizes optional descriptions', () => {
  assert.equal(authorizationDescription('  Curriculum editors  '), 'Curriculum editors')
  assert.equal(authorizationDescription('   '), undefined)
})
