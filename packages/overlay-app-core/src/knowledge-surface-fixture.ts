import {
  normalizeKnowledgeSurfaceNode,
  type FileNavigationAdapter,
  type FilePickerAdapter,
  type KnowledgeAnalyticsAdapter,
  type KnowledgeCreateInput,
  type KnowledgeDeleteInput,
  type KnowledgeMutationEvent,
  type KnowledgePickedFile,
  type KnowledgeRenameInput,
  type KnowledgeRepository,
  type KnowledgeRouteAdapter,
  type KnowledgeSurfaceAdapters,
  type KnowledgeSurfaceNode,
  type KnowledgeSurfaceRouteState,
  type KnowledgeMoveInput,
} from './knowledge-surface'

const FIXED_NOW = Date.parse('2026-07-20T12:00:00.000Z')

export interface FixtureKnowledgeSurfaceAdapters extends KnowledgeSurfaceAdapters {
  evidence: {
    analytics: Array<{ event: string; properties?: Readonly<Record<string, string | number | boolean | null>> }>
    openedIds: string[]
    routeWrites: KnowledgeSurfaceRouteState[]
  }
}

function defaultNodes(): KnowledgeSurfaceNode[] {
  return [
    normalizeKnowledgeSurfaceNode({
      _id: 'fixture-folder',
      name: 'Projects',
      type: 'folder',
      kind: 'folder',
      parentId: null,
      createdAt: FIXED_NOW,
      updatedAt: FIXED_NOW,
    }),
    normalizeKnowledgeSurfaceNode({
      _id: 'fixture-note',
      name: 'Parity notes',
      type: 'file',
      kind: 'note',
      parentId: 'fixture-folder',
      textContent: 'Web is the source of truth.',
      createdAt: FIXED_NOW,
      updatedAt: FIXED_NOW,
    }),
  ]
}

export function createFixtureKnowledgeRepository(
  initialNodes: readonly KnowledgeSurfaceNode[] = defaultNodes(),
): KnowledgeRepository {
  let nodes = initialNodes.map(normalizeKnowledgeSurfaceNode)
  let revision = 1
  const listeners = new Set<(event: KnowledgeMutationEvent) => void>()

  function emit(event: KnowledgeMutationEvent): void {
    for (const listener of listeners) listener(event)
  }

  function find(id: string): KnowledgeSurfaceNode {
    const node = nodes.find((candidate) => candidate.id === id)
    if (!node) throw new Error(`Knowledge node ${id} was not found`)
    return node
  }

  function commit(node: KnowledgeSurfaceNode): KnowledgeSurfaceNode {
    revision += 1
    const committed = {
      ...node,
      updatedAt: FIXED_NOW + revision,
      optimistic: 'committed' as const,
      revision: { revision: String(revision), updatedAt: FIXED_NOW + revision },
    }
    nodes = nodes.map((candidate) => candidate.id === committed.id ? committed : candidate)
    return committed
  }

  return {
    async list() {
      return { nodes: [...nodes], revision: String(revision) }
    },
    async get(id) {
      return nodes.find((node) => node.id === id) ?? null
    },
    async create(input: KnowledgeCreateInput) {
      revision += 1
      const id = input.clientId ?? `fixture-${revision}`
      const node = normalizeKnowledgeSurfaceNode({
        _id: id,
        clientId: input.clientId,
        name: input.name,
        type: input.kind === 'folder' ? 'folder' : 'file',
        kind: input.kind,
        parentId: input.parentId,
        content: input.content,
        mimeType: input.mimeType,
        extension: input.extension,
        createdAt: FIXED_NOW + revision,
        updatedAt: FIXED_NOW + revision,
        revision: { revision: String(revision), updatedAt: FIXED_NOW + revision },
      } as KnowledgeSurfaceNode)
      nodes = [...nodes, node]
      emit({ type: 'created', node, revision: String(revision) })
      return node
    },
    async rename(input: KnowledgeRenameInput) {
      const updated = commit({ ...find(input.id), name: input.name })
      emit({ type: 'updated', node: updated, revision: updated.revision?.revision })
      return updated
    },
    async move(input: KnowledgeMoveInput) {
      const updated = commit({ ...find(input.id), parentId: input.parentId })
      emit({ type: 'moved', id: input.id, parentId: input.parentId, revision: updated.revision })
      return updated
    },
    async delete(input: KnowledgeDeleteInput) {
      const deleted = new Set(input.ids)
      let changed = true
      while (changed) {
        changed = false
        for (const node of nodes) {
          if (node.parentId && deleted.has(node.parentId) && !deleted.has(node.id)) {
            deleted.add(node.id)
            changed = true
          }
        }
      }
      nodes = nodes.filter((node) => !deleted.has(node.id))
      revision += 1
      emit({ type: 'deleted', ids: [...deleted], revision: String(revision) })
    },
    async upload({ file, parentId, onProgress }) {
      onProgress?.({ status: 'uploading', progress: 0.5, bytesSent: file.sizeBytes / 2, bytesTotal: file.sizeBytes })
      const node = await this.create({
        name: file.name,
        kind: 'file',
        parentId,
        mimeType: file.mimeType,
      })
      onProgress?.({ status: 'complete', progress: 1, bytesSent: file.sizeBytes, bytesTotal: file.sizeBytes })
      return node
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}

export function createFixtureKnowledgeSurfaceAdapters(options?: {
  nodes?: readonly KnowledgeSurfaceNode[]
  pickedFiles?: readonly KnowledgePickedFile[]
  initialRoute?: Partial<KnowledgeSurfaceRouteState>
}): FixtureKnowledgeSurfaceAdapters {
  const analytics: FixtureKnowledgeSurfaceAdapters['evidence']['analytics'] = []
  const openedIds: string[] = []
  const routeWrites: KnowledgeSurfaceRouteState[] = []
  let route: KnowledgeSurfaceRouteState = {
    folderId: null,
    fileId: null,
    query: '',
    layout: 'list',
    ...options?.initialRoute,
  }
  const routeListeners = new Set<(route: KnowledgeSurfaceRouteState) => void>()

  const routeAdapter: KnowledgeRouteAdapter = {
    read: () => route,
    write(next) {
      route = { ...next }
      routeWrites.push(route)
      for (const listener of routeListeners) listener(route)
    },
    subscribe(listener) {
      routeListeners.add(listener)
      return () => routeListeners.delete(listener)
    },
  }

  const filePicker: FilePickerAdapter = {
    async pickFiles() {
      return options?.pickedFiles ?? []
    },
    async pickFolder() {
      return options?.pickedFiles ?? []
    },
  }

  const navigation: FileNavigationAdapter = {
    open(node) {
      openedIds.push(node.id)
    },
  }

  const analyticsAdapter: KnowledgeAnalyticsAdapter = {
    track(event, properties) {
      analytics.push({ event, properties })
    },
  }

  return {
    repository: createFixtureKnowledgeRepository(options?.nodes),
    route: routeAdapter,
    filePicker,
    navigation,
    analytics: analyticsAdapter,
    evidence: { analytics, openedIds, routeWrites },
  }
}

export interface KnowledgeAdapterContractEvidence {
  eventTypes: string[]
  createdId: string
  finalCount: number
}

/** Shared contract exercise used by web, desktop, and fixture adapter tests. */
export async function exerciseKnowledgeAdapterContract(
  adapters: KnowledgeSurfaceAdapters,
): Promise<KnowledgeAdapterContractEvidence> {
  const eventTypes: string[] = []
  const unsubscribe = adapters.repository.subscribe((event) => eventTypes.push(event.type))
  const before = await adapters.repository.list()
  const folder = await adapters.repository.create({ name: 'Contract folder', kind: 'folder', parentId: null })
  const file = await adapters.repository.create({ name: 'draft.txt', kind: 'file', parentId: null, content: 'draft' })
  const renamed = await adapters.repository.rename({ id: file.id, name: 'final.txt' })
  if (renamed.name !== 'final.txt') throw new Error('Knowledge repository did not persist rename')
  const moved = await adapters.repository.move({ id: file.id, parentId: folder.id })
  if (moved.parentId !== folder.id) throw new Error('Knowledge repository did not persist move')
  const loaded = await adapters.repository.get(file.id)
  if (!loaded || loaded.parentId !== folder.id) throw new Error('Knowledge repository get does not reflect mutations')
  await adapters.repository.delete({ ids: [folder.id] })
  if (await adapters.repository.get(file.id)) throw new Error('Knowledge repository delete did not remove descendants')
  const after = await adapters.repository.list()

  const initialRoute = adapters.route.read()
  adapters.route.write({ ...initialRoute, query: 'contract', layout: 'grid' })
  const nextRoute = adapters.route.read()
  if (nextRoute.query !== 'contract' || nextRoute.layout !== 'grid') {
    throw new Error('Knowledge route adapter did not preserve route state')
  }
  await adapters.filePicker.pickFiles({ multiple: true })
  adapters.navigation.open(normalizeKnowledgeSurfaceNode({
    _id: 'navigation-contract',
    name: 'Navigation contract',
    type: 'file',
    kind: 'file',
    parentId: null,
    createdAt: FIXED_NOW,
    updatedAt: FIXED_NOW,
  }))
  adapters.analytics.track('knowledge_contract_exercised', { createdId: file.id })
  unsubscribe()

  if (!eventTypes.includes('created') || !eventTypes.includes('updated') || !eventTypes.includes('moved') || !eventTypes.includes('deleted')) {
    throw new Error(`Knowledge repository mutation events are incomplete: ${eventTypes.join(', ')}`)
  }
  if (after.nodes.length !== before.nodes.length) throw new Error('Knowledge repository contract did not restore initial count')
  return { eventTypes, createdId: file.id, finalCount: after.nodes.length }
}
