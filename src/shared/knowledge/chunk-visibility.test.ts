import assert from 'node:assert/strict'
import test from 'node:test'
import { chunkVisibleToSearch, fileChunkOwner, fileChunkVisibility } from './chunk-visibility'

const mine = { userId: 'alice', visibility: 'owner' as const }
const theirs = { userId: 'bob', visibility: 'owner' as const }
const shared = { userId: 'bob', visibility: 'workspace' as const }
const old = { userId: 'bob' }

test('a private chunk is the owner’s alone', () => {
  assert.equal(chunkVisibleToSearch({ chunk: mine, viewerUserId: 'alice' }), true)
  assert.equal(chunkVisibleToSearch({ chunk: theirs, viewerUserId: 'alice' }), false)
})

test('shared chunks and memory or message chunks from before visibility existed are visible to everyone', () => {
  assert.equal(chunkVisibleToSearch({ chunk: shared, viewerUserId: 'alice' }), true)
  assert.equal(chunkVisibleToSearch({ chunk: old, viewerUserId: 'alice' }), true)
  assert.equal(chunkVisibleToSearch({ chunk: { ...old, sourceKind: 'memory' }, viewerUserId: 'alice' }), true)
})

test('a workspace-only search leaves out private chunks even the searcher’s own', () => {
  assert.equal(chunkVisibleToSearch({ chunk: mine, viewerUserId: 'alice', workspaceOnly: true }), false)
  assert.equal(chunkVisibleToSearch({ chunk: shared, viewerUserId: 'alice', workspaceOnly: true }), true)
})

test('a file chunk is private unless it is marked workspace', () => {
  const unmarkedFile = { userId: 'bob', sourceKind: 'file' }
  assert.equal(chunkVisibleToSearch({ chunk: unmarkedFile, viewerUserId: 'alice' }), false)
  assert.equal(chunkVisibleToSearch({ chunk: unmarkedFile, viewerUserId: 'bob' }), true)
  assert.equal(chunkVisibleToSearch({ chunk: unmarkedFile, viewerUserId: 'bob', workspaceOnly: true }), false)
  const workspaceFile = { userId: 'bob', sourceKind: 'file', visibility: 'workspace' as const }
  assert.equal(chunkVisibleToSearch({ chunk: workspaceFile, viewerUserId: 'alice', workspaceOnly: true }), true)
})

test('only a live workspace file is searchable by everyone', () => {
  assert.equal(fileChunkVisibility({ scope: 'workspace', workspaceId: 'ws' }), 'workspace')
  assert.equal(fileChunkVisibility({ scope: 'workspace', workspaceId: 'ws', archivedAt: 1 }), 'owner')
  assert.equal(fileChunkVisibility({ scope: 'workspace' }), 'owner')
  assert.equal(fileChunkVisibility({ scope: 'personal', workspaceId: 'ws' }), 'owner')
  assert.equal(fileChunkVisibility({}), 'owner')
})

test('a workspace file is indexed once for the workspace; any other file under its uploader', () => {
  assert.deepEqual(fileChunkOwner({ userId: 'bob', scope: 'workspace', workspaceId: 'ws' }), { userId: 'workspace-files:ws', visibility: 'workspace' })
  assert.deepEqual(fileChunkOwner({ userId: 'bob', scope: 'personal', workspaceId: 'ws' }), { userId: 'bob', visibility: 'owner' })
})
