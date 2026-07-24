import type { CreateMemoryRequest, KnowledgeFile, MemoryRow } from './contracts'

export type KnowledgeTab = 'memories' | 'files' | 'outputs'
export type KnowledgeLayout = 'list' | 'cards'
export type KnowledgeOutputFilter = 'all' | 'image' | 'video' | 'files'

export interface KnowledgeFileNode extends KnowledgeFile {
  type: 'file' | 'folder'
}

export const IMPORT_MEMORY_PROMPT =
  "Export all of my stored memories and any context you've learned about me from past conversations. Preserve my words verbatim where possible, especially for instructions and preferences."

export const FILES_CHANGED_EVENT = 'overlay:files-changed'

export const OUTPUT_FILTER_LABELS: Record<KnowledgeOutputFilter, string> = {
  all: 'All',
  image: 'Image',
  video: 'Video',
  files: 'Files',
}

export function resolveKnowledgeTab({
  mode,
  view,
}: {
  mode: 'knowledge' | 'files'
  view: string | null | undefined
}): KnowledgeTab {
  if (mode === 'files') return 'files'
  if (view === 'files') return 'files'
  if (view === 'outputs') return 'outputs'
  return 'memories'
}

export function resolveKnowledgeLayout({
  layout,
  activeTab,
}: {
  layout: string | null | undefined
  activeTab: KnowledgeTab
}): KnowledgeLayout {
  if (layout === 'cards' || layout === 'list') return layout
  return activeTab === 'outputs' ? 'cards' : 'list'
}

export function resolveKnowledgeOutputFilter(value: string | null | undefined): KnowledgeOutputFilter {
  if (value === 'image' || value === 'video' || value === 'files') return value
  return 'all'
}

export function knowledgePendingPreview(text: string, maxLength = 160): string {
  const trimmed = text.trim()
  return trimmed.length > maxLength ? `${trimmed.slice(0, maxLength)}…` : trimmed
}

export function createManualMemoryRequest(content: string): CreateMemoryRequest {
  return {
    content,
    source: 'manual',
    type: 'fact',
    importance: 3,
    actor: 'user',
  }
}

export function opensInDocumentEditor(file: Pick<KnowledgeFile, 'kind' | 'extension' | 'mimeType' | 'name'>): boolean {
  if (file.kind === 'note') return true
  const ext = (file.extension || file.name.split('.').pop() || '').toLowerCase()
  const mime = (file.mimeType || '').toLowerCase()
  return ext === 'md' || ext === 'markdown' || ext === 'txt' || mime === 'text/markdown' || mime.startsWith('text/')
}

export function filePathLabel(all: readonly Pick<KnowledgeFile, '_id' | 'name' | 'parentId'>[], file: Pick<KnowledgeFile, 'parentId'>): string {
  const parts: string[] = []
  let pid: string | null = file.parentId
  while (pid) {
    const parent = all.find((item) => item._id === pid)
    if (!parent) break
    parts.unshift(parent.name)
    pid = parent.parentId
  }
  return parts.length ? parts.join(' / ') : 'Library'
}

export function filterKnowledgeFileNodes(files: readonly KnowledgeFileNode[], query: string): KnowledgeFileNode[] {
  const q = query.trim().toLowerCase()
  if (!q) return [...files]
  const keep = new Set<string>()
  for (const node of files) {
    if (node.name.toLowerCase().includes(q)) {
      keep.add(node._id)
      let parentId = node.parentId
      while (parentId) {
        keep.add(parentId)
        parentId = files.find((item) => item._id === parentId)?.parentId ?? null
      }
    }
  }
  return files.filter((file) => keep.has(file._id))
}

export function filterMemoryRows(memories: readonly MemoryRow[], query: string): MemoryRow[] {
  const q = query.trim().toLowerCase()
  if (!q) return [...memories]
  return memories.filter(
    (memory) => memory.fullContent.toLowerCase().includes(q) || memory.content.toLowerCase().includes(q),
  )
}

export function folderBreadcrumb(
  files: readonly KnowledgeFileNode[],
  activeFolder: KnowledgeFileNode | null,
): KnowledgeFileNode[] {
  const path: KnowledgeFileNode[] = []
  let current: KnowledgeFileNode | null = activeFolder
  while (current) {
    path.unshift(current)
    current = current.parentId ? (files.find((file) => file._id === current!.parentId) ?? null) : null
  }
  return path
}

export function sortedCurrentFolderNodes(
  files: readonly KnowledgeFileNode[],
  currentParentId: string | null,
): KnowledgeFileNode[] {
  return files
    .filter((file) => file.parentId === currentParentId)
    .sort((a, b) => {
      if (a.type !== b.type) return a.type === 'folder' ? -1 : 1
      return a.name.localeCompare(b.name)
    })
}

export function sortedCurrentFolderFiles(
  files: readonly KnowledgeFileNode[],
  currentParentId: string | null,
): KnowledgeFileNode[] {
  return files
    .filter((file) => file.parentId === currentParentId && file.type === 'file')
    .sort((a, b) => b.updatedAt - a.updatedAt)
}

export function sortedCurrentFolderFolders(
  files: readonly KnowledgeFileNode[],
  currentParentId: string | null,
): KnowledgeFileNode[] {
  return files
    .filter((file) => file.parentId === currentParentId && file.type === 'folder')
    .sort((a, b) => a.name.localeCompare(b.name))
}

export function collectKnowledgeFileSubtreeIds(
  files: readonly Pick<KnowledgeFileNode, '_id' | 'parentId'>[],
  rootIds: readonly string[],
): Set<string> {
  const deletedIds = new Set(rootIds)
  let changed = true

  while (changed) {
    changed = false
    for (const file of files) {
      if (file.parentId && deletedIds.has(file.parentId) && !deletedIds.has(file._id)) {
        deletedIds.add(file._id)
        changed = true
      }
    }
  }

  return deletedIds
}

export function removeKnowledgeFileSubtrees<T extends Pick<KnowledgeFileNode, '_id' | 'parentId'>>(
  files: readonly T[],
  rootIds: readonly string[],
): T[] {
  const deletedIds = collectKnowledgeFileSubtreeIds(files, rootIds)
  return files.filter((file) => !deletedIds.has(file._id))
}

export function canMoveKnowledgeFile(
  files: readonly Pick<KnowledgeFileNode, '_id' | 'parentId'>[],
  fileId: string,
  parentId: string | null,
): boolean {
  if (fileId === parentId) return false
  if (!parentId) return true
  let current: string | null = parentId
  while (current) {
    if (current === fileId) return false
    current = files.find((file) => file._id === current)?.parentId ?? null
  }
  return true
}
