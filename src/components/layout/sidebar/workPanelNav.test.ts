import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildWorkPanelNav } from './workPanelNav'

test('Work scope/view changes preserve view, drop open task, and retain workspace URL', () => {
  const routes: string[] = []
  const nav = buildWorkPanelNav({ scope: 'personal', params: new URLSearchParams('view=timeline&id=private-task'), pendingId: null, solo: false, href: '/app/w/ws-1/work', push: (href) => routes.push(href), close: () => {}, begin: () => {} })
  assert.deepEqual(nav.items.map((item) => item.label), ['Personal', 'Workspace'])
  assert.deepEqual(nav.items[0].children?.map((item) => item.label), ['List', 'Board', 'Timeline'])
  nav.onSelect('workspace')
  const url = new URL(routes[0], 'https://example.test')
  assert.equal(url.pathname, '/app/w/ws-1/work')
  assert.equal(url.searchParams.get('view'), 'timeline')
  assert.equal(url.searchParams.get('scope'), 'workspace')
  assert.equal(url.searchParams.has('id'), false)
})
test('solo workspace uses the existing flat panel convention', () => {
  const nav = buildWorkPanelNav({ scope: 'personal', params: new URLSearchParams('view=board'), pendingId: null, solo: true, href: '/app/work', push: () => {}, close: () => {}, begin: () => {} })
  assert.deepEqual(nav.items.map((item) => item.label), ['List', 'Board', 'Timeline'])
  assert.equal(nav.activeId, 'personal:board')
})
