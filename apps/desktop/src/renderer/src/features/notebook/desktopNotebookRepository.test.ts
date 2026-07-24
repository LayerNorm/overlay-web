import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  authority: vi.fn(() => 'on-this-mac' as const),
  remoteGet: vi.fn(),
  remoteCreate: vi.fn(),
  remoteUpdate: vi.fn(),
  remoteDelete: vi.fn()
}))

vi.mock('../../services/desktop-knowledge-migration', () => ({
  getDesktopKnowledgeAuthority: mocks.authority
}))

vi.mock('../../services/desktop-sync-service', () => ({
  getLocalIdForRemoteNote: vi.fn(),
  getRemoteIdForLocalNote: vi.fn(),
  registerMigratedNoteMappings: vi.fn()
}))

vi.mock('../../services/app-api-client', () => ({
  overlayDesktopAppClient: {
    notes: {
      get: mocks.remoteGet,
      create: mocks.remoteCreate,
      updateResponse: mocks.remoteUpdate,
      deleteResponse: mocks.remoteDelete
    }
  }
}))

import { createDesktopNotebookRepository } from './desktopNotebookRepository'

describe('desktop notebook repository', () => {
  const localNote = {
    id: 'note-local',
    title: 'Local note',
    content: '<p>Persisted note content</p>',
    updatedAt: 42
  }
  const loadNotes = vi.fn()
  const loadNote = vi.fn()
  const saveNote = vi.fn()
  const deleteNote = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.authority.mockReturnValue('on-this-mac')
    loadNotes.mockResolvedValue([
      {
        id: localNote.id,
        title: localNote.title,
        updatedAt: localNote.updatedAt
      }
    ])
    loadNote.mockResolvedValue(localNote)
    saveNote.mockResolvedValue(true)
    deleteNote.mockResolvedValue(true)
    vi.stubGlobal('window', {
      bridge: { loadNotes, loadNote, saveNote, deleteNote },
      dispatchEvent: vi.fn()
    })
  })

  it('loads full local content after listing metadata without touching the cloud', async () => {
    const repository = createDesktopNotebookRepository('test')

    const summaries = await repository.list()
    expect(summaries).toEqual([
      expect.objectContaining({ _id: localNote.id, title: localNote.title, content: '' })
    ])

    const hydrated = await repository.get(localNote.id)
    expect(hydrated).toEqual(
      expect.objectContaining({
        _id: localNote.id,
        title: localNote.title,
        content: localNote.content
      })
    )
    expect(loadNote).toHaveBeenCalledWith(localNote.id)
    expect(mocks.remoteGet).not.toHaveBeenCalled()
  })

  it('keeps local create, save, and delete operations local until cloud becomes authoritative', async () => {
    const repository = createDesktopNotebookRepository('test')
    const created = await repository.create({ title: 'Draft', content: '<p>Draft</p>' })

    await repository.save({
      noteId: created._id,
      title: 'Edited',
      content: '<p>Edited</p>',
      expectedUpdatedAt: created.updatedAt
    })
    await repository.delete?.(created._id)

    expect(saveNote).toHaveBeenCalledTimes(2)
    expect(deleteNote).toHaveBeenCalledWith(created._id)
    expect(mocks.remoteCreate).not.toHaveBeenCalled()
    expect(mocks.remoteUpdate).not.toHaveBeenCalled()
    expect(mocks.remoteDelete).not.toHaveBeenCalled()
  })
})
