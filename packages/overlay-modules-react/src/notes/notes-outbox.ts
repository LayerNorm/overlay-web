'use client'

/**
 * Crash-safe outbox: the latest unsaved document state per note, kept in
 * localStorage. Written on every edit; cleared only when a save lands. On
 * reopen, a matching entry (same base revision) rehydrates the draft so a
 * crash or offline kill never loses typed content.
 */

export interface NoteOutboxEntry {
  noteId: string
  baseRevision?: string
  title: string
  content: string
  docJson?: string
  at: number
}

const KEY_PREFIX = 'overlay:note-outbox:'

function key(noteId: string): string {
  return `${KEY_PREFIX}${noteId}`
}

function storage(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null
  } catch {
    return null
  }
}

export function writeNoteOutbox(entry: NoteOutboxEntry): void {
  const store = storage()
  if (!store) return
  try {
    store.setItem(key(entry.noteId), JSON.stringify(entry))
  } catch {
    // quota/serialization failure — autosave still runs in memory
  }
}

export function readNoteOutbox(noteId: string): NoteOutboxEntry | null {
  const store = storage()
  if (!store) return null
  try {
    const raw = store.getItem(key(noteId))
    if (!raw) return null
    const parsed = JSON.parse(raw) as NoteOutboxEntry
    return parsed?.noteId === noteId ? parsed : null
  } catch {
    return null
  }
}

export function clearNoteOutbox(noteId: string): void {
  const store = storage()
  if (!store) return
  try {
    store.removeItem(key(noteId))
  } catch {
    // ignore
  }
}
