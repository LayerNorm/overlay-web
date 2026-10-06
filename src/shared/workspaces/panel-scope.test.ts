import assert from 'node:assert/strict'
import test from 'node:test'
import { isLegacyArchivedScope, listViewForScope, parsePanelScope, resolvePanelScope, scopeForNewItem, withPanelScope } from './panel-scope'

test('the URL wins over the remembered scope, which wins over Personal', () => {
  assert.equal(resolvePanelScope({ param: 'workspace', saved: 'personal' }), 'workspace')
  // Archived is no longer a scope: it is ignored, and the remembered one applies.
  assert.equal(resolvePanelScope({ param: 'archived', saved: 'workspace' }), 'workspace')
  assert.equal(resolvePanelScope({ param: null, saved: 'workspace' }), 'workspace')
  assert.equal(resolvePanelScope({ param: 'nonsense', saved: 'workspace' }), 'workspace')
  assert.equal(resolvePanelScope({ param: undefined, saved: 'nonsense' }), 'personal')
  assert.equal(resolvePanelScope({ param: null }), 'personal')
})

test('only the two scopes parse', () => {
  assert.equal(parsePanelScope('personal'), 'personal')
  assert.equal(parsePanelScope('Workspace'), null)
  assert.equal(parsePanelScope(undefined), null)
  assert.equal(parsePanelScope('archived'), null)
  assert.equal(isLegacyArchivedScope('archived'), true)
  assert.equal(isLegacyArchivedScope('workspace'), false)
})

test('a new item defaults to the scope being viewed', () => {
  assert.equal(scopeForNewItem('workspace'), 'workspace')
  assert.equal(scopeForNewItem('personal'), 'personal')
})

test('the scope parameter keeps other parameters and omits the default', () => {
  const base = new URLSearchParams('view=notes&file=abc')
  assert.equal(withPanelScope(base, 'workspace').toString(), 'view=notes&file=abc&scope=workspace')
  assert.equal(withPanelScope(new URLSearchParams('scope=workspace&view=notes'), 'personal').toString(), 'view=notes')
  assert.equal(base.toString(), 'view=notes&file=abc', 'the input is not changed')
})

test('a workspace of one person has no Workspace scope, and its lists ask for everything active', () => {
  assert.equal(resolvePanelScope({ param: 'workspace', solo: true }), 'personal')
  assert.equal(resolvePanelScope({ param: null, saved: 'workspace', solo: true }), 'personal')
  assert.equal(resolvePanelScope({ param: 'workspace' }), 'workspace')
  assert.equal(listViewForScope('personal', true), undefined)
  assert.equal(listViewForScope('personal', false), 'personal')
  assert.equal(listViewForScope('workspace', false), 'workspace')
})
