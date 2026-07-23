import assert from 'node:assert/strict'
import test from 'node:test'
import type { AppAuthorizationState } from '@overlay/app-core'
import {
  allowsClientRequirement,
  getAppRouteAuthorizationRequirement,
  getNavigationAuthorizationRequirement,
  getSettingsSectionAuthorizationRequirement,
  getSidebarActionAuthorizationRequirement,
  satisfiesAuthorizationRequirement,
} from './client-policy'

test('navigation and route requirements map to product capabilities', () => {
  assert.deepEqual(getNavigationAuthorizationRequirement('files'), {
    any: ['files.read', 'notes.read', 'outputs.read'],
  })
  assert.deepEqual(getAppRouteAuthorizationRequirement('/app/projects/project_1'), {
    all: ['projects.read'],
  })
  assert.equal(getAppRouteAuthorizationRequirement('/app/settings'), null)
  assert.deepEqual(getSidebarActionAuthorizationRequirement('projects.create'), {
    all: ['projects.create'],
  })
  assert.deepEqual(getSettingsSectionAuthorizationRequirement('webhooks'), {
    all: ['webhooks.manage'],
  })
})

test('strict checks support all, any, and deployment-owner access', () => {
  const authorization = state(['files.read'])
  assert.equal(satisfiesAuthorizationRequirement(authorization, { all: ['files.read'] }), true)
  assert.equal(satisfiesAuthorizationRequirement(authorization, { all: ['files.read', 'files.edit'] }), false)
  assert.equal(satisfiesAuthorizationRequirement(authorization, { any: ['notes.read', 'files.read'] }), true)
  assert.equal(satisfiesAuthorizationRequirement({ ...authorization, isDeploymentOwner: true }, { all: ['roles.manage'] }), true)
})

test('observe keeps product UI available while enforce applies requirements', () => {
  const requirement = { all: ['projects.read'] as const }
  assert.equal(allowsClientRequirement(state([], 'observe'), requirement), true)
  assert.equal(allowsClientRequirement(state([], 'enforce'), requirement), false)
})

function state(
  capabilities: AppAuthorizationState['capabilities'],
  enforcementMode: AppAuthorizationState['enforcementMode'] = 'enforce',
): AppAuthorizationState {
  return {
    userId: 'user_1',
    capabilities,
    enforcementMode,
    groupIds: [],
    roleIds: [],
    isDeploymentOwner: false,
  }
}
