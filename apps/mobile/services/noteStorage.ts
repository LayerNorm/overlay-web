import { appJson, appRequest } from './appApi'
import type { NoteDoc } from './appContracts'
import type { Note, NoteMeta } from './types'

function mapNote(note: NoteDoc): Note {
  return {
    id: note._id,
    title: note.title,
    content: note.content,
    updatedAt: note.updatedAt,
    createdAt: note.createdAt,
    folderId: null,
  }
}

function mapNoteMeta(note: NoteDoc): NoteMeta {
  return {
    id: note._id,
    title: note.title,
    updatedAt: note.updatedAt,
    createdAt: note.createdAt,
    folderId: null,
  }
}

export async function loadNotesIndex(projectId?: string): Promise<NoteMeta[]> {
  const notes = await appJson<NoteDoc[]>('/api/app/notes', {
    query: { projectId: projectId || undefined },
  })
  return notes.map(mapNoteMeta).sort((a, b) => b.updatedAt - a.updatedAt)
}

export async function createNote(
  initial?: Partial<Note> & { projectId?: string },
): Promise<Note> {
  const response = await appJson<{ id: string; note: NoteDoc }>('/api/app/notes', {
    method: 'POST',
    json: {
      title: initial?.title || 'Untitled',
      content: initial?.content || '<p></p>',
      tags: [],
      projectId: initial?.projectId,
    },
  })
  return mapNote(response.note)
}

export async function loadNote(id: string): Promise<Note | null> {
  try {
    const note = await appJson<NoteDoc>('/api/app/notes', {
      query: { noteId: id },
    })
    return mapNote(note)
  } catch {
    return null
  }
}

export async function saveNote(note: Note): Promise<void> {
  await appJson('/api/app/notes', {
    method: 'PATCH',
    json: {
      noteId: note.id,
      title: note.title,
      content: note.content,
      tags: [],
    },
  })
}

export async function deleteNote(id: string): Promise<void> {
  await appRequest('/api/app/notes', {
    method: 'DELETE',
    query: { noteId: id },
  })
}

export async function updateNoteTitle(id: string, title: string): Promise<void> {
  await appJson('/api/app/notes', {
    method: 'PATCH',
    json: { noteId: id, title },
  })
}

export async function moveNoteToFolder(_noteId: string, _folderId: string | null): Promise<void> {
  void _noteId
  void _folderId
}

export async function searchNotes(query: string): Promise<NoteMeta[]> {
  const index = await loadNotesIndex()
  if (!query.trim()) return index

  const lowerQuery = query.toLowerCase()
  return index.filter((note) => note.title.toLowerCase().includes(lowerQuery))
}
