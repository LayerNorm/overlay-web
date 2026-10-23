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
  normalizeChatViewForScope,
  mergeHrefSearchParams,
  readWorkspaceRouteDescriptor,
  workspaceMetadataForHref,
  isWorkspaceManagementSettingsRoute,
  legacyWorkspaceScopeForRoute,
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
    '/w/acme-labs/workspace/chat?id=chat-1&view=workspace-chats',
  )
  assert.equal(
    resolveChatBasePath('/w/acme-labs/workspace/chat?id=chat_1'),
    '/w/acme-labs/workspace/chat?view=workspace-chats',
  )
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
    '/w/new-name/personal/agents/agent-1?tab=threads',
  )
  assert.equal(
    buildCanonicalWorkspaceRedirectLocation('/w/old-name/chat', '?view=channels&scope=personal', 'new-name'),
    '/w/new-name/personal/chat?view=personal',
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

test('chat path scope canonicalizes conflicting views and only known workspace routes resolve', () => {
  assert.equal(legacyWorkspaceScopeForRoute('chat', new URLSearchParams('scope=personal&view=dms')), 'personal')
  assert.equal(legacyWorkspaceScopeForRoute('chat', new URLSearchParams('view=dms')), 'workspace')
  assert.equal(legacyWorkspaceScopeForRoute('agents', new URLSearchParams('view=workspace')), 'workspace')
  assert.equal(normalizeChatViewForScope('personal', 'dms'), 'personal')
  assert.equal(normalizeChatViewForScope('workspace', 'personal'), 'workspace-chats')
  assert.equal(normalizeChatViewForScope('workspace', 'channels'), 'channels')
  assert.equal(
    parseWorkspaceHandleRoute('/w/layernorm/personal/chat', '?view=dms')?.canonicalSearch,
    'view=personal',
  )
  assert.equal(
    parseWorkspaceHandleRoute('/w/layernorm/workspace/chat', '?view=personal')?.canonicalSearch,
    'view=workspace-chats',
  )
  assert.equal(readWorkspaceRouteDescriptor('/app/w/Workspace_ID/personal/work')?.workspaceId, 'Workspace_ID')
  assert.equal(readWorkspaceRouteDescriptor('/app/settings')?.surface, 'settings')
  assert.equal(readWorkspaceRouteDescriptor('/app/profile'), null)
  assert.equal(readWorkspaceRouteDescriptor('/pricing'), null)
})

test('explicit workspace destinations override the current route and account settings stay global', () => {
  const workspaces = [
    { id: 'workspace-a', slug: 'team-a' },
    { id: 'workspace-b', slug: 'team-b' },
  ]
  assert.equal(workspaceMetadataForHref({
    workspaceId: 'workspace-a',
    routeTarget: { kind: 'handle', value: 'team-b' },
    workspaces,
    activeWorkspace: workspaces[1]!,
  })?.slug, 'team-a')
  const settings = readWorkspaceRouteDescriptor('/app/settings')
  assert.equal(isWorkspaceManagementSettingsRoute(settings, new URLSearchParams()), false)
  assert.equal(isWorkspaceManagementSettingsRoute(settings, new URLSearchParams('section=account')), false)
  assert.equal(isWorkspaceManagementSettingsRoute(settings, new URLSearchParams('section=workspace')), true)
})

test('switching workspaces keeps the scoped surface and drops previous-workspace selectors and details', () => {
  assert.equal(
    buildWorkspaceSwitchHref({
      workspaceId: 'workspace-b',
      handle: 'team-b',
      pathname: '/w/team-a/personal/agents/old-agent',
      search: '?agent=old-agent&agentId=old-agent&id=old-chat&threadId=old-thread&conversationId=old-chat&file=old-file&folder=old-folder&note=old-note&automationId=old-automation&taskId=old-task&outputId=old-output&toolId=old-tool&scope=workspace&sort=name',
      currentScope: 'workspace',
    }),
    '/w/team-b/personal/agents?sort=name',
  )
})

test('switching workspaces does not turn account settings into a workspace route', () => {
  assert.equal(
    buildWorkspaceSwitchHref({
      workspaceId: 'workspace-b',
      handle: null,
      pathname: '/app/settings',
      search: '?section=account&tab=security',
    }),
    '/app/settings?section=account&tab=security',
  )
})

test('workspace switching keeps the strict scope on a legacy-ID destination', () => {
  assert.equal(
    buildWorkspaceSwitchHref({
      workspaceId: 'workspace-b',
      pathname: '/w/team-a/workspace/agents/old-agent',
      search: '?agent=old-agent&sort=name',
    }),
    '/app/w/workspace-b/agents?sort=name&scope=workspace',
  )
})

test('workspace handle builders leave unknown and account-global routes unchanged', () => {
  assert.equal(buildWorkspaceHandleHref('team-a', '/app/unknown?view=all'), '/app/unknown?view=all')
  assert.equal(buildWorkspaceHandleHref('team-a', '/app/settings?section=account'), '/app/settings?section=account')
})

test('chat base path preserves the canonical workspace route', () => {
  assert.equal(resolveChatBasePath('/app/w/ws_1/chat'), '/app/w/ws_1/chat')
  assert.equal(resolveChatBasePath('/app/chat'), '/app/chat')
  assert.equal(resolveChatBasePath('/app/automations'), '/app/automations')
  assert.equal(isSameChatSurface('/app/w/ws_1/chat', '/app/w/ws_1/chat'), true)
  assert.equal(isSameChatSurface('/app/w/ws_1/chat', '/app/chat'), false)
})

test('merging route query parameters keeps one query and preserves the fragment', () => {
  assert.equal(
    mergeHrefSearchParams(
      '/w/team-a/workspace/chat?view=workspace-chats#latest',
      new URLSearchParams({ view: 'dms', id: 'conversation-1' }),
    ),
    '/w/team-a/workspace/chat?view=dms&id=conversation-1#latest',
  )
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
