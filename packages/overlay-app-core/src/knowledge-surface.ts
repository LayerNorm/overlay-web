import type { KnowledgeFile } from './contracts'

export type KnowledgeEntityKind = 'folder' | 'note' | 'file' | 'output'
export type KnowledgeSurfaceLayout = 'list' | 'grid'
export type KnowledgeMutationStatus = 'optimistic' | 'committed' | 'failed'
export type KnowledgeUploadStatus = 'queued' | 'uploading' | 'processing' | 'complete' | 'failed'
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

/** File commands and one-file reads. Lists are the host's live subscription, passed to the surface directly. */
export interface KnowledgeRepository {
  get(id: string, signal?: AbortSignal): Promise<KnowledgeSurfaceNode | null>
  create(input: KnowledgeCreateInput): Promise<KnowledgeSurfaceNode>
  rename(input: KnowledgeRenameInput): Promise<KnowledgeSurfaceNode>
  move(input: KnowledgeMoveInput): Promise<KnowledgeSurfaceNode>
  delete(input: KnowledgeDeleteInput): Promise<void>
  upload?(input: KnowledgeUploadInput): Promise<KnowledgeSurfaceNode>
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
