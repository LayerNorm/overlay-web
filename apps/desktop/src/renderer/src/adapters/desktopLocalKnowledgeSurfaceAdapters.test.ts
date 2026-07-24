import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDesktopLocalKnowledgeRepository } from './desktopLocalKnowledgeSurfaceAdapters'

describe('desktop On this Mac repository', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('renders only local entities and never merges cloud rows', async () => {
    let notes = [{ id: 'note-1', title: 'Local note', content: 'hello', updatedAt: 10 }]
    let listener: (() => void) | undefined
    vi.stubGlobal('window', {
      bridge: {
        async loadNotes() { return notes.map(({ content: _content, ...note }) => note) },
        async loadNote(id: string) { return notes.find((note) => note.id === id) ?? null },
        async saveNote(note: typeof notes[number]) {
          notes = [...notes.filter((current) => current.id !== note.id), note]
          listener?.()
          return true
        },
        async deleteNote(id: string) {
          notes = notes.filter((note) => note.id !== id)
          listener?.()
          return true
        },
        onNotesChanged(next: () => void) {
          listener = next
          return () => { listener = undefined }
        },
        document: {
          async getAll() {
            return [{
              id: 'document-1',
              filename: 'Local.pdf',
              filepath: '/tmp/Local.pdf',
              mimeType: 'application/pdf',
              chunkCount: 2,
              createdAt: 20,
            }]
          },
          async remove() { return { success: true } },
        },
      },
    })

    const repository = createDesktopLocalKnowledgeRepository()
    const initial = await repository.list()
    expect(initial.nodes.map((node) => node.id)).toEqual([
      'local-note:note-1',
      'local-document:document-1',
    ])
    expect(initial.nodes.every((node) => node.id.startsWith('local-'))).toBe(true)

    const created = await repository.create({
      name: 'Offline draft',
      kind: 'note',
      parentId: null,
      content: 'draft',
      clientId: 'note-2',
    })
    expect(created.id).toBe('local-note:note-2')
    await repository.rename({ id: created.id, name: 'Renamed draft' })
    expect((await repository.get(created.id))?.name).toBe('Renamed draft')
    await repository.delete({ ids: [created.id] })
    expect(await repository.get(created.id)).toBeNull()
  })
})
