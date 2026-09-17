import type { KnowledgeFile } from './contracts'
import { canMoveKnowledgeFile, opensInDocumentEditor } from './knowledge'

export type FileTreeRouteView = 'note' | 'file'

export interface FileTreeEntry extends Pick<
  KnowledgeFile,
  '_id' | 'name' | 'type' | 'kind' | 'mimeType' | 'extension' | 'parentId' | 'updatedAt'
> {
  shareVisibility?: 'private' | 'public'
  shareToken?: string | null
  content?: string
  textContent?: string
}

export function fileTreeRouteView(file: Pick<FileTreeEntry, 'kind' | 'extension' | 'mimeType' | 'name'>): FileTreeRouteView {
  return opensInDocumentEditor(file) ? 'note' : 'file'
}

export function sortFilesForTree<T extends Pick<FileTreeEntry, 'type' | 'name'>>(files: readonly T[]): T[] {
  return [...files].sort((a, b) => {
    if (a.type !== b.type) return a.type === 'folder' ? -1 : 1
    return a.name.localeCompare(b.name)
  })
}

export function rootFilesForTree<T extends Pick<FileTreeEntry, 'parentId' | 'type' | 'name'>>(
  files: readonly T[],
): T[] {
  return sortFilesForTree(files.filter((file) => file.parentId == null))
}

export function childFilesForTree<T extends Pick<FileTreeEntry, 'parentId' | 'type' | 'name'>>(
  files: readonly T[],
  parentId: string,
): T[] {
  return sortFilesForTree(files.filter((file) => file.parentId === parentId))
}

export function filterFilesForTreeSearch<T extends Pick<FileTreeEntry, '_id' | 'name' | 'parentId'>>(
  files: readonly T[],
  query: string,
): T[] {
  const q = query.trim().toLowerCase()
  if (!q) return [...files]
  const keep = new Set<string>()
  for (const file of files) {
    if (file.name.toLowerCase().includes(q)) {
      keep.add(file._id)
      let parentId = file.parentId
      while (parentId) {
        keep.add(parentId)
        parentId = files.find((candidate) => candidate._id === parentId)?.parentId ?? null
      }
    }
  }
  return files.filter((file) => keep.has(file._id))
}

export function canMoveFileInTree(
  files: readonly Pick<FileTreeEntry, '_id' | 'parentId'>[],
  fileId: string,
  parentId: string | null,
): boolean {
  return canMoveKnowledgeFile(files, fileId, parentId)
}
