import assert from 'node:assert/strict'
import test from 'node:test'
import { parsePanelScope, resolvePanelScope, scopeForNewItem, withPanelScope } from './panel-scope'

test('the URL wins over the remembered scope, which wins over Personal', () => {
  assert.equal(resolvePanelScope({ param: 'archived', saved: 'workspace' }), 'archived')
  assert.equal(resolvePanelScope({ param: null, saved: 'workspace' }), 'workspace')
  assert.equal(resolvePanelScope({ param: 'nonsense', saved: 'workspace' }), 'workspace')
  assert.equal(resolvePanelScope({ param: undefined, saved: 'nonsense' }), 'personal')
  assert.equal(resolvePanelScope({ param: null }), 'personal')
})

test('only the three scopes parse', () => {
  assert.equal(parsePanelScope('personal'), 'personal')
  assert.equal(parsePanelScope('Workspace'), null)
  assert.equal(parsePanelScope(undefined), null)
})

test('a new item defaults to the scope being viewed, and Archived falls back to Personal', () => {
  assert.equal(scopeForNewItem('workspace'), 'workspace')
  assert.equal(scopeForNewItem('personal'), 'personal')
  assert.equal(scopeForNewItem('archived'), 'personal')
})

test('the scope parameter keeps other parameters and omits the default', () => {
  const base = new URLSearchParams('view=notes&file=abc')
  assert.equal(withPanelScope(base, 'workspace').toString(), 'view=notes&file=abc&scope=workspace')
  assert.equal(withPanelScope(new URLSearchParams('scope=workspace&view=notes'), 'personal').toString(), 'view=notes')
  assert.equal(base.toString(), 'view=notes&file=abc', 'the input is not changed')
})
