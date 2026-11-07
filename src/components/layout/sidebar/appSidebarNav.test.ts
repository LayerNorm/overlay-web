import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveNavItemDestination, resolveSidebarRouteState, selectMobileNavItem, selectSidebarNavItem, SETTINGS_SECTION_ICONS, signOutToLanding, type SidebarNavItem } from './appSidebarNav'
import { agentHref, agentThreadHref } from '@/components/layout/sidebar-nav'
import { resolveWorkspaceSurface } from '@/shared/workspaces/routing'
import { MessageSquare } from 'lucide-react'
import { selectDoubleSidebarItem } from '../../../../packages/overlay-shell-react/src/sidebar/DoubleSidebar'

test('Chats destinations always select a personal draft, including without a workspace', () => {
  for (const activeWorkspaceId of [null, 'team-a']) {
    const href = resolveNavItemDestination('/app/chat', {
      activeWorkspaceId,
      buildWorkspaceHref: (id, path) => `/app/w/${id}${path.slice(4)}`,
    })
    const url = new URL(href, 'https://overlay.invalid')
    assert.equal(url.searchParams.get('view'), 'personal')
    assert.equal(url.searchParams.get('scope'), 'personal')
    assert.equal(url.searchParams.has('id'), false)
  }
})

test('desktop and mobile Chats navigate directly without resolving saved conversations', () => {
  const item: SidebarNavItem = { id: 'chat', label: 'Chats', href: '/app/chat', icon: MessageSquare }
  for (const isActive of [false, true]) {
    for (const select of [selectSidebarNavItem, selectMobileNavItem]) {
      const destinations: string[] = []
      const navigate = () => select(item, {
        isGuestConfirmed: false,
        requireAuth: () => assert.fail('unexpected auth gate'),
        primaryNavActionByItemId: new Map(),
        runSidebarAction: async () => false,
        isActive: () => isActive,
        destination: (href) => resolveNavItemDestination(href, { activeWorkspaceId: null, buildWorkspaceHref: (_, path) => path }),
        pathname: '/app/chat?id=saved-conversation',
        router: { push: (href) => destinations.push(href) },
        setPendingNav: () => {},
        panelKind: 'chat',
        sidebarCollapsed: false,
        setSidebarCollapsed: () => {},
        automationsEnabled: false,
        openPanel: () => {},
        closeDrawer: () => {},
      })
      if (select === selectSidebarNavItem) {
        const collapsed: boolean[] = []
        selectDoubleSidebarItem({ ...item, active: isActive, onSelect: navigate }, false, (value) => collapsed.push(value))
        assert.deepEqual(collapsed, [false])
      } else navigate()
      assert.deepEqual(destinations, ['/app/chat?view=personal&scope=personal'])
    }
  }
})

test('sidebar sign-out stops native work before clearing the session and navigating', async () => {
  const events: string[] = []
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  const originalFetch = globalThis.fetch
  const location = { href: '/app/work' }
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {
    location,
    overlayDesktop: {
      handshake: async () => ({ capabilities: ['auth'] }),
      call: async (method: string) => { events.push(method) },
      on: () => () => {},
    },
  } })
  globalThis.fetch = async () => {
    events.push('session.signOut')
    assert.equal(location.href, '/app/work')
    return new Response(null, { status: 204 })
  }
  try {
    await signOutToLanding()
    assert.deepEqual(events, ['auth.signedOut', 'session.signOut'])
    assert.equal(location.href, '/')
  } finally {
    globalThis.fetch = originalFetch
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow)
    else Reflect.deleteProperty(globalThis, 'window')
  }
})

test('every settings section has its own icon', () => {
  const sections = ['general', 'profile', 'workspace', 'customization', 'shortcuts', 'memories', 'providers', 'models', 'webhooks', 'agent-environments', 'agent-accounts', 'connected-apps', 'computers', 'archived', 'contact']
  const icons = sections.map((id) => SETTINGS_SECTION_ICONS[id])
  assert.ok(icons.every(Boolean), 'each section is mapped (a missing one falls back to the General icon)')
  assert.equal(new Set(icons).size, icons.length, 'no two sections share an icon')
})

test('canonical chat path scope defeats legacy scope, view, and remembered scope', () => {
  const personal = resolveSidebarRouteState({
    pathname: '/w/team/personal/chat',
    searchParams: new URLSearchParams('scope=workspace&view=dms'),
    resolveWorkspaceSurface,
    automationsEnabled: true,
    savedScope: 'workspace',
  })
  assert.equal(personal.scope, 'personal')
  assert.equal(personal.chatsView, 'personal')

  const workspace = resolveSidebarRouteState({
    pathname: '/w/team/workspace/chat',
    searchParams: new URLSearchParams('scope=personal&view=dms'),
    resolveWorkspaceSurface,
    automationsEnabled: true,
    savedScope: 'personal',
  })
  assert.equal(workspace.scope, 'workspace')
  assert.equal(workspace.chatsView, 'dms')
})

test('legacy chat scope query defeats a conflicting view and remembered scope', () => {
  const workspace = resolveSidebarRouteState({
    pathname: '/app/chat',
    searchParams: new URLSearchParams('scope=workspace&view=personal'),
    resolveWorkspaceSurface,
    automationsEnabled: true,
    savedScope: 'personal',
  })
  assert.equal(workspace.scope, 'workspace')
  assert.equal(workspace.chatsView, 'workspace-chats')

  const personal = resolveSidebarRouteState({
    pathname: '/app/chat',
    searchParams: new URLSearchParams('scope=personal&view=dms'),
    resolveWorkspaceSurface,
    automationsEnabled: true,
    savedScope: 'workspace',
  })
  assert.equal(personal.scope, 'personal')
  assert.equal(personal.chatsView, 'personal')
})

test('agent links encode the selected path scope and merge legacy ID queries', () => {
  assert.equal(
    agentHref('/w/team/workspace/agents?scope=workspace', 'agent-1', 'workspace'),
    '/w/team/workspace/agents?agent=agent-1',
  )
  assert.equal(
    agentThreadHref('/w/team/workspace/agents', 'agent-1', 'thread-1', 'personal'),
    '/w/team/personal/agents?agent=agent-1&id=thread-1',
  )
  assert.equal(
    agentHref('/app/w/ws_1/agents?scope=workspace', 'agent-1', 'personal'),
    '/app/w/ws_1/agents?scope=personal&agent=agent-1',
  )
})
