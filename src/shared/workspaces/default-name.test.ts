import assert from 'node:assert/strict'
import test from 'node:test'
import { defaultWorkspaceName, isGenericWorkspaceName, isStartingWorkspaceName } from './default-name'

test('a first workspace is named after its owner, never "Personal"', () => {
  assert.equal(defaultWorkspaceName({ displayName: 'Divyansh Lalwani' }), 'Divyansh’s workspace')
  assert.equal(defaultWorkspaceName({ displayName: 'maya chen' }), 'Maya’s workspace')
  assert.equal(defaultWorkspaceName({ displayName: 'Personal', email: 'sam.ortiz@example.com' }), 'Sam’s workspace')
  assert.equal(defaultWorkspaceName({ displayName: 'sam@example.com' }), 'Sam’s workspace')
  assert.equal(defaultWorkspaceName({}), 'My workspace')
  assert.equal(defaultWorkspaceName({ displayName: '  ', email: '' }), 'My workspace')
})

test('the stand-in names early versions gave are recognised, real names are not', () => {
  for (const name of ['Personal', 'personal', 'Personal’s workspace', "Personal's workspace", ' Personal ']) {
    assert.equal(isGenericWorkspaceName(name), true, name)
  }
  for (const name of ['Divyansh’s workspace', 'Acme', 'Personal projects', 'My workspace']) {
    assert.equal(isGenericWorkspaceName(name), false, name)
  }
})

test('only a generated name counts as a starting name, so renaming is asked once', () => {
  for (const name of ['Maya’s workspace', 'My workspace', 'Personal', 'Sam\'s workspace']) assert.equal(isStartingWorkspaceName(name), true, name)
  for (const name of ['Acme', 'Maya and Sam’s workspace', 'Design team']) assert.equal(isStartingWorkspaceName(name), false, name)
})
