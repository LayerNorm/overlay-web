import assert from 'node:assert/strict'
import test from 'node:test'
import type { OptimisticLocalStore } from 'convex/browser'
import { api } from '../../../../convex/_generated/api'
import type { Id } from '../../../../convex/_generated/dataModel'
import { optimisticRename } from './native-file-metadata-optimistic'

type NativeFile = {
  _id: Id<'files'>
  workspaceId: string
  userId: string
  name: string
  type: 'file'
  kind: 'upload'
  parentId: null
  scope: 'personal'
  createdAt: number
  updatedAt: number
}

type CachedQuery = { reference: unknown; args: Record<string, unknown>; value: any }

function createStore(entries: CachedQuery[]) {
  const store = {
    getAllQueries(reference: unknown) {
      return entries.filter((entry) => entry.reference === reference)
    },
    setQuery(reference: unknown, args: Record<string, unknown>, value: unknown) {
      const entry = entries.find((candidate) => candidate.reference === reference
        && JSON.stringify(candidate.args) === JSON.stringify(args))
      if (entry) entry.value = value
      else entries.push({ reference, args, value })
    },
  } as unknown as OptimisticLocalStore
  return {
    store,
    read(reference: unknown, args: Record<string, unknown>) {
      return entries.find((entry) => entry.reference === reference
        && JSON.stringify(entry.args) === JSON.stringify(args))?.value
    },
  }
}

function file(id: string, workspaceId: string, name: string, updatedAt: number): NativeFile {
  return {
    _id: id as Id<'files'>,
    workspaceId,
    userId: 'user-a',
    name,
    type: 'file',
    kind: 'upload',
    parentId: null,
    scope: 'personal',
    createdAt: 1,
    updatedAt,
  }
}

test('native rename rebases by entity, preserving unrelated and newer cached values', () => {
  const target = file('target', 'workspace-a', 'Before.txt', 10)
  const unrelated = file('other', 'workspace-a', 'Other.txt', 8)
  const foreignTarget = file('target', 'workspace-b', 'Other scope.txt', 10)
  const personalArgs = { workspaceId: 'workspace-a', view: 'personal' }
  const foreignArgs = { workspaceId: 'workspace-b', view: 'personal' }
  const detailArgs = { workspaceId: 'workspace-a', fileId: target._id }
  const cache = createStore([
    { reference: api.files.nativeMetadata.list, args: personalArgs, value: { nodes: [target, unrelated], truncated: false } },
    { reference: api.files.nativeMetadata.list, args: foreignArgs, value: { nodes: [foreignTarget], truncated: false } },
    { reference: api.files.nativeMetadata.detail, args: detailArgs, value: target },
  ])
  const mutation = {
    workspaceId: 'workspace-a',
    fileId: target._id,
    expectedUpdatedAt: target.updatedAt,
    name: 'Optimistic.txt',
  }

  optimisticRename(cache.store, mutation)
  let current = cache.read(api.files.nativeMetadata.list, personalArgs)
  assert.equal(current.nodes.find((node: NativeFile) => node._id === target._id)?.name, 'Optimistic.txt')
  assert.equal(current.nodes.find((node: NativeFile) => node._id === unrelated._id)?.name, 'Other.txt')
  assert.equal(cache.read(api.files.nativeMetadata.list, foreignArgs).nodes[0].name, 'Other scope.txt')
  assert.equal(cache.read(api.files.nativeMetadata.detail, detailArgs).name, 'Optimistic.txt')

  const newerTarget = { ...target, name: 'Remote rename.txt', updatedAt: 12 }
  const newerUnrelated = { ...unrelated, name: 'Remote unrelated.txt', updatedAt: 13 }
  cache.store.setQuery(api.files.nativeMetadata.list, personalArgs, {
    nodes: [newerTarget, newerUnrelated],
    truncated: false,
  })
  cache.store.setQuery(api.files.nativeMetadata.detail, detailArgs, newerTarget)
  optimisticRename(cache.store, mutation)

  current = cache.read(api.files.nativeMetadata.list, personalArgs)
  assert.deepEqual(current.nodes.map((node: NativeFile) => [node._id, node.name, node.updatedAt]), [
    [target._id, 'Remote rename.txt', 12],
    [unrelated._id, 'Remote unrelated.txt', 13],
  ])
})
