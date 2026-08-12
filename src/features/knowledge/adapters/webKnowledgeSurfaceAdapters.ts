'use client'

import { overlayAppClient } from '@/shared/app/overlay-app-client'
import posthog from 'posthog-js'
import {
  KNOWLEDGE_ENTITY_MUTATION_EVENT,
  KNOWLEDGE_RECONCILE_EVENT,
  KnowledgeMutationConsumer,
  createKnowledgeMutationPublisher,
  isKnowledgeEntityMutation,
  noteDocToKnowledgeFile,
  opensInDocumentEditor,
  normalizeKnowledgeSurfaceNode,
  type FileNavigationAdapter,
  type FilePickerAdapter,
  type CreateFileRequest,
  type KnowledgeAnalyticsAdapter,
  type KnowledgeCreateInput,
  type KnowledgeDeleteInput,
  type KnowledgeFile,
  type KnowledgeMutationEvent,
  type KnowledgeEntityMutation,
  type KnowledgePickedFile,
  type KnowledgeRenameInput,
  type KnowledgeRepository,
  type KnowledgeRouteAdapter,
  type KnowledgeSurfaceAdapters,
  type KnowledgeSurfaceNode,
  type KnowledgeSurfaceRouteState,
  type KnowledgeMoveInput,
  type UpdateFileRequest,
  type NoteDoc,
} from '@overlay/app-core'

interface FilesClientLike {
  get<T>(query?: { limit?: number }, options?: { signal?: AbortSignal }): Promise<T>
  getResponse(query: { fileId: string }, options?: { signal?: AbortSignal }): Promise<Response>
  createResponse(input: CreateFileRequest): Promise<Response>
  updateResponse(input: UpdateFileRequest): Promise<Response>
  deleteResponse(input: { fileId: string }): Promise<Response>
}

interface NotesClientLike {
  get<T>(query?: { limit?: number; noteId?: string }, options?: { signal?: AbortSignal }): Promise<T>
  deleteResponse(input: { noteId: string }): Promise<Response>
}

export interface WebKnowledgeAppClient {
  files: FilesClientLike
  notes: NotesClientLike
}

type KnowledgeEventTarget = Pick<Window, 'addEventListener' | 'removeEventListener'>
  & Partial<Pick<Window, 'dispatchEvent'>>

function responseError(response: Response, fallback: string): Promise<Error> {
  return response.json()
    .catch(() => null)
    .then((body: { error?: string; message?: string } | null) =>
      new Error(body?.message || body?.error || fallback),
    )
}

async function responseNode(response: Response, fallback: KnowledgeCreateInput): Promise<KnowledgeSurfaceNode> {
  if (!response.ok) throw await responseError(response, 'Knowledge mutation failed')
  const body = await response.json() as { id?: string; file?: KnowledgeFile | null }
  if (body.file) return normalizeKnowledgeSurfaceNode(body.file)
  if (!body.id) throw new Error('Knowledge mutation returned no file identifier')
  const now = Date.now()
  return normalizeKnowledgeSurfaceNode({
    _id: body.id,
    clientId: fallback.clientId,
    name: fallback.name,
    type: fallback.kind === 'folder' ? 'folder' : 'file',
    kind: fallback.kind,
    parentId: fallback.parentId,
    content: fallback.content,
    mimeType: fallback.mimeType,
    extension: fallback.extension,
    createdAt: now,
    updatedAt: now,
  })
}

export function createWebKnowledgeRepository(
  client: WebKnowledgeAppClient = overlayAppClient,
  eventTarget: KnowledgeEventTarget | null | undefined =
    typeof window === 'undefined' ? undefined : window,
  origin = `web:${globalThis.crypto?.randomUUID?.() ?? Date.now()}`,
): KnowledgeRepository {
  const listeners = new Set<(event: KnowledgeMutationEvent) => void>()
  const byId = new Map<string, KnowledgeSurfaceNode>()
  let externalCleanup: (() => void) | undefined
  const nextMutation = createKnowledgeMutationPublisher(origin)

  function emit(event: KnowledgeMutationEvent): void {
    for (const listener of listeners) listener(event)
  }

  function publish(mutation: Omit<KnowledgeEntityMutation, 'origin' | 'revision'>): void {
    if (!eventTarget?.dispatchEvent || typeof CustomEvent === 'undefined') return
    eventTarget.dispatchEvent(new CustomEvent(KNOWLEDGE_ENTITY_MUTATION_EVENT, {
      detail: nextMutation(mutation),
    }))
  }

  async function list(signal?: AbortSignal): Promise<{ nodes: KnowledgeSurfaceNode[]; revision: string }> {
    const [fileRows, noteRows] = await Promise.all([
      client.files.get<KnowledgeFile[]>({ limit: 100 }, { signal }),
      client.notes.get<NoteDoc[]>({ limit: 100 }, { signal }),
    ])
    const files = Array.isArray(fileRows) ? fileRows : []
    const notes = Array.isArray(noteRows) ? noteRows.map(noteDocToKnowledgeFile) : []
    const canonicalIds = new Set(files.map((file) => file._id))
    const nodes = [...files, ...notes.filter((note) => !canonicalIds.has(note._id))]
      .map(normalizeKnowledgeSurfaceNode)
    byId.clear()
    for (const node of nodes) byId.set(node.id, node)
    const revision = String(nodes.reduce((latest, node) => Math.max(latest, node.updatedAt), 0))
    return { nodes, revision }
  }

  const repository: KnowledgeRepository = {
    list,
    async get(id, signal) {
      const response = await client.files.getResponse({ fileId: id }, { signal })
      if (response.status === 404) return null
      if (!response.ok) throw await responseError(response, 'Could not load file')
      const node = normalizeKnowledgeSurfaceNode(await response.json() as KnowledgeFile)
      byId.set(node.id, node)
      return node
    },
    async create(input) {
      const node = await responseNode(await client.files.createResponse({
        name: input.name,
        type: input.kind === 'folder' ? 'folder' : 'file',
        kind: input.kind === 'file' ? 'upload' : input.kind,
        parentId: input.parentId,
        content: input.content,
        textContent: input.kind === 'note' ? input.content ?? '' : undefined,
        mimeType: input.mimeType,
        extension: input.extension,
        clientId: input.clientId,
      }), input)
      byId.set(node.id, node)
      emit({ type: 'created', node })
      publish({ entity: node.kind === 'note' ? 'note' : 'file', id: node.id, operation: 'created' })
      return node
    },
    async rename(input: KnowledgeRenameInput) {
      const response = await client.files.updateResponse({ fileId: input.id, name: input.name })
      if (!response.ok) throw await responseError(response, 'Could not rename file')
      const current = byId.get(input.id) ?? await repository.get(input.id)
      if (!current) throw new Error(`Knowledge node ${input.id} was not found`)
      const node = { ...current, name: input.name, updatedAt: Date.now() }
      byId.set(node.id, node)
      emit({ type: 'updated', node })
      publish({ entity: node.kind === 'note' ? 'note' : 'file', id: node.id, operation: 'updated' })
      return node
    },
    async move(input: KnowledgeMoveInput) {
      const response = await client.files.updateResponse({ fileId: input.id, parentId: input.parentId })
      if (!response.ok) throw await responseError(response, 'Could not move file')
      const current = byId.get(input.id) ?? await repository.get(input.id)
      if (!current) throw new Error(`Knowledge node ${input.id} was not found`)
      const node = { ...current, parentId: input.parentId, updatedAt: Date.now() }
      byId.set(node.id, node)
      emit({ type: 'moved', id: node.id, parentId: node.parentId, revision: node.revision })
      publish({ entity: node.kind === 'note' ? 'note' : 'file', id: node.id, operation: 'moved' })
      return node
    },
    async delete(input: KnowledgeDeleteInput) {
      for (const id of input.ids) {
        const node = byId.get(id) ?? await repository.get(id)
        const response = node?.kind === 'note'
          ? await client.notes.deleteResponse({ noteId: id })
          : await client.files.deleteResponse({ fileId: id })
        if (!response.ok) throw await responseError(response, 'Could not delete file')
      }
      const deleted = input.ids.map((id) => byId.get(id)).filter(Boolean) as KnowledgeSurfaceNode[]
      for (const id of input.ids) byId.delete(id)
      emit({ type: 'deleted', ids: input.ids })
      for (const node of deleted) {
        publish({ entity: node.kind === 'note' ? 'note' : 'file', id: node.id, operation: 'deleted' })
      }
    },
    subscribe(listener) {
      listeners.add(listener)
      if (listeners.size === 1 && eventTarget) {
        const consumer = new KnowledgeMutationConsumer({
          origin,
          repository,
          async loadNode(mutation, signal) {
            if (mutation.entity !== 'note') return repository.get(mutation.id, signal)
            try {
              const note = await client.notes.get<NoteDoc>({ noteId: mutation.id }, { signal })
              const node = normalizeKnowledgeSurfaceNode(noteDocToKnowledgeFile(note))
              byId.set(node.id, node)
              return node
            } catch (error) {
              if (signal.aborted) throw error
              return repository.get(mutation.id, signal)
            }
          },
          apply: emit,
        })
        const handleMutation = (event: Event) => {
          const mutation = (event as CustomEvent<unknown>).detail
          if (isKnowledgeEntityMutation(mutation)) void consumer.handle(mutation).catch(() => undefined)
        }
        const handleReconcile = (event: Event) => {
          const reason = (event as CustomEvent<{ reason?: string }>).detail?.reason
          const normalized = reason === 'authentication-changed' || reason === 'cache-corruption'
            ? reason
            : 'explicit-refresh'
          void consumer.reconcile(normalized).catch(() => undefined)
        }
        const handleOnline = () => { void consumer.reconcile('reconnected').catch(() => undefined) }
        eventTarget.addEventListener(KNOWLEDGE_ENTITY_MUTATION_EVENT, handleMutation)
        eventTarget.addEventListener(KNOWLEDGE_RECONCILE_EVENT, handleReconcile)
        eventTarget.addEventListener('online', handleOnline)
        externalCleanup = () => {
          consumer.dispose()
          eventTarget.removeEventListener(KNOWLEDGE_ENTITY_MUTATION_EVENT, handleMutation)
          eventTarget.removeEventListener(KNOWLEDGE_RECONCILE_EVENT, handleReconcile)
          eventTarget.removeEventListener('online', handleOnline)
        }
      }
      return () => {
        listeners.delete(listener)
        if (listeners.size === 0) {
          externalCleanup?.()
          externalCleanup = undefined
        }
      }
    },
  }
  return repository
}

function routeFromUrl(url: URL): KnowledgeSurfaceRouteState {
  const layoutParam = url.searchParams.get('layout')
  return {
    folderId: url.searchParams.get('folder'),
    fileId: url.searchParams.get('file'),
    query: url.searchParams.get('q') ?? '',
    layout: layoutParam === 'cards' || layoutParam === 'grid' ? 'grid' : 'list',
  }
}

export function createWebKnowledgeRouteAdapter(options: {
  currentUrl?: () => URL
  navigate?: (url: string, replace: boolean) => void
  eventTarget?: KnowledgeEventTarget | null
} = {}): KnowledgeRouteAdapter {
  const currentUrl = options.currentUrl ?? (() => new URL(window.location.href))
  const navigate = options.navigate ?? ((url, replace) => {
    window.history[replace ? 'replaceState' : 'pushState'](null, '', url)
  })
  return {
    read: () => routeFromUrl(currentUrl()),
    write(route, writeOptions) {
      const url = currentUrl()
      const entries: Array<[string, string | null]> = [
        ['folder', route.folderId],
        ['file', route.fileId],
        ['q', route.query || null],
        ['layout', route.layout === 'grid' ? 'cards' : 'list'],
      ]
      for (const [key, value] of entries) {
        if (value) url.searchParams.set(key, value)
        else url.searchParams.delete(key)
      }
      navigate(`${url.pathname}${url.search}${url.hash}`, Boolean(writeOptions?.replace))
    },
    subscribe(listener) {
      const target = options.eventTarget ?? window
      const handlePopState = () => listener(routeFromUrl(currentUrl()))
      target.addEventListener('popstate', handlePopState)
      return () => target.removeEventListener('popstate', handlePopState)
    },
  }
}

function browserPickedFile(file: File): KnowledgePickedFile {
  return {
    name: file.name,
    sizeBytes: file.size,
    mimeType: file.type || undefined,
    relativePath: file.webkitRelativePath || undefined,
    async read() {
      return new Uint8Array(await file.arrayBuffer())
    },
  }
}

function pickWithInput(options: { multiple?: boolean; accept?: string; directory?: boolean }): Promise<readonly KnowledgePickedFile[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.multiple = Boolean(options.multiple || options.directory)
    input.accept = options.accept ?? ''
    if (options.directory) input.setAttribute('webkitdirectory', '')
    input.addEventListener('change', () => resolve(Array.from(input.files ?? []).map(browserPickedFile)), { once: true })
    input.addEventListener('cancel', () => resolve([]), { once: true })
    input.click()
  })
}

export function createWebFilePickerAdapter(
  picker: typeof pickWithInput = pickWithInput,
): FilePickerAdapter {
  return {
    pickFiles: (options) => picker(options ?? {}),
    pickFolder: () => picker({ directory: true, multiple: true }),
  }
}

export function createWebKnowledgeSurfaceAdapters(options: {
  client?: WebKnowledgeAppClient
  route?: KnowledgeRouteAdapter
  filePicker?: FilePickerAdapter
  navigate?: (url: string, options?: { replace?: boolean }) => void
  capture?: (event: string, properties?: Record<string, unknown>) => void
  eventTarget?: KnowledgeEventTarget | null
  origin?: string
} = {}): KnowledgeSurfaceAdapters {
  const navigate = options.navigate ?? ((url) => window.location.assign(url))
  const navigation: FileNavigationAdapter = {
    open(node, navigationOptions) {
      // KnowledgeSurfaceNode declares both `id` and `_id`, but the rows the API
      // returns only carry `_id` — so `node.id` was undefined and this navigated
      // to `/app/notes?id=undefined`, which 404s and renders blank. TypeScript
      // could not catch it because the interface promises both fields and the
      // surface casts on the way in. Every other caller keys off `_id`.
      const nodeId = node._id ?? node.id
      if (opensInDocumentEditor(node)) navigate(`/app/notes?id=${encodeURIComponent(nodeId)}`, navigationOptions)
      else navigate(`/app/files?file=${encodeURIComponent(nodeId)}`, navigationOptions)
    },
  }
  const analytics: KnowledgeAnalyticsAdapter = {
    track(event, properties) {
      ;(options.capture ?? posthog.capture.bind(posthog))(event, properties ?? {})
    },
  }
  return {
    repository: createWebKnowledgeRepository(options.client, options.eventTarget, options.origin),
    route: options.route ?? createWebKnowledgeRouteAdapter({ eventTarget: options.eventTarget ?? undefined }),
    filePicker: options.filePicker ?? createWebFilePickerAdapter(),
    navigation,
    analytics,
  }
}
