import {
  AUTHORIZATION_PRINCIPAL_TYPES,
  RESOURCE_ACCESS_ROLES,
} from '@overlay/authz-contracts'
import {
  DEFAULT_OVERLAY_CAPABILITIES,
  DEFAULT_OVERLAY_FEATURE_FLAGS,
} from '@overlay/app-core'
import assert from 'node:assert/strict'
import test from 'node:test'
import { getAuthorizationRoutePolicy } from '@/server/authorization/authorization-route-policy'

const MULTIPLAYER_FLAGS = [
  'workspaces',
  'collaborativeChats',
  'channels',
  'agents',
  'resourceSharing',
] as const

test('Phase 0 keeps every multiplayer surface disabled', () => {
  assert.equal(DEFAULT_OVERLAY_CAPABILITIES.multiTenant, false)
  for (const id of MULTIPLAYER_FLAGS) {
    assert.deepEqual(
      DEFAULT_OVERLAY_FEATURE_FLAGS.find((flag) => flag.id === id)?.enabled,
      false,
    )
  }
})

test('Phase 0 records the existing public-link and resource-ACL boundaries', () => {
  assert.deepEqual(
    getAuthorizationRoutePolicy('PATCH', '/api/v1/conversations/share'),
    {
      access: 'resource',
      capabilities: ['conversations.share'],
      resource: { action: 'share', type: 'conversation' },
    },
  )
  assert.deepEqual(
    getAuthorizationRoutePolicy('PATCH', '/api/v1/files/share'),
    {
      access: 'resource',
      capabilities: ['files.share'],
      resource: { action: 'share', type: 'file' },
    },
  )
  for (const method of ['GET', 'POST', 'DELETE']) {
    assert.deepEqual(
      getAuthorizationRoutePolicy(
        method,
        '/api/v1/knowledge-bases/kb_1/grants',
      ),
      {
        access: 'resource',
        capabilities: ['knowledge.share'],
        resource: { action: 'share', type: 'knowledge_base' },
      },
    )
  }

  assert.deepEqual(
    getAuthorizationRoutePolicy('GET', '/api/v1/projects/share-directory'),
    {
      access: 'capability',
      capabilities: ['projects.share'],
    },
  )
  for (const method of ['GET', 'POST', 'DELETE']) {
    assert.deepEqual(
      getAuthorizationRoutePolicy(method, '/api/v1/projects/grants'),
      {
        access: 'resource',
        capabilities: ['projects.share'],
        resource: { action: 'share', type: 'project' },
      },
    )
  }
  assert.deepEqual(
    getAuthorizationRoutePolicy('POST', '/api/v1/automations/run'),
    {
      access: 'capability',
      capabilities: ['automations.use'],
    },
  )
})

test('Phase 0 records the authorization vocabulary that later workspace phases must expand', () => {
  assert.deepEqual(AUTHORIZATION_PRINCIPAL_TYPES, ['user', 'group', 'role'])
  assert.deepEqual(RESOURCE_ACCESS_ROLES, ['viewer', 'editor', 'owner'])
})
