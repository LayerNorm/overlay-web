import type {
  KnowledgeFile,
  NoteDoc,
  NotebookAgentMention,
  NotebookAgentStreamEvent,
  UpdateFileRequest,
} from './contracts'

export const NOTES_CHANGED_EVENT = 'overlay:notes-changed'

export const NOTEBOOK_INLINE_MATH_MIGRATION_REGEX =
  /(?<!\$)\$(?![\d\s$])([^$\n]*(?:\\[a-zA-Z@]+|[=^_{}]|[a-zA-Z]\s*[+\-*/=^_]|[+\-*/=^_]\s*[a-zA-Z]|[a-zA-Z])[^$\n]*)\$(?![\d$])/g

export interface NotebookNote {
  _id: string
  title: string
  content: string
  tags: string[]
  createdAt: number
  updatedAt: number
  shareVisibility?: 'private' | 'public'
  shareToken?: string | null
}

export interface CanonicalNoteFile extends Pick<
  KnowledgeFile,
  '_id' | 'name' | 'content' | 'textContent' | 'createdAt' | 'updatedAt'
> {
  shareVisibility?: 'private' | 'public'
  shareToken?: string | null
}

export type NotebookAgentUiItem =
  | { type: 'user'; text: string }
  | { type: 'thinking'; text: string }
  | { type: 'tool_call'; tool: string; toolInput?: Record<string, unknown> }
  | { type: 'text'; text: string }
  | { type: 'error'; text: string }

export interface NotebookMentionLike {
  type: string
  id: string
  name: string
}

export interface NotebookDraftState {
  title: string
  content: string
  isDirty: boolean
  canSave: boolean
}

export interface CreateNotebookDraftStateInput {
  note: Pick<NotebookNote, 'title' | 'content'> | null
  draftTitle: string
  draftContent: string
  saving?: boolean
}

export function canonicalFileToNotebookNote(file: CanonicalNoteFile, now = Date.now()): NotebookNote {
  return {
    _id: file._id,
    title: file.name || 'Untitled',
    content: file.textContent ?? file.content ?? '',
    tags: [],
    createdAt: file.createdAt ?? now,
    updatedAt: file.updatedAt ?? now,
    shareVisibility: file.shareVisibility,
    shareToken: file.shareToken,
  }
}

/**
 * Notes are rendered alongside files in the app shell. Postgres stores them in
 * a dedicated notes table, while Convex historically exposes them as files.
 */
export function noteDocToKnowledgeFile(note: NoteDoc): KnowledgeFile & { type: 'file' } {
  return {
    _id: note._id,
    name: note.title || 'Untitled',
    type: 'file',
    kind: 'note',
    parentId: null,
    content: note.content,
    textContent: note.content,
    previewText: note.content,
    sizeBytes: note.content.length,
    createdAt: note.createdAt,
    updatedAt: note.updatedAt,
  }
}

export function createLocalNotebookNote(id: string, now = Date.now()): NotebookNote {
  return {
    _id: id,
    title: 'Untitled',
    content: '',
    tags: [],
    createdAt: now,
    updatedAt: now,
  }
}

export function normalizeNotebookTitle(value: string, fallback = 'Untitled'): string {
  return value.trim() || fallback
}

export function createNotebookDraftState(input: CreateNotebookDraftStateInput): NotebookDraftState {
  const title = normalizeNotebookTitle(input.draftTitle)
  const originalTitle = input.note?.title ?? ''
  const originalContent = input.note?.content ?? ''
  const isDirty = title !== originalTitle || input.draftContent !== originalContent
  return {
    title,
    content: input.draftContent,
    isDirty,
    canSave: Boolean(input.note) && isDirty && !input.saving,
  }
}

export function upsertNotebookNote(notes: readonly NotebookNote[], note: NotebookNote): NotebookNote[] {
  return [note, ...notes.filter((item) => item._id !== note._id)]
}

export function removeNotebookNote(notes: readonly NotebookNote[], noteId: string): NotebookNote[] {
  return notes.filter((note) => note._id !== noteId)
}

export function createNotebookFileUpdateRequest({
  noteId,
  title,
  content,
}: {
  noteId: string
  title: string
  content: string
}): UpdateFileRequest {
  return {
    fileId: noteId,
    name: title,
    textContent: content,
  }
}

export function createNotebookAgentMentions(mentions: readonly NotebookMentionLike[]): NotebookAgentMention[] {
  return mentions.map((mention) => ({
    type: mention.type,
    id: mention.id,
    name: mention.name,
  }))
}

export function createNotebookPersistedNote({
  noteId,
  title,
  content,
  file,
  fallbackNote,
  now = Date.now(),
}: {
  noteId: string
  title: string
  content: string
  file?: CanonicalNoteFile | null
  fallbackNote?: Pick<NotebookNote, 'createdAt' | 'shareVisibility' | 'shareToken'> | null
  now?: number
}): NotebookNote {
  if (file) return canonicalFileToNotebookNote(file, now)
  return {
    _id: noteId,
    title: normalizeNotebookTitle(title),
    content,
    tags: [],
    createdAt: fallbackNote?.createdAt ?? now,
    updatedAt: now,
    shareVisibility: fallbackNote?.shareVisibility,
    shareToken: fallbackNote?.shareToken,
  }
}

export function createRenamedNotebookNote({
  note,
  title,
  content,
  now = Date.now(),
}: {
  note: NotebookNote
  title: string
  content: string
  now?: number
}): NotebookNote {
  return {
    ...note,
    title: normalizeNotebookTitle(title),
    content,
    updatedAt: now,
  }
}

export function parseNotebookAgentStreamLine(line: string): NotebookAgentStreamEvent | null {
  const trimmed = line.trim()
  if (!trimmed) return null
  try {
    return JSON.parse(trimmed) as NotebookAgentStreamEvent
  } catch {
    return null
  }
}

export function notebookAgentEventToUiItem(event: NotebookAgentStreamEvent): NotebookAgentUiItem | null {
  switch (event.type) {
    case 'thinking':
      return event.thinking?.trim() ? { type: 'thinking', text: event.thinking } : null
    case 'tool_call':
      return { type: 'tool_call', tool: event.tool ?? 'tool', toolInput: event.toolInput }
    case 'text':
      return event.text?.trim() ? { type: 'text', text: event.text } : null
    case 'error':
      return { type: 'error', text: event.error ?? 'Unknown error' }
    case 'done':
    case 'edit_proposal':
      return null
    default:
      return null
  }
}
