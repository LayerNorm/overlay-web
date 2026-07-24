import type { KnowledgeFile } from './contracts'

export type KnowledgeEntityKind = 'folder' | 'note' | 'file' | 'output'
export type KnowledgeSurfaceLayout = 'list' | 'grid'
export type KnowledgeMutationStatus = 'optimistic' | 'committed' | 'failed'
export type KnowledgeUploadStatus = 'queued' | 'uploading' | 'processing' | 'complete' | 'failed'
export type KnowledgeMutationEntity = 'file' | 'note'
export type KnowledgeMutationOperation = 'created' | 'updated' | 'moved' | 'deleted'

export const KNOWLEDGE_ENTITY_MUTATION_EVENT = 'overlay:knowledge-entity-mutation'
export const KNOWLEDGE_RECONCILE_EVENT = 'overlay:knowledge-reconcile'

/** Compact cross-surface mutation payload. It intentionally contains no platform data. */
export interface KnowledgeEntityMutation {
  entity: KnowledgeMutationEntity
  id: string
  operation: KnowledgeMutationOperation
  revision: string
  origin: string
}

export type KnowledgeReconciliationReason =
  | 'missed-revision'
  | 'authentication-changed'
  | 'reconnected'
  | 'explicit-refresh'
  | 'cache-corruption'

export function isKnowledgeEntityMutation(value: unknown): value is KnowledgeEntityMutation {
  if (!value || typeof value !== 'object') return false
  const mutation = value as Partial<KnowledgeEntityMutation>
  return (mutation.entity === 'file' || mutation.entity === 'note')
    && (mutation.operation === 'created' || mutation.operation === 'updated'
      || mutation.operation === 'moved' || mutation.operation === 'deleted')
    && typeof mutation.id === 'string' && mutation.id.length > 0
    && typeof mutation.revision === 'string' && mutation.revision.length > 0
    && typeof mutation.origin === 'string' && mutation.origin.length > 0
}

export function createKnowledgeMutationPublisher(origin: string): (
  mutation: Omit<KnowledgeEntityMutation, 'origin' | 'revision'>,
) => KnowledgeEntityMutation {
  let revision = 0
  return (mutation) => ({ ...mutation, origin, revision: String(++revision) })
}

export class KnowledgeMutationRevisionTracker {
  private readonly revisions = new Map<string, number>()

  observe(mutation: KnowledgeEntityMutation): 'apply' | 'duplicate' | 'missed' {
    const next = Number(mutation.revision)
    if (!Number.isSafeInteger(next) || next < 1) return 'apply'
    const previous = this.revisions.get(mutation.origin)
    this.revisions.set(mutation.origin, Math.max(previous ?? 0, next))
    if (previous === undefined) return next === 1 ? 'apply' : 'missed'
    if (next <= previous) return 'duplicate'
    return next === previous + 1 ? 'apply' : 'missed'
  }
}

export interface KnowledgeConflictMetadata {
  localRevision: string
  remoteRevision: string
  detectedAt: number
  reason?: string
}

export interface KnowledgeRevisionMetadata {
  revision: string
  baseRevision?: string
  updatedAt: number
}

export interface KnowledgeUploadProgress {
  status: KnowledgeUploadStatus
  progress: number
  bytesSent?: number
  bytesTotal?: number
  error?: string
}

/** Normalized node used by every file-system surface. `_id` remains for compatibility. */
export interface KnowledgeSurfaceNode
  extends Omit<KnowledgeFile, 'type' | 'kind' | 'parentId'> {
  id: string
  _id: string
  type: 'file' | 'folder'
  kind: KnowledgeEntityKind
  parentId: string | null
  revision?: KnowledgeRevisionMetadata
  conflict?: KnowledgeConflictMetadata
  upload?: KnowledgeUploadProgress
  optimistic?: KnowledgeMutationStatus
}

export interface KnowledgeBreadcrumb {
  id: string
  label: string
}

export interface KnowledgeSurfaceFilter {
  kinds: readonly KnowledgeEntityKind[]
}

export interface KnowledgeSurfaceRouteState {
  folderId: string | null
  fileId: string | null
  query: string
  layout: KnowledgeSurfaceLayout
}

export interface KnowledgeSurfaceSnapshot {
  nodes: readonly KnowledgeSurfaceNode[]
  visibleNodes: readonly KnowledgeSurfaceNode[]
  currentFolder: KnowledgeSurfaceNode | null
  breadcrumbs: readonly KnowledgeBreadcrumb[]
  route: KnowledgeSurfaceRouteState
  filter: KnowledgeSurfaceFilter
  selectedIds: ReadonlySet<string>
  initialLoading: boolean
  refreshing: boolean
  error: string | null
  revision: string | null
}

export interface KnowledgeListResult {
  nodes: readonly KnowledgeSurfaceNode[]
  revision?: string | null
}

export interface KnowledgeCreateInput {
  name: string
  kind: KnowledgeEntityKind
  parentId: string | null
  content?: string
  mimeType?: string
  extension?: string
  clientId?: string
}

export interface KnowledgeRenameInput {
  id: string
  name: string
  expectedRevision?: string
}

export interface KnowledgeMoveInput {
  id: string
  parentId: string | null
  expectedRevision?: string
}

export interface KnowledgeDeleteInput {
  ids: readonly string[]
  expectedRevisions?: Readonly<Record<string, string>>
}

export interface KnowledgePickedFile {
  name: string
  sizeBytes: number
  mimeType?: string
  relativePath?: string
  read(): Promise<Uint8Array>
}

export interface KnowledgeUploadInput {
  file: KnowledgePickedFile
  parentId: string | null
  onProgress?: (progress: KnowledgeUploadProgress) => void
}

export type KnowledgeMutationEvent =
  | { type: 'created'; node: KnowledgeSurfaceNode; revision?: string }
  | { type: 'updated'; node: KnowledgeSurfaceNode; revision?: string }
  | { type: 'moved'; id: string; parentId: string | null; revision?: KnowledgeRevisionMetadata }
  | { type: 'deleted'; ids: readonly string[]; revision?: string }
  | { type: 'upload-progress'; id: string; upload: KnowledgeUploadProgress }
  | { type: 'conflict'; id: string; conflict: KnowledgeConflictMetadata }
  | { type: 'reset'; nodes: readonly KnowledgeSurfaceNode[]; revision?: string | null }

export interface KnowledgeRepository {
  list(signal?: AbortSignal): Promise<KnowledgeListResult>
  get(id: string, signal?: AbortSignal): Promise<KnowledgeSurfaceNode | null>
  create(input: KnowledgeCreateInput): Promise<KnowledgeSurfaceNode>
  rename(input: KnowledgeRenameInput): Promise<KnowledgeSurfaceNode>
  move(input: KnowledgeMoveInput): Promise<KnowledgeSurfaceNode>
  delete(input: KnowledgeDeleteInput): Promise<void>
  upload?(input: KnowledgeUploadInput): Promise<KnowledgeSurfaceNode>
  subscribe(listener: (event: KnowledgeMutationEvent) => void): () => void
}

export interface KnowledgeMutationConsumerOptions {
  origin: string
  repository: Pick<KnowledgeRepository, 'get' | 'list'>
  loadNode?(mutation: KnowledgeEntityMutation, signal: AbortSignal): Promise<KnowledgeSurfaceNode | null>
  apply(event: KnowledgeMutationEvent): void
}

/**
 * Turns compact cross-surface mutations into direct repository events. Newer
 * detail requests cancel older requests for the same entity; full list reads
 * are reserved for an observed revision gap or an explicit reconciliation.
 */
export class KnowledgeMutationConsumer {
  private readonly revisions = new KnowledgeMutationRevisionTracker()
  private readonly detailRequests = new Map<string, AbortController>()
  private reconciliation?: AbortController
  private disposed = false

  constructor(private readonly options: KnowledgeMutationConsumerOptions) {}

  async handle(mutation: KnowledgeEntityMutation): Promise<void> {
    if (this.disposed || mutation.origin === this.options.origin) return
    const observation = this.revisions.observe(mutation)
    if (observation === 'duplicate') return
    if (observation === 'missed') {
      await this.reconcile('missed-revision')
      return
    }
    if (mutation.operation === 'deleted') {
      this.detailRequests.get(mutation.id)?.abort()
      this.detailRequests.delete(mutation.id)
      this.options.apply({ type: 'deleted', ids: [mutation.id], revision: mutation.revision })
      return
    }

    this.detailRequests.get(mutation.id)?.abort()
    const request = new AbortController()
    this.detailRequests.set(mutation.id, request)
    try {
      const node = await (this.options.loadNode
        ? this.options.loadNode(mutation, request.signal)
        : this.options.repository.get(mutation.id, request.signal))
      if (request.signal.aborted || this.disposed || this.detailRequests.get(mutation.id) !== request) return
      this.options.apply(node
        ? {
            type: mutation.operation === 'created' ? 'created' : 'updated',
            node,
            revision: mutation.revision,
          }
        : { type: 'deleted', ids: [mutation.id], revision: mutation.revision })
    } catch (error) {
      if (!request.signal.aborted) throw error
    } finally {
      if (this.detailRequests.get(mutation.id) === request) this.detailRequests.delete(mutation.id)
    }
  }

  async reconcile(_reason: KnowledgeReconciliationReason): Promise<void> {
    if (this.disposed) return
    this.reconciliation?.abort()
    for (const request of this.detailRequests.values()) request.abort()
    this.detailRequests.clear()
    const request = new AbortController()
    this.reconciliation = request
    try {
      const result = await this.options.repository.list(request.signal)
      if (request.signal.aborted || this.disposed || this.reconciliation !== request) return
      this.options.apply({ type: 'reset', ...result })
    } catch (error) {
      if (!request.signal.aborted) throw error
    } finally {
      if (this.reconciliation === request) this.reconciliation = undefined
    }
  }

  dispose(): void {
    this.disposed = true
    this.reconciliation?.abort()
    for (const request of this.detailRequests.values()) request.abort()
    this.detailRequests.clear()
  }
}

export interface KnowledgeRouteAdapter {
  read(): KnowledgeSurfaceRouteState
  write(route: KnowledgeSurfaceRouteState, options?: { replace?: boolean }): void
  subscribe?(listener: (route: KnowledgeSurfaceRouteState) => void): () => void
}

export interface FilePickerAdapter {
  pickFiles(options?: { multiple?: boolean; accept?: string }): Promise<readonly KnowledgePickedFile[]>
  pickFolder?(): Promise<readonly KnowledgePickedFile[]>
}

export interface FileNavigationAdapter {
  open(node: KnowledgeSurfaceNode, options?: { replace?: boolean }): void | Promise<void>
  reveal?(node: KnowledgeSurfaceNode): void | Promise<void>
  download?(node: KnowledgeSurfaceNode): void | Promise<void>
}

export interface KnowledgeAnalyticsAdapter {
  track(event: string, properties?: Readonly<Record<string, string | number | boolean | null>>): void
}

export interface KnowledgeSurfaceAdapters {
  repository: KnowledgeRepository
  route: KnowledgeRouteAdapter
  filePicker: FilePickerAdapter
  navigation: FileNavigationAdapter
  analytics: KnowledgeAnalyticsAdapter
}

function normalizedKind(file: Pick<KnowledgeFile, 'type' | 'kind'>): KnowledgeEntityKind {
  if (file.type === 'folder' || file.kind === 'folder') return 'folder'
  if (file.kind === 'note' || file.type === 'note') return 'note'
  if (file.kind === 'output' || file.type === 'output') return 'output'
  return 'file'
}

export function normalizeKnowledgeSurfaceNode(
  file: KnowledgeFile | KnowledgeSurfaceNode,
): KnowledgeSurfaceNode {
  const kind = normalizedKind(file)
  const id = 'id' in file && typeof file.id === 'string' ? file.id : file._id
  return {
    ...file,
    id,
    _id: file._id || id,
    type: kind === 'folder' ? 'folder' : 'file',
    kind,
    parentId: file.parentId ?? null,
    name: file.name || 'Untitled',
    createdAt: Number.isFinite(file.createdAt) ? file.createdAt : 0,
    updatedAt: Number.isFinite(file.updatedAt) ? file.updatedAt : file.createdAt || 0,
  }
}

export function buildKnowledgeBreadcrumbs(
  nodes: readonly KnowledgeSurfaceNode[],
  folderId: string | null,
): KnowledgeBreadcrumb[] {
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const path: KnowledgeBreadcrumb[] = []
  const visited = new Set<string>()
  let currentId = folderId
  while (currentId && !visited.has(currentId)) {
    visited.add(currentId)
    const node = byId.get(currentId)
    if (!node || node.kind !== 'folder') break
    path.unshift({ id: node.id, label: node.name })
    currentId = node.parentId
  }
  return path
}

export function filterKnowledgeSurfaceNodes(
  nodes: readonly KnowledgeSurfaceNode[],
  route: Pick<KnowledgeSurfaceRouteState, 'folderId' | 'query'>,
  filter: KnowledgeSurfaceFilter,
): KnowledgeSurfaceNode[] {
  const query = route.query.trim().toLocaleLowerCase()
  const allowedKinds = new Set(filter.kinds)
  const visible = nodes.filter((node) => {
    if (!allowedKinds.has(node.kind)) return false
    if (query) return node.name.toLocaleLowerCase().includes(query)
    return node.parentId === route.folderId
  })
  return visible.sort((left, right) => {
    if (left.kind === 'folder' && right.kind !== 'folder') return -1
    if (left.kind !== 'folder' && right.kind === 'folder') return 1
    return query
      ? left.name.localeCompare(right.name)
      : right.updatedAt - left.updatedAt || left.name.localeCompare(right.name)
  })
}

export function canMoveKnowledgeSurfaceNode(
  nodes: readonly Pick<KnowledgeSurfaceNode, 'id' | 'parentId'>[],
  id: string,
  parentId: string | null,
): boolean {
  if (id === parentId) return false
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const visited = new Set<string>()
  let currentId = parentId
  while (currentId && !visited.has(currentId)) {
    if (currentId === id) return false
    visited.add(currentId)
    currentId = byId.get(currentId)?.parentId ?? null
  }
  return true
}

const DEFAULT_ROUTE: KnowledgeSurfaceRouteState = {
  folderId: null,
  fileId: null,
  query: '',
  layout: 'list',
}

const DEFAULT_FILTER: KnowledgeSurfaceFilter = {
  kinds: ['folder', 'note', 'file', 'output'],
}

export class KnowledgeSurfaceController {
  private nodes: KnowledgeSurfaceNode[] = []
  private routeState: KnowledgeSurfaceRouteState
  private filterState: KnowledgeSurfaceFilter = DEFAULT_FILTER
  private selected = new Set<string>()
  private initialLoading = false
  private refreshing = false
  private error: string | null = null
  private revision: string | null = null
  private initialized = false
  private listeners = new Set<() => void>()
  private repositoryCleanup?: () => void
  private routeCleanup?: () => void
  private refreshRequest?: AbortController
  private snapshot: KnowledgeSurfaceSnapshot

  constructor(private readonly adapters: KnowledgeSurfaceAdapters) {
    this.routeState = { ...DEFAULT_ROUTE, ...adapters.route.read() }
    this.snapshot = this.buildSnapshot()
    this.repositoryCleanup = adapters.repository.subscribe((event) => this.applyEvent(event))
    this.routeCleanup = adapters.route.subscribe?.((route) => {
      this.routeState = { ...route }
      this.emit()
    })
  }

  getSnapshot = (): KnowledgeSurfaceSnapshot => this.snapshot

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  async initialize(): Promise<void> {
    if (this.initialized) return
    await this.refresh()
    this.initialized = true
  }

  async refresh(): Promise<void> {
    this.refreshRequest?.abort()
    const request = new AbortController()
    this.refreshRequest = request
    const isInitial = !this.initialized && this.nodes.length === 0
    this.initialLoading = isInitial
    this.refreshing = !isInitial
    this.error = null
    this.emit()
    try {
      const result = await this.adapters.repository.list(request.signal)
      if (request.signal.aborted || this.refreshRequest !== request) return
      this.nodes = result.nodes.map(normalizeKnowledgeSurfaceNode)
      this.revision = result.revision ?? this.revision
    } catch (error) {
      if (request.signal.aborted || this.refreshRequest !== request) return
      this.error = error instanceof Error ? error.message : String(error)
    } finally {
      if (request.signal.aborted || this.refreshRequest !== request) return
      this.refreshRequest = undefined
      this.initialLoading = false
      this.refreshing = false
      this.initialized = true
      this.emit()
    }
  }

  setSearch(query: string): void {
    this.writeRoute({ ...this.routeState, query })
  }

  setLayout(layout: KnowledgeSurfaceLayout): void {
    this.writeRoute({ ...this.routeState, layout })
  }

  openFolder(folderId: string | null): void {
    this.selected.clear()
    this.writeRoute({ ...this.routeState, folderId, fileId: null })
  }

  setFilter(filter: KnowledgeSurfaceFilter): void {
    this.filterState = { kinds: [...filter.kinds] }
    this.selected = new Set([...this.selected].filter((id) => this.nodes.some((node) => node.id === id)))
    this.emit()
  }

  toggleSelection(id: string): void {
    if (this.selected.has(id)) this.selected.delete(id)
    else this.selected.add(id)
    this.emit()
  }

  selectVisible(): void {
    this.selected = new Set(this.snapshot.visibleNodes.map((node) => node.id))
    this.emit()
  }

  clearSelection(): void {
    if (this.selected.size === 0) return
    this.selected.clear()
    this.emit()
  }

  async create(input: KnowledgeCreateInput): Promise<KnowledgeSurfaceNode> {
    const optimisticId = `optimistic:${input.clientId ?? `${Date.now()}:${input.name}`}`
    const optimistic = normalizeKnowledgeSurfaceNode({
      _id: optimisticId,
      clientId: input.clientId,
      name: input.name,
      type: input.kind === 'folder' ? 'folder' : 'file',
      kind: input.kind,
      parentId: input.parentId,
      content: input.content,
      mimeType: input.mimeType,
      extension: input.extension,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      optimistic: 'optimistic',
    } as KnowledgeSurfaceNode)
    this.nodes = [...this.nodes, optimistic]
    this.emit()
    try {
      const created = normalizeKnowledgeSurfaceNode(await this.adapters.repository.create(input))
      this.nodes = [
        ...this.nodes.filter((node) => node.id !== optimisticId && node.id !== created.id),
        created,
      ]
      this.adapters.analytics.track('knowledge_created', { id: created.id, kind: created.kind })
      this.emit()
      return created
    } catch (error) {
      this.nodes = this.nodes.filter((node) => node.id !== optimisticId)
      this.emit()
      throw error
    }
  }

  async rename(id: string, name: string): Promise<void> {
    const previous = this.nodes.find((node) => node.id === id)
    if (!previous) return
    this.replaceNode({ ...previous, name, optimistic: 'optimistic' })
    try {
      const updated = await this.adapters.repository.rename({
        id,
        name,
        expectedRevision: previous.revision?.revision,
      })
      this.replaceNode(normalizeKnowledgeSurfaceNode(updated))
      this.adapters.analytics.track('knowledge_renamed', { id, kind: previous.kind })
    } catch (error) {
      this.replaceNode(previous)
      throw error
    }
  }

  async move(id: string, parentId: string | null): Promise<void> {
    if (!canMoveKnowledgeSurfaceNode(this.nodes, id, parentId)) return
    const previous = this.nodes.find((node) => node.id === id)
    if (!previous) return
    this.replaceNode({ ...previous, parentId, optimistic: 'optimistic' })
    try {
      const updated = await this.adapters.repository.move({
        id,
        parentId,
        expectedRevision: previous.revision?.revision,
      })
      this.replaceNode(normalizeKnowledgeSurfaceNode(updated))
      this.adapters.analytics.track('knowledge_moved', { id, kind: previous.kind })
    } catch (error) {
      this.replaceNode(previous)
      throw error
    }
  }

  async delete(ids: readonly string[]): Promise<void> {
    const deleted = new Set(ids)
    let changed = true
    while (changed) {
      changed = false
      for (const node of this.nodes) {
        if (node.parentId && deleted.has(node.parentId) && !deleted.has(node.id)) {
          deleted.add(node.id)
          changed = true
        }
      }
    }
    const previous = this.nodes
    this.nodes = previous.filter((node) => !deleted.has(node.id))
    this.selected = new Set([...this.selected].filter((id) => !deleted.has(id)))
    this.emit()
    try {
      await this.adapters.repository.delete({
        ids,
        expectedRevisions: Object.fromEntries(
          previous
            .filter((node) => ids.includes(node.id) && node.revision)
            .map((node) => [node.id, node.revision!.revision]),
        ),
      })
      this.adapters.analytics.track('knowledge_deleted', { count: ids.length })
    } catch (error) {
      this.nodes = previous
      this.emit()
      throw error
    }
  }

  applyEvent(event: KnowledgeMutationEvent): void {
    if (event.type === 'reset') {
      this.nodes = event.nodes.map(normalizeKnowledgeSurfaceNode)
      this.revision = event.revision ?? this.revision
    } else if (event.type === 'created' || event.type === 'updated') {
      const node = normalizeKnowledgeSurfaceNode(event.node)
      const exists = this.nodes.some((candidate) => candidate.id === node.id)
      this.nodes = exists
        ? this.nodes.map((candidate) => candidate.id === node.id ? node : candidate)
        : [...this.nodes, node]
      this.revision = event.revision ?? this.revision
    } else if (event.type === 'moved') {
      this.nodes = this.nodes.map((node) => node.id === event.id
        ? { ...node, parentId: event.parentId, revision: event.revision ?? node.revision }
        : node)
    } else if (event.type === 'deleted') {
      const deleted = new Set(event.ids)
      this.nodes = this.nodes.filter((node) => !deleted.has(node.id))
      this.selected = new Set([...this.selected].filter((id) => !deleted.has(id)))
      this.revision = event.revision ?? this.revision
    } else if (event.type === 'upload-progress') {
      this.nodes = this.nodes.map((node) => node.id === event.id ? { ...node, upload: event.upload } : node)
    } else if (event.type === 'conflict') {
      this.nodes = this.nodes.map((node) => node.id === event.id ? { ...node, conflict: event.conflict } : node)
    }
    this.emit()
  }

  dispose(): void {
    this.refreshRequest?.abort()
    this.repositoryCleanup?.()
    this.routeCleanup?.()
    this.listeners.clear()
  }

  private replaceNode(node: KnowledgeSurfaceNode): void {
    this.nodes = this.nodes.map((candidate) => candidate.id === node.id ? node : candidate)
    this.emit()
  }

  private writeRoute(route: KnowledgeSurfaceRouteState): void {
    this.routeState = route
    this.adapters.route.write(route)
    this.emit()
  }

  private buildSnapshot(): KnowledgeSurfaceSnapshot {
    const currentFolder = this.routeState.folderId
      ? this.nodes.find((node) => node.id === this.routeState.folderId && node.kind === 'folder') ?? null
      : null
    return {
      nodes: this.nodes,
      visibleNodes: filterKnowledgeSurfaceNodes(this.nodes, this.routeState, this.filterState),
      currentFolder,
      breadcrumbs: buildKnowledgeBreadcrumbs(this.nodes, currentFolder?.id ?? null),
      route: this.routeState,
      filter: this.filterState,
      selectedIds: this.selected,
      initialLoading: this.initialLoading,
      refreshing: this.refreshing,
      error: this.error,
      revision: this.revision,
    }
  }

  private emit(): void {
    this.snapshot = this.buildSnapshot()
    for (const listener of this.listeners) listener()
  }
}
