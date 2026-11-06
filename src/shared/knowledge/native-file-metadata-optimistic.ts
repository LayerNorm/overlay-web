import type { OptimisticLocalStore } from 'convex/browser'
import type { FunctionReturnType } from 'convex/server'
import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'
import type { PanelScope } from '@/shared/workspaces/panel-scope'

type NativeList = FunctionReturnType<typeof api.files.nativeMetadata.list>
type NativeFile = NativeList['nodes'][number]
type ScopeAction = 'move' | 'archive' | 'restore'

function sameWorkspace(store: OptimisticLocalStore, workspaceId: string) {
  return store.getAllQueries(api.files.nativeMetadata.list)
    .filter((query) => query.args.workspaceId === workspaceId && query.value !== undefined)
}

function latestCachedRevision(
  store: OptimisticLocalStore,
  workspaceId: string,
  fileId: string,
): number | undefined {
  const revisions = [
    ...store.getAllQueries(api.files.nativeMetadata.list)
      .filter((query) => query.args.workspaceId === workspaceId && query.value !== undefined)
      .flatMap((query) => query.value!.nodes.filter((node) => node._id === fileId).map((node) => node.updatedAt)),
    ...store.getAllQueries(api.files.nativeMetadata.detail)
      .filter((query) => query.args.workspaceId === workspaceId && query.args.fileId === fileId && query.value)
      .map((query) => (query.value as NativeFile).updatedAt),
  ]
  return revisions.length ? Math.max(...revisions) : undefined
}

function updateDetail(
  store: OptimisticLocalStore,
  workspaceId: string,
  fileId: string,
  expectedUpdatedAt: number,
  update: (node: NativeFile) => NativeFile | null,
) {
  for (const query of store.getAllQueries(api.files.nativeMetadata.detail)) {
    if (query.args.workspaceId !== workspaceId || query.args.fileId !== fileId || !query.value) continue
    const current = query.value as NativeFile
    if (current.updatedAt !== expectedUpdatedAt) continue
    store.setQuery(api.files.nativeMetadata.detail, query.args, update(current))
  }
}

function collectCachedNodes(store: OptimisticLocalStore, workspaceId: string) {
  const allNodes = new Map<string, NativeFile>()
  for (const query of sameWorkspace(store, workspaceId)) {
    for (const node of query.value!.nodes) {
      const previous = allNodes.get(node._id)
      if (!previous || node.updatedAt >= previous.updatedAt) allNodes.set(node._id, node)
    }
  }
  for (const query of store.getAllQueries(api.files.nativeMetadata.detail)) {
    if (query.args.workspaceId !== workspaceId || !query.value) continue
    const node = query.value as NativeFile
    const previous = allNodes.get(node._id)
    if (!previous || node.updatedAt >= previous.updatedAt) allNodes.set(node._id, node)
  }
  return allNodes
}

function collectSubtree(allNodes: Map<string, NativeFile>, rootId: string) {
  const subtree = new Set<string>([rootId])
  let changed = true
  while (changed) {
    changed = false
    for (const node of allNodes.values()) {
      if (node.parentId && subtree.has(node.parentId) && !subtree.has(node._id)) {
        subtree.add(node._id)
        changed = true
      }
    }
  }
  return subtree
}

function scopeUpdatedNode(node: NativeFile, root: NativeFile, action: ScopeAction, to?: PanelScope) {
  if (action === 'archive') {
    return { ...node, archivedAt: Date.now(), archivedFromScope: node.scope }
  }
  if (action === 'restore') {
    return {
      ...node,
      scope: node.archivedFromScope ?? node.scope,
      archivedAt: undefined,
      archivedFromScope: undefined,
    }
  }
  return {
    ...node,
    scope: to ?? node.scope,
    ...(node._id === root._id ? { parentId: null } : {}),
  }
}

function applyScopeToLists(
  store: OptimisticLocalStore,
  workspaceId: string,
  root: NativeFile,
  updatedNodes: Map<string, NativeFile>,
) {
  for (const query of sameWorkspace(store, workspaceId)) {
    const view = query.args.view
    const nodes = new Map<string, NativeFile>(query.value!.nodes.map((node) => [node._id, node]))
    for (const [id, node] of updatedNodes) {
      const inView = view === 'archived'
        ? node.archivedAt !== undefined
        : node.archivedAt === undefined && node.scope === view
          && (view !== 'personal' || node.userId === root.userId)
      if (inView) nodes.set(id, node)
      else nodes.delete(id)
    }
    store.setQuery(api.files.nativeMetadata.list, query.args, {
      ...query.value!,
      nodes: [...nodes.values()],
    })
  }
}

function applyScopeToDetails(
  store: OptimisticLocalStore,
  workspaceId: string,
  allNodes: Map<string, NativeFile>,
  updatedNodes: Map<string, NativeFile>,
) {
  for (const [id, node] of updatedNodes) {
    updateDetail(store, workspaceId, id, allNodes.get(id)!.updatedAt, () => node)
  }
}

export function optimisticRename(
  store: OptimisticLocalStore,
  args: { workspaceId: string; fileId: Id<'files'>; expectedUpdatedAt: number; name: string },
) {
  if (latestCachedRevision(store, args.workspaceId, args.fileId) !== args.expectedUpdatedAt) return
  for (const query of sameWorkspace(store, args.workspaceId)) {
    const node = query.value!.nodes.find((item) => item._id === args.fileId)
    if (!node || node.updatedAt !== args.expectedUpdatedAt) continue
    const dot = args.name.lastIndexOf('.')
    const updated = {
      ...node,
      name: args.name.trim(),
      extension: dot > 0 ? args.name.slice(dot + 1).toLowerCase() || undefined : undefined,
    }
    store.setQuery(api.files.nativeMetadata.list, query.args, {
      ...query.value!,
      nodes: query.value!.nodes.map((item) => item._id === args.fileId ? updated : item),
    })
  }
  updateDetail(store, args.workspaceId, args.fileId, args.expectedUpdatedAt, (node) => ({
    ...node,
    name: args.name.trim(),
    extension: args.name.lastIndexOf('.') > 0
      ? args.name.slice(args.name.lastIndexOf('.') + 1).toLowerCase() || undefined
      : undefined,
  }))
}

export function optimisticMove(
  store: OptimisticLocalStore,
  args: {
    workspaceId: string
    fileId: Id<'files'>
    expectedUpdatedAt: number
    parentId: Id<'files'> | null
  },
) {
  if (latestCachedRevision(store, args.workspaceId, args.fileId) !== args.expectedUpdatedAt) return
  for (const query of sameWorkspace(store, args.workspaceId)) {
    const current = query.value!.nodes.find((node) => node._id === args.fileId)
    if (!current || current.updatedAt !== args.expectedUpdatedAt) continue
    const nodes = query.value!.nodes.map((node) => node._id === args.fileId
      ? { ...node, parentId: args.parentId }
      : node)
    store.setQuery(api.files.nativeMetadata.list, query.args, { ...query.value!, nodes })
  }
  updateDetail(store, args.workspaceId, args.fileId, args.expectedUpdatedAt, (node) => ({
    ...node,
    parentId: args.parentId,
  }))
}

export function optimisticScopeChange(
  store: OptimisticLocalStore,
  args: {
    workspaceId: string
    fileId: Id<'files'>
    expectedUpdatedAt: number
    action: ScopeAction
    to?: PanelScope
  },
) {
  const allNodes = collectCachedNodes(store, args.workspaceId)
  const root = allNodes.get(args.fileId)
  if (!root || root.updatedAt !== args.expectedUpdatedAt) return
  const subtree = collectSubtree(allNodes, root._id)
  const updatedNodes = new Map<string, NativeFile>()
  for (const id of subtree) {
    const node = allNodes.get(id)
    if (!node) continue
    updatedNodes.set(id, scopeUpdatedNode(node, root, args.action, args.to))
  }
  applyScopeToLists(store, args.workspaceId, root, updatedNodes)
  applyScopeToDetails(store, args.workspaceId, allNodes, updatedNodes)
}
