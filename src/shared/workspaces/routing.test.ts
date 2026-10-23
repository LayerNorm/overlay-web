import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildWorkspaceHref,
  buildWorkspaceHandleHref,
  buildWorkspaceSwitchHref,
  isWorkspaceNavigationPending,
  isWorkspaceRouteTargetPending,
  buildCanonicalWorkspaceRedirectLocation,
  isSameChatSurface,
  parseWorkspaceHandleRoute,
  readWorkspaceIdFromPath,
  readWorkspaceRouteTarget,
  resolveChatBasePath,
  resolveWorkspaceSurface,
} from './routing'

test('workspace routing preserves the current canonical surface', () => {
  assert.equal(resolveWorkspaceSurface('/app/files'), 'files')
  assert.equal(resolveWorkspaceSurface('/app/w/ws_old/files'), 'files')
  assert.equal(buildWorkspaceHref('ws next', '/app/w/ws_old/files'), '/app/w/ws%20next/files')
})

test('Work is a workspace surface of its own', () => {
  assert.equal(resolveWorkspaceSurface('/app/work'), 'work')
  assert.equal(resolveWorkspaceSurface('/app/w/ws_1/work'), 'work')
  assert.equal(buildWorkspaceHref('ws_1', '/app/work'), '/app/w/ws_1/work')
})

test('workspace routing falls back to chat for unknown and non-app routes', () => {
  assert.equal(resolveWorkspaceSurface('/pricing'), 'chat')
  assert.equal(resolveWorkspaceSurface('/app/unknown'), 'chat')
  assert.equal(buildWorkspaceHref('personal', '/'), '/app/w/personal/chat')
})

test('workspace routing reads and safely decodes canonical workspace ids', () => {
  assert.equal(readWorkspaceIdFromPath('/app/w/acme%20labs/chat'), 'acme labs')
  assert.equal(readWorkspaceIdFromPath('/app/chat'), null)
  assert.equal(readWorkspaceIdFromPath('/app/w/%E0%A4%A/chat'), null)
})

test('shared route parser distinguishes legacy immutable ids from readable handles', () => {
  assert.deepEqual(readWorkspaceRouteTarget('/app/w/ws_1/agents/agent-1'), { kind: 'id', value: 'ws_1' })
  assert.deepEqual(readWorkspaceRouteTarget('/w/acme-labs/agents/agent-1'), { kind: 'handle', value: 'acme-labs' })
  assert.equal(resolveWorkspaceSurface('/w/acme-labs/agents/agent-1'), 'agents')
  assert.equal(
    buildWorkspaceHandleHref('acme-labs', '/w/acme-labs/workspace/agents/agent-1?tab=threads#recent'),
    '/w/acme-labs/workspace/agents/agent-1?tab=threads#recent',
  )
  assert.equal(
    buildWorkspaceHandleHref('acme-labs', '/w/acme-labs/personal/work?task=task-1#item', 'workspace'),
    '/w/acme-labs/workspace/work?task=task-1#item',
  )
  assert.equal(
    buildWorkspaceHandleHref('acme-labs', '/app/chat?id=chat-1', 'workspace'),
    '/w/acme-labs/workspace/chat?id=chat-1',
  )
  assert.equal(resolveChatBasePath('/w/acme-labs/workspace/chat?id=chat_1'), '/w/acme-labs/workspace/chat')
  assert.deepEqual(readWorkspaceRouteTarget('/w/personal-random/chat?id=chat_1'), { kind: 'handle', value: 'personal-random' })
  assert.equal(readWorkspaceRouteTarget('/w/acme--labs'), null)
  assert.equal(readWorkspaceRouteTarget('/w/acme%2Flabs'), null)
  assert.equal(readWorkspaceRouteTarget('/w/a'), null)
  assert.equal(readWorkspaceRouteTarget('/w/acme%252flabs'), null)
})

test('scoped handle paths default roots to Work and canonicalize legacy routes without losing safe URL state', () => {
  assert.equal(parseWorkspaceHandleRoute('/w/layernorm')?.canonicalPath, '/w/layernorm/personal/work')
  assert.equal(parseWorkspaceHandleRoute('/w/layernorm/workspace')?.canonicalPath, '/w/layernorm/workspace/work')
  assert.equal(
    buildCanonicalWorkspaceRedirectLocation('/w/old-name/agents/agent-1', '?view=workspace&scope=personal&tab=threads', 'new-name'),
    '/w/new-name/workspace/agents/agent-1?tab=threads',
  )
  assert.equal(
    buildCanonicalWorkspaceRedirectLocation('/w/old-name/chat', '?view=channels&scope=personal', 'new-name'),
    '/w/new-name/workspace/chat?view=channels',
  )
  assert.equal(
    buildWorkspaceHandleHref('layernorm', '/w/layernorm/personal/work?scope=workspace&task=task-1#item'),
    '/w/layernorm/personal/work?task=task-1#item',
  )
  assert.equal(parseWorkspaceHandleRoute('/w/layernorm/personal/activity'), null)
  assert.equal(parseWorkspaceHandleRoute('/w/layernorm/chat/extra'), null)
  assert.equal(parseWorkspaceHandleRoute('/w/layernorm/unknown'), null)
  assert.equal(parseWorkspaceHandleRoute('/w/layernorm/files%2Fother'), null)
})

test('switching workspaces keeps the scoped surface and drops previous-workspace selectors and details', () => {
  assert.equal(
    buildWorkspaceSwitchHref({
      workspaceId: 'workspace-b',
      handle: 'team-b',
      pathname: '/w/team-a/personal/files/old-file',
      search: '?file=old-file&folder=old-folder&note=old-note&scope=workspace&sort=name',
      currentScope: 'workspace',
    }),
    '/w/team-b/personal/files?sort=name',
  )
})

test('chat base path preserves the canonical workspace route', () => {
  assert.equal(resolveChatBasePath('/app/w/ws_1/chat'), '/app/w/ws_1/chat')
  assert.equal(resolveChatBasePath('/app/chat'), '/app/chat')
  assert.equal(resolveChatBasePath('/app/automations'), '/app/automations')
  assert.equal(isSameChatSurface('/app/w/ws_1/chat', '/app/w/ws_1/chat'), true)
  assert.equal(isSameChatSurface('/app/w/ws_1/chat', '/app/chat'), false)
})

test('handle targets gate scoped content until resolution and redirect aliases safely', () => {
  const target = readWorkspaceRouteTarget('/w/team-b/agents/agent_1')
  assert.equal(isWorkspaceRouteTargetPending(target, 'handle:team-a'), true)
  assert.equal(isWorkspaceRouteTargetPending(target, null), true)
  assert.equal(isWorkspaceRouteTargetPending(target, 'handle:team-b'), false)
  assert.equal(
    isWorkspaceRouteTargetPending(readWorkspaceRouteTarget('/w/team-b/chat'), 'handle:team-b'),
    false,
  )
  assert.equal(buildCanonicalWorkspaceRedirectLocation(
    '/w/old-team/agents/agent_1',
    '?tab=activity&x=1',
    'new-team',
  ), '/w/new-team/personal/agents/agent_1?tab=activity&x=1')
  assert.equal(buildCanonicalWorkspaceRedirectLocation('/w/old-team/agents/id/chat', '', 'new-team'), null)
})

test('workspace navigation resolves compatibility routes from active workspace state', () => {
  assert.equal(isWorkspaceNavigationPending({
    activeWorkspaceId: 'workspace-b',
    pendingWorkspaceId: 'workspace-b',
    routeWorkspaceId: null,
  }), false)
  assert.equal(isWorkspaceNavigationPending({
    activeWorkspaceId: 'workspace-a',
    pendingWorkspaceId: 'workspace-b',
    routeWorkspaceId: null,
  }), true)
  assert.equal(isWorkspaceNavigationPending({
    activeWorkspaceId: 'workspace-b',
    pendingWorkspaceId: 'workspace-b',
    routeWorkspaceId: 'workspace-a',
  }), true)
  assert.equal(isWorkspaceNavigationPending({
    activeWorkspaceId: 'workspace-b',
    pendingWorkspaceId: 'workspace-b',
    routeWorkspaceId: 'workspace-b',
  }), false)
})
