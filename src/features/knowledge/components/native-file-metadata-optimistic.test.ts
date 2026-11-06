import assert from 'node:assert/strict'
import test from 'node:test'
import type { OptimisticLocalStore } from 'convex/browser'
import { getFunctionName } from 'convex/server'
import { api } from '../../../../convex/_generated/api'
import type { Id } from '../../../../convex/_generated/dataModel'
import {
  optimisticMove,
  optimisticRename,
  optimisticScopeChange,
} from '@/shared/knowledge/native-file-metadata-optimistic'

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

type CachedQuery = { reference: unknown; args: Record<string, unknown>; value: unknown }

function createStore(entries: CachedQuery[]) {
  const sameReference = (left: unknown, right: unknown) =>
    getFunctionName(left as never) === getFunctionName(right as never)
  const store = {
    getAllQueries(reference: unknown) {
      return entries.filter((entry) => sameReference(entry.reference, reference))
    },
    setQuery(reference: unknown, args: Record<string, unknown>, value: unknown) {
      const entry = entries.find((candidate) => sameReference(candidate.reference, reference)
        && JSON.stringify(candidate.args) === JSON.stringify(args))
      if (entry) entry.value = value
      else entries.push({ reference, args, value })
    },
  } as unknown as OptimisticLocalStore
  return {
    store,
    read(reference: unknown, args: Record<string, unknown>) {
      return entries.find((entry) => sameReference(entry.reference, reference)
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
  let current = cache.read(api.files.nativeMetadata.list, personalArgs) as { nodes: NativeFile[] }
  assert.equal(current.nodes.find((node: NativeFile) => node._id === target._id)?.name, 'Optimistic.txt')
  assert.equal(current.nodes.find((node: NativeFile) => node._id === target._id)?.updatedAt, 10)
  assert.equal(current.nodes.find((node: NativeFile) => node._id === unrelated._id)?.name, 'Other.txt')
  assert.equal((cache.read(api.files.nativeMetadata.list, foreignArgs) as { nodes: NativeFile[] }).nodes[0]?.name, 'Other scope.txt')
  assert.deepEqual(
    cache.read(api.files.nativeMetadata.detail, detailArgs),
    { ...target, name: 'Optimistic.txt', extension: 'txt' },
  )

  const newerTarget = { ...target, name: 'Remote rename.txt', updatedAt: 12 }
  const newerUnrelated = { ...unrelated, name: 'Remote unrelated.txt', updatedAt: 13 }
  cache.store.setQuery(api.files.nativeMetadata.list, personalArgs, {
    nodes: [newerTarget, newerUnrelated],
    truncated: false,
  })
  cache.store.setQuery(api.files.nativeMetadata.detail, detailArgs, newerTarget)
  optimisticRename(cache.store, mutation)

  current = cache.read(api.files.nativeMetadata.list, personalArgs) as { nodes: NativeFile[] }
  assert.deepEqual(current.nodes.map((node: NativeFile) => [node._id, node.name, node.updatedAt]), [
    [target._id, 'Remote rename.txt', 12],
    [unrelated._id, 'Remote unrelated.txt', 13],
  ])
})

test('native move and scope optimism update metadata without manufacturing revisions', () => {
  const root = { ...file('root', 'workspace-a', 'Root', 10), type: 'folder' as const, kind: 'folder' as const }
  const child = { ...file('child', 'workspace-a', 'Child.txt', 11), parentId: root._id }
  const personalArgs = { workspaceId: 'workspace-a', view: 'personal' }
  const workspaceArgs = { workspaceId: 'workspace-a', view: 'workspace' }
  const archivedArgs = { workspaceId: 'workspace-a', view: 'archived' }
  const rootDetailArgs = { workspaceId: 'workspace-a', fileId: root._id }
  const childDetailArgs = { workspaceId: 'workspace-a', fileId: child._id }
  const cache = createStore([
    { reference: api.files.nativeMetadata.list, args: personalArgs, value: { nodes: [root, child], truncated: false } },
    { reference: api.files.nativeMetadata.list, args: workspaceArgs, value: { nodes: [], truncated: false } },
    { reference: api.files.nativeMetadata.list, args: archivedArgs, value: { nodes: [], truncated: false } },
    { reference: api.files.nativeMetadata.detail, args: rootDetailArgs, value: root },
    { reference: api.files.nativeMetadata.detail, args: childDetailArgs, value: child },
  ])

  optimisticMove(cache.store, {
    workspaceId: 'workspace-a',
    fileId: child._id,
    expectedUpdatedAt: child.updatedAt,
    parentId: null,
  })
  let moved = cache.read(api.files.nativeMetadata.detail, childDetailArgs) as NativeFile
  assert.equal(moved.parentId, null)
  assert.equal(moved.updatedAt, child.updatedAt)
  optimisticMove(cache.store, {
    workspaceId: 'workspace-a',
    fileId: child._id,
    expectedUpdatedAt: child.updatedAt,
    parentId: root._id,
  })

  optimisticScopeChange(cache.store, {
    workspaceId: 'workspace-a',
    fileId: root._id,
    expectedUpdatedAt: root.updatedAt,
    action: 'move',
    to: 'workspace',
  })
  const movedRoot = cache.read(api.files.nativeMetadata.detail, rootDetailArgs) as NativeFile
  moved = cache.read(api.files.nativeMetadata.detail, childDetailArgs) as NativeFile
  assert.equal(movedRoot.scope, 'workspace')
  assert.equal(moved.scope, 'workspace')
  assert.equal(movedRoot.updatedAt, root.updatedAt)
  assert.equal(moved.updatedAt, child.updatedAt)

  optimisticScopeChange(cache.store, {
    workspaceId: 'workspace-a',
    fileId: root._id,
    expectedUpdatedAt: root.updatedAt,
    action: 'archive',
  })
  assert.equal((cache.read(api.files.nativeMetadata.detail, rootDetailArgs) as NativeFile).updatedAt, root.updatedAt)
  assert.equal((cache.read(api.files.nativeMetadata.detail, childDetailArgs) as NativeFile).updatedAt, child.updatedAt)

  optimisticScopeChange(cache.store, {
    workspaceId: 'workspace-a',
    fileId: root._id,
    expectedUpdatedAt: root.updatedAt,
    action: 'restore',
  })
  assert.equal((cache.read(api.files.nativeMetadata.detail, rootDetailArgs) as NativeFile).updatedAt, root.updatedAt)
  assert.equal((cache.read(api.files.nativeMetadata.detail, childDetailArgs) as NativeFile).updatedAt, child.updatedAt)
})
