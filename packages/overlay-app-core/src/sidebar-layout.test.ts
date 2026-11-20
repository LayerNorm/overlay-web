import assert from 'node:assert/strict'
import { test } from 'node:test'
import { isSidebarPageIdList, moveSidebarPage, resolveSidebarLayout, sidebarLandingHref } from './sidebar-layout'

const ALL = ['work', 'agents', 'chat', 'files', 'extensions', 'automations']

test('an uncustomized sidebar keeps Files, Extensions and Automations under More', () => {
  assert.deepEqual(resolveSidebarLayout(ALL), { pinned: ['work', 'agents', 'chat'], more: ['files', 'extensions', 'automations'] })
})

test('a saved layout keeps its order, drops unavailable pages and places new ones by default', () => {
  const layout = resolveSidebarLayout(ALL, { pinned: ['agents', 'files', 'gone', 'agents'], more: ['chat', 'files'] })
  assert.deepEqual(layout, { pinned: ['agents', 'files', 'work'], more: ['chat', 'extensions', 'automations'] })
})

test('the sidebar never ends up empty', () => {
  assert.deepEqual(resolveSidebarLayout(['files', 'extensions']), { pinned: ['files'], more: ['extensions'] })
  const one = { pinned: ['work'], more: ['chat'] }
  assert.equal(moveSidebarPage(one, 'work', 'more', 0), one)
})

test('moving a page reorders within a list and across lists', () => {
  const layout = { pinned: ['work', 'agents', 'chat'], more: ['files'] }
  assert.deepEqual(moveSidebarPage(layout, 'chat', 'pinned', 0), { pinned: ['chat', 'work', 'agents'], more: ['files'] })
  assert.deepEqual(moveSidebarPage(layout, 'files', 'pinned', 99), { pinned: ['work', 'agents', 'chat', 'files'], more: [] })
  assert.deepEqual(moveSidebarPage(layout, 'agents', 'more', 0), { pinned: ['work', 'chat'], more: ['agents', 'files'] })
})

test('the app opens to the first pinned page that exists', () => {
  const navigation = [{ id: 'work', href: '/app/work' }, { id: 'agents', href: '/app/agents' }]
  assert.equal(sidebarLandingHref(navigation, ['agents', 'work'], '/app/work'), '/app/agents')
  assert.equal(sidebarLandingHref(navigation, ['gone', 'work'], '/app/work'), '/app/work')
  assert.equal(sidebarLandingHref(navigation, [], '/app/work'), '/app/work')
  assert.equal(sidebarLandingHref(navigation, undefined, '/app/work'), '/app/work')
})

test('page id lists are bounded and plain', () => {
  assert.equal(isSidebarPageIdList(['work', 'chat']), true)
  assert.equal(isSidebarPageIdList(['Work']), false)
  assert.equal(isSidebarPageIdList(['a/b']), false)
  assert.equal(isSidebarPageIdList(Array.from({ length: 25 }, () => 'work')), false)
  assert.equal(isSidebarPageIdList('work'), false)
})
