import assert from 'node:assert/strict'
import test from 'node:test'
import { groupSettingsItems } from './settingsSearch'

const items = [
  { id: 'general', label: 'General' },
  { id: 'customization', label: 'Customization' },
  { id: 'profile', label: 'Profile' },
  { id: 'workspace', label: 'Workspace' },
  { id: 'connected-apps', label: 'Connected apps' },
  { id: 'custom-plugin', label: 'Plugin' },
]

test('settings pages are grouped and unknown pages land in More', () => {
  const groups = groupSettingsItems(items)
  assert.deepEqual(groups.map((group) => group.label), ['Personal', 'Workspace', 'Integrations', 'More'])
  assert.deepEqual(groups[0]?.items.map((item) => item.id), ['general', 'customization'])
  assert.deepEqual(groups[1]?.items.map((item) => item.id), ['profile', 'workspace'])
})

test('settings search matches labels and the settings on each page', () => {
  assert.deepEqual(groupSettingsItems(items, 'avatar').flatMap((g) => g.items.map((i) => i.id)), ['profile'])
  assert.deepEqual(groupSettingsItems(items, 'dark mode').flatMap((g) => g.items.map((i) => i.id)), ['customization'])
  assert.deepEqual(groupSettingsItems(items, 'INVITE').flatMap((g) => g.items.map((i) => i.id)), ['workspace'])
  assert.deepEqual(groupSettingsItems(items, 'conn').flatMap((g) => g.items.map((i) => i.id)), ['connected-apps'])
  assert.deepEqual(groupSettingsItems(items, 'nothing here'), [])
})
