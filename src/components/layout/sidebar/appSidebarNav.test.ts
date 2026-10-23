import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveSidebarRouteState, SETTINGS_SECTION_ICONS } from './appSidebarNav'
import { resolveWorkspaceSurface } from '@/shared/workspaces/routing'

test('every settings section has its own icon', () => {
  const sections = ['general', 'account', 'workspace', 'customization', 'shortcuts', 'memories', 'providers', 'models', 'webhooks', 'agent-environments', 'agent-accounts', 'connected-apps', 'computers', 'archived', 'contact']
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
