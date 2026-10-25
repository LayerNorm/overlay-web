import assert from 'node:assert/strict'
import test from 'node:test'
import { breadcrumbItems } from './AppBreadcrumbProvider'

test('settings uses a single unscoped Settings breadcrumb', () => {
  assert.deepEqual(
    breadcrumbItems({
      page: 'settings',
      scope: 'workspace',
      href: '/app/settings?scope=workspace',
      unscopedHref: '/app/settings',
    }),
    [{ label: 'Settings', href: '/app/settings' }],
  )
})

test('memories and archived use the Settings breadcrumb', () => {
  for (const page of ['memories', 'archived']) {
    assert.deepEqual(
      breadcrumbItems({
        page,
        scope: 'personal',
        href: `/app/${page}?scope=personal`,
        unscopedHref: '/app/settings',
      }),
      [{ label: 'Settings', href: '/app/settings' }],
    )
  }
})

test('chat with workspace scope keeps the Workspace breadcrumb', () => {
  assert.deepEqual(
    breadcrumbItems({
      page: 'chat',
      scope: 'workspace',
      href: '/app/chat?view=workspace-chats&scope=workspace',
      unscopedHref: '/app/settings',
    }),
    [
      { label: 'Workspace', href: '/app/chat?view=workspace-chats&scope=workspace' },
      { label: 'Chats', href: '/app/chat?view=workspace-chats&scope=workspace' },
    ],
  )
})

test('agents with personal scope keeps the Personal breadcrumb', () => {
  assert.deepEqual(
    breadcrumbItems({
      page: 'agents',
      scope: 'personal',
      href: '/app/agents?scope=personal',
      unscopedHref: '/app/settings',
    }),
    [
      { label: 'Personal', href: '/app/agents?scope=personal' },
      { label: 'Agents', href: '/app/agents?scope=personal' },
    ],
  )
})
