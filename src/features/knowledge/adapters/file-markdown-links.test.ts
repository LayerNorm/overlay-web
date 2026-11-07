import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileLinkChildren } from './file-markdown-links'

test('relative file metadata comes from the native children query for the folder and view', async () => {
  const calls: unknown[] = []
  const convex = { query: async (_fn: unknown, args: unknown) => {
    calls.push(args)
    return { complete: true, files: [{ _id: 'guide', name: 'File.md', type: 'file', userId: 'owner', parentId: undefined }] }
  } }
  const rows = await readFileLinkChildren({ convex: convex as never, workspaceId: 'ws', parentId: null, scope: 'workspace' })
  assert.deepEqual(calls, [{ workspaceId: 'ws', parentId: null, view: 'workspace' }])
  assert.deepEqual(rows.map(row => [row._id, row.parentId]), [['guide', null]])
})

test('a listing the viewer cannot read cannot produce a guessed link', async () => {
  const convex = { query: async () => null }
  await assert.rejects(readFileLinkChildren({ convex: convex as never, workspaceId: 'ws', parentId: 'task', scope: 'personal' }))
})

test('a partial folder listing is refused, so a hidden target or same-named sibling cannot be guessed', async () => {
  const convex = { query: async () => ({ complete: false, files: [{ _id: 'guide', name: 'File.md', type: 'file', userId: 'owner' }] }) }
  await assert.rejects(readFileLinkChildren({ convex: convex as never, workspaceId: 'ws', parentId: null, scope: 'workspace' }))
})
