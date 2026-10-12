import assert from 'node:assert/strict'
import test from 'node:test'
import { chunkVisibleToSearch, workspaceOnlySourceKinds } from './chunk-visibility'

const mine = { userId: 'alice', visibility: 'owner' as const }
const theirs = { userId: 'bob', visibility: 'owner' as const }
const shared = { userId: 'bob', visibility: 'workspace' as const }
const old = { userId: 'bob' }

test('a private chunk is the owner’s alone', () => {
  assert.equal(chunkVisibleToSearch({ chunk: mine, viewerUserId: 'alice' }), true)
  assert.equal(chunkVisibleToSearch({ chunk: theirs, viewerUserId: 'alice' }), false)
})

test('shared chunks and chunks from before visibility existed are visible to everyone', () => {
  assert.equal(chunkVisibleToSearch({ chunk: shared, viewerUserId: 'alice' }), true)
  assert.equal(chunkVisibleToSearch({ chunk: old, viewerUserId: 'alice' }), true)
})

test('a workspace-only search leaves out private chunks even the searcher’s own', () => {
  assert.equal(chunkVisibleToSearch({ chunk: mine, viewerUserId: 'alice', workspaceOnly: true }), false)
  assert.equal(chunkVisibleToSearch({ chunk: shared, viewerUserId: 'alice', workspaceOnly: true }), true)
})

test('a workspace-only search never reads files', () => {
  assert.deepEqual(workspaceOnlySourceKinds(undefined), ['memory', 'message'])
  assert.deepEqual(workspaceOnlySourceKinds(['file', 'memory']), ['memory'])
  assert.deepEqual(workspaceOnlySourceKinds(['file']), [])
})
