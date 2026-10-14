import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildWorkPanelNav } from './workPanelNav'

test('Work scope/view changes preserve view, drop open task, and retain workspace URL', () => {
  const routes: string[] = []
  const nav = buildWorkPanelNav({
    scope: 'personal',
    params: new URLSearchParams('view=timeline&id=private-task'),
    pendingId: null,
    solo: false,
    href: '/app/w/ws-1/work',
    push: (href) => routes.push(href),
    close: () => {},
    begin: () => {},
  })
  assert.deepEqual(
    nav.items.map((item) => item.label),
    ['Personal', 'Workspace'],
  )
  assert.deepEqual(
    nav.items[0].children?.map((item) => item.label),
    ['List', 'Board', 'Timeline'],
  )
  nav.onSelect('workspace')
  const url = new URL(routes[0], 'https://example.test')
  assert.equal(url.pathname, '/app/w/ws-1/work')
  assert.equal(url.searchParams.get('view'), 'timeline')
  assert.equal(url.searchParams.get('scope'), 'workspace')
  assert.equal(url.searchParams.has('id'), false)
})
test('Work retains Personal and Workspace in a solo workspace', () => {
  const nav = buildWorkPanelNav({
    scope: 'personal',
    params: new URLSearchParams('view=board'),
    pendingId: null,
    solo: true,
    href: '/app/work',
    push: () => {},
    close: () => {},
    begin: () => {},
  })
  assert.deepEqual(
    nav.items.map((item) => item.label),
    ['Personal', 'Workspace'],
  )
  assert.equal(nav.activeId, 'personal')
  assert.equal(nav.activeChildId, 'personal:board')
})

test('returning to Personal has an explicit scope so remembered Workspace cannot win during navigation', () => {
  let href = ''
  const nav = buildWorkPanelNav({
    scope: 'workspace',
    params: new URLSearchParams('scope=workspace&view=board&id=shared'),
    pendingId: null,
    solo: false,
    href: '/app/w/ws/work',
    push: (next) => {
      href = next
    },
    close: () => {},
    begin: () => {},
  })
  nav.onSelect('personal')
  const url = new URL(href, 'https://example.test')
  assert.equal(url.searchParams.get('scope'), 'personal')
  assert.equal(url.searchParams.get('view'), 'board')
  assert.equal(url.searchParams.has('id'), false)
})
