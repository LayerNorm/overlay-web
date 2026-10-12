import assert from 'node:assert/strict'
import test from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { InlineNavChildren } from '@/components/layout/AppSidebarInlinePanels'
import { buildScopedPanelNav } from './scopedPanelNav'
import { chatScopeForView, resolveSidebarRouteState, scopePanelAction, type PanelCreateRules } from './appSidebarNav'

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

test('the scope rows and the open sub-rows render in order, with the sub-rows flush under their parent', () => {
  const built = nav('personal', 'all')
  const html = renderToStaticMarkup(
    <InlineNavChildren items={built.items} activeId={built.activeId} activeChildId={built.activeChildId} onSelect={() => undefined} />,
  )
  const order = ['Personal', 'All', 'Notes', 'Workspace'].map((label) => html.indexOf(`>${label}<`))
  assert.ok(order.every((index) => index >= 0), 'every row renders')
  assert.deepEqual([...order].sort((a, b) => a - b), order, 'in the order Personal, its sub-rows, Workspace')
  // What an expansion reveals lines up with the row that opened it: no left padding on the nested rows.
  assert.doesNotMatch(html, /\bpl-\d/)
  assert.doesNotMatch(html, /\bml-\d/)
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

test('chats take their scope from the subview, not from the remembered scope', () => {
  assert.equal(routeState('/app/chat', 'view=dms', 'personal').scope, 'workspace')
  assert.equal(routeState('/app/chat', '', 'workspace').scope, 'personal')
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

test('a workspace of one person lists the page rows on their own, with no scope rows', () => {
  const built = buildScopedPanelNav({
    scope: 'personal',
    sub: 'notes',
    subItems: { personal: FILE_ROWS, workspace: FILE_ROWS },
    pendingId: null,
    solo: true,
    onSelect: () => undefined,
  })
  assert.deepEqual(built.items.map((item) => item.id), ['personal:all', 'personal:notes'])
  assert.deepEqual(built.items.map((item) => item.label), ['All', 'Notes'])
  assert.equal(built.activeId, 'personal:notes')
  assert.ok(built.items.every((item) => !item.children), 'nothing is nested')
})

test('solo selections still report the Personal scope and the sub-row', () => {
  const calls: Array<[string, string | null]> = []
  const built = buildScopedPanelNav({
    scope: 'personal',
    sub: 'all',
    subItems: { personal: FILE_ROWS },
    pendingId: null,
    solo: true,
    onSelect: (scope, sub) => { calls.push([scope, sub]) },
  })
  built.onSelect('personal:notes')
  built.onSelect('personal')
  assert.deepEqual(calls, [['personal', 'notes'], ['personal', null]])
})

test('a solo page with no sub-rows gets one row named for the page', () => {
  const built = buildScopedPanelNav({
    scope: 'personal',
    sub: null,
    subItems: {},
    pendingId: null,
    solo: true,
    soloLabel: 'Agents',
    onSelect: () => undefined,
  })
  assert.deepEqual(built.items.map((item) => [item.id, item.label]), [['personal', 'Agents']])
  assert.equal(built.activeId, 'personal')
})
