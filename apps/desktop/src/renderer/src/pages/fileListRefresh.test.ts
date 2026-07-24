import { describe, expect, it } from 'vitest'
import {
  reconcileLocalNoteItems,
  resolveFileListLoadMode,
  type FileListRefreshItem,
  type LocalNoteSummary
} from './fileListRefresh'

type TestItem = FileListRefreshItem

function noteToItem(note: LocalNoteSummary): TestItem {
  return {
    id: note.id,
    name: note.title,
    type: 'note',
    updatedAt: note.updatedAt,
    source: 'local-note'
  }
}

describe('files list refresh behavior', () => {
  it('uses a blocking loader only before the first successful load', () => {
    expect(resolveFileListLoadMode(false)).toBe('initial')
    expect(resolveFileListLoadMode(true)).toBe('refreshing')
  })

  it('reconciles local notes without replacing remote files or documents', () => {
    const current: TestItem[] = [
      { id: 'remote-1', name: 'Remote', type: 'file', updatedAt: 1, source: 'backend' },
      {
        id: 'document-1',
        name: 'Document',
        type: 'file',
        updatedAt: 1,
        source: 'local-document'
      },
      { id: 'note-1', name: 'Old title', type: 'note', updatedAt: 1, source: 'local-note' }
    ]

    expect(
      reconcileLocalNoteItems(
        current,
        [
          { id: 'note-1', title: 'New title', updatedAt: 2 },
          { id: 'note-2', title: 'Second note', updatedAt: 3 }
        ],
        noteToItem
      )
    ).toEqual([
      { id: 'remote-1', name: 'Remote', type: 'file', updatedAt: 1, source: 'backend' },
      {
        id: 'document-1',
        name: 'Document',
        type: 'file',
        updatedAt: 1,
        source: 'local-document'
      },
      { id: 'note-1', name: 'New title', type: 'note', updatedAt: 2, source: 'local-note' },
      { id: 'note-2', name: 'Second note', type: 'note', updatedAt: 3, source: 'local-note' }
    ])
  })

  it('keeps a backend note authoritative when the same client id exists locally', () => {
    const current: TestItem[] = [
      { id: 'note-1', name: 'Remote title', type: 'note', updatedAt: 1, source: 'backend' },
      { id: 'note-1', name: 'Local title', type: 'note', updatedAt: 1, source: 'local-note' }
    ]

    expect(
      reconcileLocalNoteItems(
        current,
        [{ id: 'note-1', title: 'Changed locally', updatedAt: 2 }],
        noteToItem
      )
    ).toEqual([
      { id: 'note-1', name: 'Changed locally', type: 'note', updatedAt: 2, source: 'backend' }
    ])
  })
})
