import assert from 'node:assert/strict'
import test from 'node:test'
import { SETTINGS_SECTION_ICONS } from './appSidebarNav'

test('every settings section has its own icon', () => {
  const sections = ['general', 'account', 'workspace', 'customization', 'shortcuts', 'memories', 'providers', 'models', 'webhooks', 'agent-environments', 'agent-accounts', 'connected-apps', 'computers', 'contact']
  const icons = sections.map((id) => SETTINGS_SECTION_ICONS[id])
  assert.ok(icons.every(Boolean), 'each section is mapped (a missing one falls back to the General icon)')
  assert.equal(new Set(icons).size, icons.length, 'no two sections share an icon')
})
