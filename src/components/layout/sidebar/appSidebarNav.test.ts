import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveSidebarRouteState, SETTINGS_SECTION_ICONS, signOutToLanding } from './appSidebarNav'
import { agentHref, agentThreadHref } from '@/components/layout/sidebar-nav'
import { resolveWorkspaceSurface } from '@/shared/workspaces/routing'

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
