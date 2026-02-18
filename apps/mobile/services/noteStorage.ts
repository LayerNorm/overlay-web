import AsyncStorage from '@react-native-async-storage/async-storage'
import { Note, NoteMeta } from './types'

const NOTES_INDEX_KEY = 'overlay-notes-index'
const NOTE_PREFIX = 'overlay-note-'

export async function loadNotesIndex(): Promise<NoteMeta[]> {
  try {
    const data = await AsyncStorage.getItem(NOTES_INDEX_KEY)
    if (!data) return []
    return JSON.parse(data)
  } catch {
    return []
  }
}

async function saveNotesIndex(index: NoteMeta[]): Promise<void> {
  await AsyncStorage.setItem(NOTES_INDEX_KEY, JSON.stringify(index))
}

export async function loadNote(id: string): Promise<Note | null> {
  try {
    const data = await AsyncStorage.getItem(`${NOTE_PREFIX}${id}`)
    if (!data) return null
    return JSON.parse(data)
  } catch {
    return null
  }
}

export async function saveNote(note: Note): Promise<void> {
  const now = Date.now()
  const noteToSave: Note = {
    ...note,
    updatedAt: now,
    createdAt: note.createdAt || now
  }

  await AsyncStorage.setItem(`${NOTE_PREFIX}${note.id}`, JSON.stringify(noteToSave))

  const index = await loadNotesIndex()
  const existingIdx = index.findIndex((n) => n.id === note.id)

  const meta: NoteMeta = {
    id: noteToSave.id,
    title: noteToSave.title,
    updatedAt: noteToSave.updatedAt,
    createdAt: noteToSave.createdAt,
    folderId: noteToSave.folderId
  }

  if (existingIdx >= 0) {
    index[existingIdx] = meta
  } else {
    index.unshift(meta)
  }

  await saveNotesIndex(index)
}

export async function deleteNote(id: string): Promise<void> {
  await AsyncStorage.removeItem(`${NOTE_PREFIX}${id}`)

  const index = await loadNotesIndex()
  const filtered = index.filter((n) => n.id !== id)
  await saveNotesIndex(filtered)
}

export async function updateNoteTitle(id: string, title: string): Promise<void> {
  const note = await loadNote(id)
  if (note) {
    note.title = title
    await saveNote(note)
  }
}

export async function moveNoteToFolder(noteId: string, folderId: string | null): Promise<void> {
  const note = await loadNote(noteId)
  if (note) {
    note.folderId = folderId
    await saveNote(note)
  } else {
    const index = await loadNotesIndex()
    const meta = index.find((n) => n.id === noteId)
    if (meta) {
      meta.folderId = folderId
      await saveNotesIndex(index)
    }
  }
}

export async function searchNotes(query: string): Promise<NoteMeta[]> {
  const index = await loadNotesIndex()
  if (!query.trim()) return index

  const lowerQuery = query.toLowerCase()
  return index.filter((note) => note.title.toLowerCase().includes(lowerQuery))
}
