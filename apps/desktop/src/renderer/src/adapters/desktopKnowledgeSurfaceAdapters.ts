import {
  KNOWLEDGE_ENTITY_MUTATION_EVENT,
  KNOWLEDGE_RECONCILE_EVENT,
  KnowledgeMutationConsumer,
  createKnowledgeMutationPublisher,
  isKnowledgeEntityMutation,
  normalizeKnowledgeSurfaceNode,
  noteDocToKnowledgeFile,
  type CreateFileRequest,
  type FileNavigationAdapter,
  type FilePickerAdapter,
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
  type NoteDoc,
  type UpdateFileRequest
} from '@overlay/app-core'
import { overlayDesktopAppClient } from '../services/app-api-client'
import { getAuthReadyState } from '../services/auth-service'
import { registerMigratedNoteMappings } from '../services/desktop-sync-service'

interface DesktopFilesClientLike {
  get<T>(query?: { limit?: number }, options?: { signal?: AbortSignal }): Promise<T>
  getResponse(query: { fileId: string }, options?: { signal?: AbortSignal }): Promise<Response>
  createResponse(input: CreateFileRequest): Promise<Response>
  updateResponse(input: UpdateFileRequest): Promise<Response>
  deleteResponse(input: { fileId: string }): Promise<Response>
  contentResponse?(fileId: string): Promise<Response>
}

interface DesktopNotesClientLike {
  get<T>(query?: { limit?: number; noteId?: string }, options?: { signal?: AbortSignal }): Promise<T>
  deleteResponse(input: { noteId: string }): Promise<Response>
}

export interface DesktopKnowledgeAppClient {
  files: DesktopFilesClientLike
  notes: DesktopNotesClientLike
}

type KnowledgeEventTarget = Pick<Window, 'addEventListener' | 'removeEventListener'>
  & Partial<Pick<Window, 'dispatchEvent'>>

export interface DesktopNoteReplicaPort {
  ensure(node: KnowledgeSurfaceNode): Promise<string>
  remove(node: KnowledgeSurfaceNode): Promise<void>
  subscribe(listener: (notes: readonly { id: string; title: string; updatedAt: number }[]) => void): () => void
}

async function responseError(response: Response, fallback: string): Promise<Error> {
  const body = (await response.json().catch(() => null)) as
    | { error?: string; message?: string }
    | null
  return new Error(body?.message || body?.error || fallback)
}

async function createdNode(
  response: Response,
  input: KnowledgeCreateInput
): Promise<KnowledgeSurfaceNode> {
  if (!response.ok) throw await responseError(response, 'Knowledge mutation failed')
  const body = (await response.json()) as { id?: string; file?: KnowledgeFile | null }
  if (body.file) return normalizeKnowledgeSurfaceNode(body.file)
  if (!body.id) throw new Error('Knowledge mutation returned no file identifier')
  const now = Date.now()
  return normalizeKnowledgeSurfaceNode({
    _id: body.id,
    clientId: input.clientId,
    name: input.name,
    type: input.kind === 'folder' ? 'folder' : 'file',
    kind: input.kind,
    parentId: input.parentId,
    content: input.content,
    mimeType: input.mimeType,
    extension: input.extension,
    createdAt: now,
    updatedAt: now
  })
}

export function createDesktopKnowledgeRepository(
  client: DesktopKnowledgeAppClient = overlayDesktopAppClient,
  eventTarget: KnowledgeEventTarget | null | undefined =
    typeof window === 'undefined' ? undefined : window,
  noteReplicas?: DesktopNoteReplicaPort,
  origin = `desktop:${globalThis.crypto?.randomUUID?.() ?? Date.now()}`,
): KnowledgeRepository {
  const listeners = new Set<(event: KnowledgeMutationEvent) => void>()
  const byId = new Map<string, KnowledgeSurfaceNode>()
  let externalCleanup: (() => void) | undefined
  let noteCleanup: (() => void) | undefined
  const nextMutation = createKnowledgeMutationPublisher(origin)

  function emit(event: KnowledgeMutationEvent): void {
    for (const listener of listeners) listener(event)
  }

  function publish(mutation: Omit<KnowledgeEntityMutation, 'origin' | 'revision'>): void {
    if (!eventTarget?.dispatchEvent || typeof CustomEvent === 'undefined') return
    eventTarget.dispatchEvent(new CustomEvent(KNOWLEDGE_ENTITY_MUTATION_EVENT, {
      detail: nextMutation(mutation)
    }))
  }

  async function list(signal?: AbortSignal): Promise<{ nodes: KnowledgeSurfaceNode[]; revision: string }> {
    const [fileRows, noteRows] = await Promise.all([
      client.files.get<KnowledgeFile[]>({ limit: 100 }, { signal }),
      client.notes.get<NoteDoc[]>({ limit: 100 }, { signal })
    ])
    const files = Array.isArray(fileRows) ? fileRows : []
    const notes = Array.isArray(noteRows) ? noteRows.map(noteDocToKnowledgeFile) : []
    const canonicalIds = new Set(files.map((file) => file._id))
    const nodes = [...files, ...notes.filter((note) => !canonicalIds.has(note._id))].map(
      normalizeKnowledgeSurfaceNode
    )
    byId.clear()
    for (const node of nodes) byId.set(node.id, node)
    return {
      nodes,
      revision: String(nodes.reduce((latest, node) => Math.max(latest, node.updatedAt), 0))
    }
  }

  const repository: KnowledgeRepository = {
    list,
    async get(id, signal) {
      const response = await client.files.getResponse({ fileId: id }, { signal })
      if (response.status === 404) return null
      if (!response.ok) throw await responseError(response, 'Could not load file')
      const node = normalizeKnowledgeSurfaceNode((await response.json()) as KnowledgeFile)
      byId.set(node.id, node)
      return node
    },
    async create(input) {
      const requestInput = input.kind === 'note' && !input.clientId
        ? { ...input, clientId: `desktop-note-${crypto.randomUUID()}` }
        : input
      const node = await createdNode(
        await client.files.createResponse({
          name: requestInput.name,
          type: requestInput.kind === 'folder' ? 'folder' : 'file',
          kind: requestInput.kind === 'file' ? 'upload' : requestInput.kind,
          parentId: requestInput.parentId,
          content: requestInput.content,
          textContent: requestInput.kind === 'note' ? requestInput.content ?? '' : undefined,
          mimeType: requestInput.mimeType,
          extension: requestInput.extension,
          clientId: requestInput.clientId
        }),
        requestInput
      )
      byId.set(node.id, node)
      if (node.kind === 'note') await noteReplicas?.ensure(node)
      emit({ type: 'created', node })
      publish({ entity: node.kind === 'note' ? 'note' : 'file', id: node.id, operation: 'created' })
      return node
    },
    async rename(input: KnowledgeRenameInput) {
      const response = await client.files.updateResponse({ fileId: input.id, name: input.name })
      if (!response.ok) throw await responseError(response, 'Could not rename file')
      const current = byId.get(input.id) ?? (await repository.get(input.id))
      if (!current) throw new Error(`Knowledge node ${input.id} was not found`)
      const node = { ...current, name: input.name, updatedAt: Date.now() }
      byId.set(node.id, node)
      if (node.kind === 'note') await noteReplicas?.ensure(node)
      emit({ type: 'updated', node })
      publish({ entity: node.kind === 'note' ? 'note' : 'file', id: node.id, operation: 'updated' })
      return node
    },
    async move(input: KnowledgeMoveInput) {
      const response = await client.files.updateResponse({
        fileId: input.id,
        parentId: input.parentId
      })
      if (!response.ok) throw await responseError(response, 'Could not move file')
      const current = byId.get(input.id) ?? (await repository.get(input.id))
      if (!current) throw new Error(`Knowledge node ${input.id} was not found`)
      const node = { ...current, parentId: input.parentId, updatedAt: Date.now() }
      byId.set(node.id, node)
      emit({ type: 'moved', id: node.id, parentId: node.parentId, revision: node.revision })
      publish({ entity: node.kind === 'note' ? 'note' : 'file', id: node.id, operation: 'moved' })
      return node
    },
    async delete(input: KnowledgeDeleteInput) {
      for (const id of input.ids) {
        const node = byId.get(id) ?? (await repository.get(id))
        const response =
          node?.kind === 'note'
            ? await client.notes.deleteResponse({ noteId: id })
            : await client.files.deleteResponse({ fileId: id })
        if (!response.ok) throw await responseError(response, 'Could not delete file')
        if (node?.kind === 'note') await noteReplicas?.remove(node)
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
        const handleMutation = (event: Event): void => {
          const mutation = (event as CustomEvent<unknown>).detail
          if (isKnowledgeEntityMutation(mutation)) void consumer.handle(mutation).catch(() => undefined)
        }
        const handleReconcile = (event: Event): void => {
          if (getAuthReadyState() !== true) return
          const reason = (event as CustomEvent<{ reason?: string }>).detail?.reason
          const normalized = reason === 'authentication-changed' || reason === 'cache-corruption'
            ? reason
            : 'explicit-refresh'
          void consumer.reconcile(normalized).catch(() => undefined)
        }
        const handleOnline = (): void => {
          if (getAuthReadyState() !== true) return
          void consumer.reconcile('reconnected').catch(() => undefined)
        }
        const handleAuthenticationChange = (event: Event): void => {
          if ((event as CustomEvent<{ authed?: boolean }>).detail?.authed !== true) return
          void consumer.reconcile('authentication-changed').catch(() => undefined)
        }
        eventTarget.addEventListener(KNOWLEDGE_ENTITY_MUTATION_EVENT, handleMutation)
        eventTarget.addEventListener(KNOWLEDGE_RECONCILE_EVENT, handleReconcile)
        eventTarget.addEventListener('online', handleOnline)
        eventTarget.addEventListener('overlay:auth-ready', handleAuthenticationChange)
        eventTarget.addEventListener('overlay:knowledge-authority-changed', handleAuthenticationChange)
        externalCleanup = () => {
          consumer.dispose()
          eventTarget.removeEventListener(KNOWLEDGE_ENTITY_MUTATION_EVENT, handleMutation)
          eventTarget.removeEventListener(KNOWLEDGE_RECONCILE_EVENT, handleReconcile)
          eventTarget.removeEventListener('online', handleOnline)
          eventTarget.removeEventListener('overlay:auth-ready', handleAuthenticationChange)
          eventTarget.removeEventListener('overlay:knowledge-authority-changed', handleAuthenticationChange)
        }
      }
      if (listeners.size === 1 && noteReplicas) {
        noteCleanup = noteReplicas.subscribe((notes) => {
            const noteById = new Map(notes.map((note) => [note.id, note]))
            for (const node of byId.values()) {
              if (node.kind !== 'note') continue
              const local = noteById.get(node.clientId ?? `note-remote-${node.id}`)
              if (!local || (local.title === node.name && local.updatedAt <= node.updatedAt)) continue
              const updated = { ...node, name: local.title || 'Untitled', updatedAt: local.updatedAt }
              byId.set(updated.id, updated)
              emit({ type: 'updated', node: updated })
              publish({ entity: 'note', id: updated.id, operation: 'updated' })
            }
          })
      }
      return () => {
        listeners.delete(listener)
        if (listeners.size === 0) {
          externalCleanup?.()
          externalCleanup = undefined
          noteCleanup?.()
          noteCleanup = undefined
        }
      }
    }
  }
  return repository
}

function routeFromLocation(location: Pick<Location, 'href'>): KnowledgeSurfaceRouteState {
  const url = new URL(location.href)
  const layout = url.searchParams.get('layout')
  return {
    folderId: url.searchParams.get('folder'),
    fileId: url.searchParams.get('file'),
    query: url.searchParams.get('q') ?? '',
    layout: layout === 'cards' || layout === 'grid' ? 'grid' : 'list'
  }
}

export function createDesktopKnowledgeRouteAdapter(options: {
  location?: Pick<Location, 'href'>
  navigate?: (url: string, replace: boolean) => void
  eventTarget?: Pick<Window, 'addEventListener' | 'removeEventListener'>
} = {}): KnowledgeRouteAdapter {
  const location = options.location ?? window.location
  const navigate =
    options.navigate ??
    ((url: string, replace: boolean) =>
      window.history[replace ? 'replaceState' : 'pushState'](null, '', url))
  return {
    read: () => routeFromLocation(location),
    write(route, writeOptions) {
      const url = new URL(location.href)
      const values: Array<[string, string | null]> = [
        ['folder', route.folderId],
        ['file', route.fileId],
        ['q', route.query || null],
        ['layout', route.layout === 'grid' ? 'cards' : 'list']
      ]
      for (const [key, value] of values) {
        if (value) url.searchParams.set(key, value)
        else url.searchParams.delete(key)
      }
      navigate(`${url.pathname}${url.search}${url.hash}`, Boolean(writeOptions?.replace))
    },
    subscribe(listener) {
      const target = options.eventTarget ?? window
      const handleChange = (): void => listener(routeFromLocation(location))
      target.addEventListener('popstate', handleChange)
      return () => target.removeEventListener('popstate', handleChange)
    }
  }
}

function pickedFile(file: File): KnowledgePickedFile {
  return {
    name: file.name,
    sizeBytes: file.size,
    mimeType: file.type || undefined,
    relativePath: file.webkitRelativePath || undefined,
    async read() {
      return new Uint8Array(await file.arrayBuffer())
    }
  }
}

function bytesFromBase64(value: string): Uint8Array {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}

export function createDesktopNativeFilePickerAdapter(): FilePickerAdapter {
  if (typeof window === 'undefined' || !window.bridge?.knowledgeFiles) return createDesktopFilePickerAdapter()
  const pick = async (options: { multiple?: boolean; directory?: boolean }) => {
    const selected = await window.bridge.knowledgeFiles.pick(options)
    return selected.map((file): KnowledgePickedFile => ({
      name: file.name,
      sizeBytes: file.sizeBytes,
      mimeType: file.mimeType,
      relativePath: file.relativePath,
      async read() {
        return bytesFromBase64((await window.bridge.knowledgeFiles.readPicked(file.token)).dataBase64)
      }
    }))
  }
  return {
    pickFiles: (options) => pick({ multiple: options?.multiple }),
    pickFolder: () => pick({ directory: true })
  }
}

export function createDesktopNoteReplicaPort(): DesktopNoteReplicaPort | undefined {
  if (typeof window === 'undefined' || !window.bridge?.loadNotes) return undefined
  return {
    async ensure(node) {
      const localId = node.clientId ?? `note-remote-${node.id}`
      const existing = await window.bridge.loadNote(localId)
      if (!existing || existing.updatedAt <= node.updatedAt) {
        await window.bridge.saveNote({
          id: localId,
          title: node.name || existing?.title || 'Untitled',
          content: node.textContent ?? node.content ?? existing?.content ?? '',
          updatedAt: node.updatedAt
        })
      }
      registerMigratedNoteMappings({
        [localId]: { remoteId: node.id, updatedAt: node.updatedAt }
      })
      return localId
    },
    async remove(node) {
      await window.bridge.deleteNote(node.clientId ?? `note-remote-${node.id}`)
    },
    subscribe(listener) {
      const publish = (): void => {
        void window.bridge.loadNotes().then(listener)
      }
      return window.bridge.onNotesChanged(publish)
    }
  }
}

function pickFromRenderer(options: {
  multiple?: boolean
  accept?: string
  directory?: boolean
}): Promise<readonly KnowledgePickedFile[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.multiple = Boolean(options.multiple || options.directory)
    input.accept = options.accept ?? ''
    if (options.directory) input.setAttribute('webkitdirectory', '')
    input.addEventListener(
      'change',
      () => resolve(Array.from(input.files ?? []).map(pickedFile)),
      { once: true }
    )
    input.addEventListener('cancel', () => resolve([]), { once: true })
    input.click()
  })
}

export function createDesktopFilePickerAdapter(
  picker: typeof pickFromRenderer = pickFromRenderer
): FilePickerAdapter {
  return {
    pickFiles: (options) => picker(options ?? {}),
    pickFolder: () => picker({ directory: true, multiple: true })
  }
}

export function createDesktopKnowledgeSurfaceAdapters(options: {
  client?: DesktopKnowledgeAppClient
  route?: KnowledgeRouteAdapter
  filePicker?: FilePickerAdapter
  onOpenNote?: (localId: string, node: KnowledgeSurfaceNode) => void
  onOpenOutput?: (id: string, node: KnowledgeSurfaceNode) => void
  onOpenFile?: (id: string, node: KnowledgeSurfaceNode) => void
  capture?: (event: string, properties?: Record<string, unknown>) => void
  eventTarget?: KnowledgeEventTarget | null
  noteReplicas?: DesktopNoteReplicaPort
  origin?: string
} = {}): KnowledgeSurfaceAdapters {
  const noteReplicas = options.noteReplicas ?? createDesktopNoteReplicaPort()
  const repository = createDesktopKnowledgeRepository(
    options.client,
    options.eventTarget,
    noteReplicas,
    options.origin,
  )
  const navigation: FileNavigationAdapter = {
    async open(node) {
      if (node.kind === 'note') {
        const resolved = await repository.get(node.id) ?? node
        const localId = await noteReplicas?.ensure(resolved) ?? resolved.clientId ?? `note-remote-${resolved.id}`
        options.onOpenNote?.(localId, resolved)
      }
      else if (node.kind === 'output') options.onOpenOutput?.(node.id, node)
      else options.onOpenFile?.(node.id, node)
    },
    async reveal(node) {
      if (typeof window === 'undefined' || !window.bridge?.knowledgeFiles) return
      const response = await options.client?.files.contentResponse?.(node.id)
        ?? await overlayDesktopAppClient.files.contentResponse(node.id)
      if (!response.ok) throw await responseError(response, 'Could not download file for Finder')
      const bytes = new Uint8Array(await response.arrayBuffer())
      let binary = ''
      for (const byte of bytes) binary += String.fromCharCode(byte)
      await window.bridge.knowledgeFiles.revealDownloaded({ name: node.name, dataBase64: btoa(binary) })
    }
  }
  const analytics: KnowledgeAnalyticsAdapter = {
    track(event, properties) {
      options.capture?.(event, properties ?? {})
    }
  }
  return {
    repository,
    route: options.route ?? createDesktopKnowledgeRouteAdapter({ eventTarget: options.eventTarget ?? undefined }),
    filePicker: options.filePicker ?? createDesktopNativeFilePickerAdapter(),
    navigation,
    analytics
  }
}
