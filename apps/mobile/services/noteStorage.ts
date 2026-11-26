import type { NoteDoc } from '@overlay/app-core'
import { appJson, appRequest, getRequestWorkspaceId } from './appApi'
import type { Note, NoteMeta } from './types'
import { getFile, listFiles, moveFile, renameFile } from './filesService'
import { getKnowledgeFileContent } from './knowledgeService'
import { getCurrentMode } from './modeState'

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

export async function loadNotesIndex(): Promise<NoteMeta[]> {
  const files = await listFiles()
  if (files === null) throw new Error('Notes are unavailable in this workspace.')
  return files.filter(file => file.kind === 'note').map(file => ({ id: file._id, title: file.name, createdAt: file.createdAt, updatedAt: file.updatedAt, folderId: file.parentId })).sort((a, b) => b.updatedAt - a.updatedAt)
}

export async function createNote(
  initial?: Partial<Note>,
): Promise<Note> {
  const response = await appJson<{ id: string; note: NoteDoc }>('/api/v1/notes', { workspaceId: getRequestWorkspaceId(),
    method: 'POST',
    json: {
      title: initial?.title || 'Untitled',
      content: initial?.content || '<p></p>',
      tags: [],
      scope: getCurrentMode(),
    },
  })
  return mapNote(response.note)
}

export async function loadNote(id: string): Promise<Note | null> {
  const scope = getRequestWorkspaceId()
  const file = await getFile(id)
  if (getRequestWorkspaceId() !== scope) throw new Error('Workspace changed. Reopen this note.')
  if (!file || file.kind !== 'note') return null
  const content = file.textInObjectStore ? await getKnowledgeFileContent(id) : file.textContent ?? file.content ?? ''
  if (getRequestWorkspaceId() !== scope) throw new Error('Workspace changed. Reopen this note.')
  return { ...mapNote({ _id: file._id, title: file.name, content, tags: file.tags ?? [], createdAt: file.createdAt, updatedAt: file.updatedAt }), folderId: file.parentId }
}

export async function saveNote(note: Note): Promise<Note> {
  const result = await appJson<{ note: NoteDoc }>('/api/v1/notes', { workspaceId: getRequestWorkspaceId(),
    method: 'PATCH',
    json: {
      noteId: note.id,
      title: note.title,
      content: note.content,
      expectedUpdatedAt: note.updatedAt,
      tags: [],
    },
  })
  return mapNote(result.note)
}

export async function deleteNote(id: string): Promise<void> {
  await appRequest('/api/v1/notes', { workspaceId: getRequestWorkspaceId(),
    method: 'DELETE',
    query: { noteId: id },
  })
}

export async function updateNoteTitle(id: string, title: string): Promise<void> {
  await renameFile(id, title)
}

export async function moveNoteToFolder(noteId: string, folderId: string | null): Promise<void> {
  await moveFile(noteId, folderId)
}

export async function searchNotes(query: string): Promise<NoteMeta[]> {
  const index = await loadNotesIndex()
  if (!query.trim()) return index

  const lowerQuery = query.toLowerCase()
  return index.filter((note) => note.title.toLowerCase().includes(lowerQuery))
}
