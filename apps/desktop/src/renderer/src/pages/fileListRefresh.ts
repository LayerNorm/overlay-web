import { KNOWLEDGE_RECONCILE_EVENT } from '@overlay/app-core'

export interface LocalNoteSummary {
  id: string
  title: string
  updatedAt: number
}

export interface FileListRefreshItem {
  id: string
  name: string
  type: 'file' | 'folder' | 'note'
  updatedAt: number
  source: 'backend' | 'local-note' | 'local-document'
}

export type FileListLoadMode = 'initial' | 'refreshing'

export const FILES_RECONCILE_EVENT = KNOWLEDGE_RECONCILE_EVENT

export function resolveFileListLoadMode(hasLoadedOnce: boolean): FileListLoadMode {
  return hasLoadedOnce ? 'refreshing' : 'initial'
}

/**
 * Reconciles notebook metadata without refetching remote files or indexed
 * documents. Backend items keep precedence, matching the initial merge.
 */
export function reconcileLocalNoteItems<T extends FileListRefreshItem>(
  currentItems: readonly T[],
  notes: readonly LocalNoteSummary[],
  toItem: (note: LocalNoteSummary) => T
): T[] {
  const nextItems = currentItems.filter((item) => item.source !== 'local-note')
  const existingIndexById = new Map(nextItems.map((item, index) => [item.id, index]))

  for (const note of notes) {
    const existingIndex = existingIndexById.get(note.id)
    if (existingIndex !== undefined) {
      const existing = nextItems[existingIndex]
      if (existing?.type === 'note') {
        nextItems[existingIndex] = {
          ...existing,
          name: note.title || 'Untitled',
          updatedAt: Math.max(existing.updatedAt, note.updatedAt)
        }
      }
      continue
    }
    const item = toItem(note)
    nextItems.push(item)
    existingIndexById.set(note.id, nextItems.length - 1)
  }

  return nextItems
}
