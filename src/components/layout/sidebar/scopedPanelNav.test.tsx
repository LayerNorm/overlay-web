import assert from 'node:assert/strict'
import test from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { InlineNavChildren } from '@/components/layout/AppSidebarInlinePanels'
import { buildWorkspaceHandleHref } from '@/shared/workspaces/routing'
import { overlayAppClient } from '@/shared/app/overlay-app-client'
import { resolveSecondaryPanelNav } from './appSidebarPanelNav'
import { buildScopedPanelNav } from './scopedPanelNav'
import { chatScopeForView, resolveSidebarRouteState, scopePanelAction, type PanelCreateRules } from './appSidebarNav'
import { buildChatPanelNav, resolveRecentChatHref } from './chatPanelNav'
import { workInlineItems } from './workPanelNav'

;(globalThis as typeof globalThis & { React: typeof React }).React = React

const FILE_ROWS = [
  { id: 'all', label: 'All' },
  { id: 'notes', label: 'Notes' },
]

function nav(scope: 'personal' | 'workspace', sub: string | null, onSelect = () => undefined) {
  return buildScopedPanelNav({
    scope,
    sub,
    subItems: { personal: FILE_ROWS, workspace: FILE_ROWS },
    pendingId: null,
    onSelect,
  })
}

test('the selected scope opens its sub-rows beneath it, and the others stay closed', () => {
  const built = nav('workspace', 'notes')
  assert.deepEqual(built.items.map((item) => item.id), ['personal', 'workspace'])
  assert.equal(built.items[0]!.expanded, false)
  assert.equal(built.items[1]!.expanded, true)
  assert.deepEqual(built.items[1]!.children?.map((child) => child.id), ['workspace:all', 'workspace:notes'])
  assert.equal(built.activeId, 'workspace')
  assert.equal(built.activeChildId, 'workspace:notes')
})

test('there is no Archived row: archived items live in Settings', () => {
  const built = nav('personal', 'all')
  assert.ok(built.items.every((item) => item.id !== 'archived'))
})

test('selecting a scope row or a sub-row reports the scope and the sub-row', () => {
  const calls: Array<[string, string | null]> = []
  const built = nav('personal', 'all', (scope, sub) => { calls.push([scope, sub]) })
  built.onSelect('workspace')
  built.onSelect('workspace:notes')
  assert.deepEqual(calls, [['workspace', null], ['workspace', 'notes']])
})

test('the scope rows and the open sub-rows render in order, with the sub-rows nested under the guide line', () => {
  const built = nav('personal', 'all')
  const html = renderToStaticMarkup(
    <InlineNavChildren items={built.items} activeId={built.activeId} activeChildId={built.activeChildId} onSelect={() => undefined} />,
  )
  const order = ['Personal', 'All', 'Notes', 'Workspace'].map((label) => html.indexOf(`>${label}<`))
  assert.ok(order.every((index) => index >= 0), 'every row renders')
  assert.deepEqual([...order].sort((a, b) => a - b), order, 'in the order Personal, its sub-rows, Workspace')
  // What an expansion reveals nests inside the guide-line sub list (`SidebarMenuSub`), like an agent's threads.
  const subList = html.indexOf('data-slot="sidebar-menu-sub"')
  assert.ok(
    subList > html.indexOf('>Personal<') && subList < html.indexOf('>All<'),
    'the sub list opens under Personal and holds its sub-rows',
  )
  assert.match(html, /data-slot="sidebar-menu-sub"[^>]*border-l/)
})

test('a scope row shows an unread badge only while it is collapsed', () => {
  const collapsed = buildScopedPanelNav({
    scope: 'personal', sub: null, subItems: { workspace: FILE_ROWS }, pendingId: null, badges: { workspace: 3 }, onSelect: () => undefined,
  })
  assert.equal(collapsed.items[1]!.badgeCount, 3)
  const open = buildScopedPanelNav({
    scope: 'workspace', sub: 'all', subItems: { workspace: FILE_ROWS }, pendingId: null, badges: { workspace: 3 }, onSelect: () => undefined,
  })
  assert.equal(open.items[1]!.badgeCount, undefined)
})

test('chat subviews map onto the scopes', () => {
  assert.equal(chatScopeForView('personal'), 'personal')
  assert.equal(chatScopeForView('workspace-chats'), 'workspace')
  assert.equal(chatScopeForView('dms'), 'workspace')
  assert.equal(chatScopeForView('channels'), 'workspace')
  assert.equal(chatScopeForView('activity'), 'workspace')
})

function routeState(pathname: string, search: string, savedScope: 'personal' | 'workspace' | null = null) {
  return resolveSidebarRouteState({
    pathname,
    searchParams: new URLSearchParams(search),
    resolveWorkspaceSurface: () => null,
    automationsEnabled: true,
    savedScope,
  })
}

test('the URL scope wins, then the remembered one, then Personal', () => {
  assert.equal(routeState('/app/files', 'scope=workspace', 'personal').scope, 'workspace')
  assert.equal(routeState('/app/files', '', 'workspace').scope, 'workspace')
  assert.equal(routeState('/app/files', '').scope, 'personal')
  // The retired Archived scope (old links, or a value remembered before it went) falls back to Personal.
  assert.equal(routeState('/app/files', 'scope=archived').scope, 'personal')
})

test('old agent links that carried the tab as ?view= still open the right scope', () => {
  assert.equal(routeState('/app/agents', 'view=workspace').scope, 'workspace')
  assert.equal(routeState('/app/agents', 'view=archived').scope, 'personal')
  // `view` means something else on other pages (Files categories) and must not leak into the scope.
  assert.equal(routeState('/app/files', 'view=archived').scope, 'personal')
})

test('chat scope follows an explicit subview or path before remembered scope', () => {
  assert.equal(routeState('/app/chat', 'view=dms', 'personal').scope, 'workspace')
  assert.equal(routeState('/app/chat', '', 'workspace').scope, 'workspace')
  assert.equal(routeState('/w/team-a/personal/chat', 'scope=workspace&view=dms', 'workspace').scope, 'personal')
  assert.equal(routeState('/w/team-a/workspace/chat', 'scope=personal&view=personal', 'personal').scope, 'workspace')
  assert.equal(routeState('/app/activity', '', 'personal').scope, 'workspace')
})

const baseRules: PanelCreateRules = {
  canCreate: () => true,
  isManager: false,
  memberCanCreateChannels: true,
  memberCanCreateAgents: true,
}
const action = { label: 'New note', onClick: () => undefined }

test('New says where it lands in Workspace', () => {
  assert.equal(scopePanelAction({ action, panelKind: 'files', scope: 'personal', chatsView: 'personal', rules: baseRules }), action)
  assert.equal(
    scopePanelAction({ action, panelKind: 'files', scope: 'workspace', chatsView: 'personal', rules: baseRules })?.label,
    'New note in workspace',
  )
})

test('New is hidden in Workspace for a member whose admin restricted it, and shown to admins', () => {
  const restricted: PanelCreateRules = { ...baseRules, canCreate: () => false, memberCanCreateChannels: false, memberCanCreateAgents: false }
  for (const panelKind of ['files', 'notes', 'automations'] as const) {
    assert.equal(scopePanelAction({ action, panelKind, scope: 'workspace', chatsView: 'personal', rules: restricted }), null, panelKind)
  }
  assert.equal(scopePanelAction({ action, panelKind: 'agents', scope: 'workspace', chatsView: 'personal', rules: restricted }), null)
  assert.equal(scopePanelAction({ action, panelKind: 'chat', scope: 'workspace', chatsView: 'channels', rules: restricted }), null)
  // Direct messages stay open to everyone, and Personal is never restricted.
  assert.equal(scopePanelAction({ action, panelKind: 'chat', scope: 'workspace', chatsView: 'dms', rules: restricted }), action)
  assert.equal(scopePanelAction({ action, panelKind: 'files', scope: 'personal', chatsView: 'personal', rules: restricted }), action)
  assert.equal(
    scopePanelAction({ action, panelKind: 'agents', scope: 'workspace', chatsView: 'personal', rules: { ...restricted, isManager: true } }),
    action,
  )
})

test('a workspace of one person keeps both strict scope rows', () => {
  const built = buildScopedPanelNav({
    scope: 'personal',
    sub: 'notes',
    subItems: { personal: FILE_ROWS, workspace: FILE_ROWS },
    pendingId: null,
    onSelect: () => undefined,
  })
  assert.deepEqual(built.items.map((item) => item.id), ['personal', 'workspace'])
  assert.equal(built.activeId, 'personal')
  assert.deepEqual(built.items[0]!.children?.map((item) => item.id), ['personal:all', 'personal:notes'])
})

test('solo users can navigate to Workspace sub-rows without collapsing scope', () => {
  const calls: Array<[string, string | null]> = []
  const built = buildScopedPanelNav({
    scope: 'personal',
    sub: 'all',
    subItems: { personal: FILE_ROWS, workspace: FILE_ROWS },
    pendingId: null,
    onSelect: (scope, sub) => { calls.push([scope, sub]) },
  })
  built.onSelect('workspace:notes')
  assert.deepEqual(calls, [['workspace', 'notes']])
})

test('solo Workspace panel clicks build scoped destinations and Agent switches clear selectors', () => {
  const destinations: string[] = []
  const common = {
    publicShowcase: false,
    effectivePendingSecondaryNavId: null,
    totalUnread: 0,
    collaborationUnread: { dms: 0, channels: 0, total: 0 },
    shouldLoadCollaborationUnread: false,
    router: { push: (href: string) => destinations.push(href) },
    activeWorkspaceId: 'workspace-a',
    buildWorkspaceHref: (_id: string, href: string, scope?: 'personal' | 'workspace') =>
      buildWorkspaceHandleHref('team-a', href, scope),
    currentSearchParams: new URLSearchParams(),
    toolsItems: [],
    settingsSections: [],
    closeMobileDrawer: () => undefined,
    beginSecondaryNavigation: () => undefined,
    solo: true,
  }
  const routeState = {
    chatsView: 'personal',
    filesView: 'all',
    scope: 'personal' as const,
    toolsView: 'all',
    workView: 'list' as const,
    notesOpen: false,
    settingsSection: 'general',
  }
  const workNav = resolveSecondaryPanelNav({
    ...common,
    panelKind: 'work',
    routeState,
  })
  workNav?.onSelect('workspace:board')
  assert.deepEqual(destinations, ['/w/team-a/workspace/work?view=board'])

  const agentsNav = resolveSecondaryPanelNav({
    ...common,
    panelKind: 'agents',
    routeState,
    currentSearchParams: new URLSearchParams('agent=agent-a&agentId=agent-a&id=chat-a&conversationId=chat-a&threadId=thread-a&tab=threads'),
  })
  agentsNav?.onSelect('workspace')
  assert.equal(destinations[1], '/w/team-a/workspace/agents?tab=threads')
})

test('a solo page with no sub-rows retains both strict scope rows', () => {
  const built = buildScopedPanelNav({
    scope: 'personal',
    sub: null,
    subItems: {},
    pendingId: null,
    onSelect: () => undefined,
  })
  assert.deepEqual(built.items.map((item) => [item.id, item.label]), [
    ['personal', 'Personal'],
    ['workspace', 'Workspace'],
  ])
  assert.equal(built.activeId, 'personal')
})

test('solo Workspace AI chats stay under Workspace scope', async () => {
  const destinations: string[] = []
  const nav = buildChatPanelNav({
    publicShowcase: false,
    chatsView: 'personal',
    effectivePendingSecondaryNavId: null,
    chatUnreadBadges: {},
    router: { push: (href) => destinations.push(href) },
    activeWorkspaceId: 'workspace-a',
    buildWorkspaceHref: (_id, href, scope) => buildWorkspaceHandleHref('team-a', href, scope),
    closeMobileDrawer: () => undefined,
    beginSecondaryNavigation: () => undefined,
    solo: true,
  })

  const personal = nav.items.find((item) => item.id === 'personal')
  const workspace = nav.items.find((item) => item.id === 'workspace')
  assert.equal(personal?.children, undefined)
  assert.equal(workspace?.children, undefined)

  const workspaceNav = buildChatPanelNav({
    publicShowcase: false,
    chatsView: 'workspace-chats',
    effectivePendingSecondaryNavId: null,
    chatUnreadBadges: {},
    router: { push: () => undefined },
    activeWorkspaceId: 'workspace-a',
    buildWorkspaceHref: (_id, href, scope) => buildWorkspaceHandleHref('team-a', href, scope),
    closeMobileDrawer: () => undefined,
    beginSecondaryNavigation: () => undefined,
    solo: true,
  })
  assert.deepEqual(workspaceNav.items.find((item) => item.id === 'workspace')?.children?.map((item) => item.id), [
    'workspace:workspace-chats',
    'workspace:channels',
    'workspace:activity',
  ])

  await nav.onSelect('workspace')
  assert.deepEqual(destinations, ['/w/team-a/workspace/chat?view=workspace-chats'])
})

test('recent Workspace chats merge with the canonical route query', async (t) => {
  t.mock.method(overlayAppClient.conversations, 'getPage', async <T,>() => ({
    data: [{ _id: 'recent-chat', scope: 'workspace' }] as unknown as T[],
    hasMore: false,
  }))
  assert.equal(
    await resolveRecentChatHref('/w/team-a/workspace/chat?view=workspace-chats', 'workspace'),
    '/w/team-a/workspace/chat?view=workspace-chats&id=recent-chat',
  )
})

test('Work opens a nav-only panel with List, Board, and Timeline under the scope, and reads the view from the URL', () => {
  const state = routeState('/app/work', 'scope=workspace&view=board')
  assert.equal(state.workOpen, true)
  assert.equal(state.panelKind, 'work')
  assert.equal(state.scope, 'workspace')
  assert.equal(state.workView, 'board')
  // It is a navigation panel, not a resource list like Chats or Files.
  assert.equal(state.hasResourcePanel, false)
  assert.equal(state.showSecondaryPanel, true)

  // An unknown or missing view opens the List; the canonical workspace route is Work too.
  assert.equal(routeState('/app/work', 'view=gantt').workView, 'list')
  assert.equal(routeState('/app/work', '').workView, 'list')
  const canonical = resolveSidebarRouteState({
    pathname: '/app/w/ws_1/work',
    searchParams: new URLSearchParams('view=timeline'),
    resolveWorkspaceSurface: () => 'work',
    automationsEnabled: true,
  })
  assert.equal(canonical.panelKind, 'work')
  assert.equal(canonical.workView, 'timeline')
  // The Tools page's own `view` values do not leak into Work.
  assert.equal(routeState('/app/tools', 'view=board').workOpen, false)
})

test('the Work panel shows the three views under the selected scope and reports the choice', () => {
  const rows = workInlineItems
  assert.deepEqual(rows.map((row) => row.id), ['list', 'board', 'timeline'])
  assert.deepEqual(rows.map((row) => row.label), ['List', 'Board', 'Timeline'])
  const calls: Array<[string, string | null]> = []
  const built = buildScopedPanelNav({
    scope: 'workspace',
    sub: 'board',
    subItems: { personal: rows, workspace: rows },
    pendingId: null,
    onSelect: (scope, sub) => { calls.push([scope, sub]) },
  })
  assert.equal(built.activeChildId, 'workspace:board')
  assert.deepEqual(built.items[1]!.children?.map((child) => child.id), ['workspace:list', 'workspace:board', 'workspace:timeline'])
  built.onSelect('personal:timeline')
  assert.deepEqual(calls, [['personal', 'timeline']])
})

test('a workspace of one person keeps both Work scope tabs', () => {
  const built = buildScopedPanelNav({
    scope: 'personal',
    sub: 'timeline',
    subItems: { personal: workInlineItems, workspace: workInlineItems },
    pendingId: null,
    onSelect: () => undefined,
  })
  assert.deepEqual(built.items.map((item) => item.id), ['personal', 'workspace'])
  assert.equal(built.activeId, 'personal')
  assert.deepEqual(built.items[0]!.children?.map((item) => item.id), ['personal:list', 'personal:board', 'personal:timeline'])
})
