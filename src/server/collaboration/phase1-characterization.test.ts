import assert from 'node:assert/strict'
import test from 'node:test'
import { overlayAppShell, overlayRuntimeConfigDefaults } from '@/overlay.config'
import { DEFAULT_OVERLAY_FEATURE_FLAGS } from '@overlay/app-core'
import type { WorkspaceResourceScope } from '@overlay/workspace-contracts'
import { getAuthorizationRoutePolicy } from '@/server/authorization/authorization-route-policy'

test('workspace foundation remains enabled as collaborative chats roll forward', () => {
  const defaultFlags = new Map(
    DEFAULT_OVERLAY_FEATURE_FLAGS.map((flag) => [flag.id, flag.enabled]),
  )
  const appFlags = new Map(
    overlayAppShell.featureFlags.map((flag) => [flag.id, flag.enabled]),
  )
  assert.equal(defaultFlags.get('workspaces'), false)
  assert.equal(appFlags.get('workspaces'), true)
  assert.equal(appFlags.get('collaborativeChats'), true)
  assert.equal(appFlags.get('channels'), true)
  assert.equal(appFlags.get('agents'), false)
  assert.equal(appFlags.get('resourceSharing'), false)
  assert.equal(overlayRuntimeConfigDefaults.capabilities.multiTenant, false)
})

test('Phase 1 exposes explicit policies for every workspace mutation boundary', () => {
  for (const [method, path] of [
    ['POST', '/api/v1/workspaces'],
    ['POST', '/api/v1/workspaces/active'],
    ['POST', '/api/v1/workspaces/:workspaceId/invitations'],
    ['PATCH', '/api/v1/workspaces/:workspaceId/members'],
    ['DELETE', '/api/v1/workspaces/:workspaceId/members'],
    ['POST', '/api/v1/workspaces/:workspaceId/teams'],
    ['POST', '/api/v1/workspaces/:workspaceId/teams/:teamId/members'],
    ['DELETE', '/api/v1/workspaces/:workspaceId/lifecycle'],
    ['POST', '/api/v1/workspace-invitations/:invitationId/accept'],
  ] as const) {
    assert.ok(getAuthorizationRoutePolicy(method, path), `${method} ${path}`)
  }
})

test('Phase 1 resource ownership is a provider-neutral, workspace-scoped contract', () => {
  const scope: WorkspaceResourceScope = {
    workspaceId: 'workspace_1',
    resourceType: 'conversation',
    resourceId: 'conversation_1',
    createdAt: 1,
    updatedAt: 1,
  }
  assert.deepEqual(
    [scope.resourceType, scope.resourceId, scope.workspaceId],
    ['conversation', 'conversation_1', 'workspace_1'],
  )
})
