import {
  normalizeKnowledgeSurfaceNode,
  type FileNavigationAdapter,
  type KnowledgeAnalyticsAdapter,
  type KnowledgeMutationEvent,
  type KnowledgeRepository,
  type KnowledgeSurfaceAdapters,
  type KnowledgeSurfaceNode,
} from '@overlay/app-core'
import {
  createDesktopKnowledgeRouteAdapter,
  createDesktopNativeFilePickerAdapter,
} from './desktopKnowledgeSurfaceAdapters'

const NOTE_PREFIX = 'local-note:'
const DOCUMENT_PREFIX = 'local-document:'

const rawId = (id: string): string => id.replace(/^(?:local-note:|local-document:)/, '')

async function loadLocalNodes(): Promise<KnowledgeSurfaceNode[]> {
  const [notes, documents] = await Promise.all([
    window.bridge.loadNotes(),
    window.bridge.document.getAll(250),
  ])
  return [
    ...notes.map((note) => normalizeKnowledgeSurfaceNode({
      _id: `${NOTE_PREFIX}${note.id}`,
      clientId: note.id,
      name: note.title || 'Untitled',
      type: 'file' as const,
      kind: 'note',
      parentId: null,
      createdAt: note.updatedAt,
      updatedAt: note.updatedAt,
    })),
    ...documents.map((document) => normalizeKnowledgeSurfaceNode({
      _id: `${DOCUMENT_PREFIX}${document.id}`,
      clientId: document.id,
      name: document.filename || 'Untitled',
      type: 'file' as const,
      kind: 'upload',
      parentId: null,
      mimeType: document.mimeType,
      createdAt: document.createdAt,
      updatedAt: document.createdAt,
    })),
  ]
}

export function createDesktopLocalKnowledgeRepository(): KnowledgeRepository {
  const listeners = new Set<(event: KnowledgeMutationEvent) => void>()
  const byId = new Map<string, KnowledgeSurfaceNode>()
  const emit = (event: KnowledgeMutationEvent): void => listeners.forEach((listener) => listener(event))
  const refresh = async (): Promise<KnowledgeSurfaceNode[]> => {
    const nodes = await loadLocalNodes()
    byId.clear()
    nodes.forEach((node) => byId.set(node.id, node))
    return nodes
  }
  const repository: KnowledgeRepository = {
    async list() {
      const nodes = await refresh()
      return { nodes, revision: String(nodes.reduce((latest, node) => Math.max(latest, node.updatedAt), 0)) }
    },
    async get(id) {
      if (!byId.has(id)) await refresh()
      return byId.get(id) ?? null
    },
    async create(input) {
      if (input.kind !== 'note') throw new Error('On this Mac currently supports local notes only.')
      const id = input.clientId || `desktop-note-${crypto.randomUUID()}`
      const now = Date.now()
      await window.bridge.saveNote({ id, title: input.name || 'Untitled', content: input.content || '', updatedAt: now })
      const node = normalizeKnowledgeSurfaceNode({
        _id: `${NOTE_PREFIX}${id}`,
        clientId: id,
        name: input.name || 'Untitled',
        type: 'file',
        kind: 'note',
        parentId: null,
        createdAt: now,
        updatedAt: now,
      })
      byId.set(node.id, node)
      emit({ type: 'created', node })
      return node
    },
    async rename(input) {
      const node = await repository.get(input.id)
      if (!node || node.kind !== 'note') throw new Error('Only local notes can be renamed.')
      const localId = node.clientId || rawId(node.id)
      const current = await window.bridge.loadNote(localId)
      if (!current) throw new Error('Local note not found.')
      const updatedAt = Date.now()
      await window.bridge.saveNote({ ...current, id: localId, title: input.name, updatedAt })
      const updated = { ...node, name: input.name, updatedAt }
      byId.set(updated.id, updated)
      emit({ type: 'updated', node: updated })
      return updated
    },
    async move(input) {
      const node = await repository.get(input.id)
      if (!node) throw new Error('Local item not found.')
      if (input.parentId) throw new Error('Folders require a signed-in cloud workspace.')
      return node
    },
    async delete(input) {
      for (const id of input.ids) {
        const node = await repository.get(id)
        if (!node) continue
        if (node.kind === 'note') await window.bridge.deleteNote(node.clientId || rawId(node.id))
        else await window.bridge.document.remove(node.clientId || rawId(node.id))
        byId.delete(id)
      }
      emit({ type: 'deleted', ids: input.ids })
    },
    subscribe(listener) {
      listeners.add(listener)
      const unsubscribe = window.bridge.onNotesChanged(() => {
        void refresh().then((nodes) => emit({ type: 'reset', nodes }))
      })
      return () => {
        listeners.delete(listener)
        unsubscribe?.()
      }
    },
  }
  return repository
}

export function createDesktopLocalKnowledgeSurfaceAdapters({
  onOpenNote,
  onOpenDocument,
}: {
  onOpenNote(localId: string, node: KnowledgeSurfaceNode): void
  onOpenDocument(localId: string, node: KnowledgeSurfaceNode): void
}): KnowledgeSurfaceAdapters {
  const repository = createDesktopLocalKnowledgeRepository()
  const navigation: FileNavigationAdapter = {
    async open(node) {
      const localId = node.clientId || rawId(node.id)
      if (node.kind === 'note') onOpenNote(localId, node)
      else onOpenDocument(localId, node)
    },
  }
  const analytics: KnowledgeAnalyticsAdapter = { track() { return undefined } }
  return {
    repository,
    route: createDesktopKnowledgeRouteAdapter(),
    filePicker: createDesktopNativeFilePickerAdapter(),
    navigation,
    analytics,
  }
}
