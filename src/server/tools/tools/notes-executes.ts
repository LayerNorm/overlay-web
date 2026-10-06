import 'server-only'
import { roomListScope } from './room-scope'

import {
  appendToNote,
  applyNoteEdits,
  NoteEditError,
  noteOutline,
  prependToNote,
  replaceNoteSection,
  type NoteFindReplace,
} from '@overlay/app-core/note-edits'
import type { NoteDoc } from '@overlay/app-core'
import { callInternalApi, callInternalApiGet, toolAuthBody } from './internal-api'
import type { OverlayToolsOptions } from './types'

/**
 * Agent note tools. Notes are Markdown, and every write goes through
 * `/api/v1/notes` (NoteService) — the same path as the editor. Patch-style
 * tools read the note, apply the edit, and write it back guarded by the
 * revision they read, so an edit never overwrites a concurrent change.
 */

const NOTES_PATH = '/api/v1/notes'

type ToolFailure = { success: false; error: string; conflict?: true; currentRevision?: string }

function revisionOf(note: Pick<NoteDoc, 'updatedAt'>): string {
  return String(note.updatedAt)
}

async function errorMessage(res: Response, fallback: string): Promise<string> {
  const body = await res.json().catch((_error) => null) as { error?: string } | null
  return body?.error ?? fallback
}

function failure(err: unknown, fallback: string): ToolFailure {
  return { success: false, error: err instanceof Error ? err.message : fallback }
}

async function fetchNote(options: OverlayToolsOptions, noteId: string): Promise<NoteDoc | ToolFailure> {
  const params = new URLSearchParams({ noteId: noteId.trim() })
  const res = await callInternalApiGet(
    `${NOTES_PATH}?${params}`,
    options.accessToken,
    options.baseUrl,
    options.forwardCookie,
    options.serverSecret,
    options.userId,
    options.workspaceId,
  )
  if (!res.ok) return { success: false, error: await errorMessage(res, 'Note not found') }
  return await res.json() as NoteDoc
}

type WriteResult =
  | { ok: true; note: NoteDoc | null }
  | { ok: false; conflict: boolean; error: string; currentRevision?: string }

async function writeNote(
  options: OverlayToolsOptions,
  body: { noteId: string; title?: string; content?: string; tags?: string[]; expectedUpdatedAt?: number },
): Promise<WriteResult> {
  const res = await callInternalApi(
    NOTES_PATH,
    { ...body, ...toolAuthBody(options) },
    options.accessToken,
    options.baseUrl,
    { method: 'PATCH', forwardCookie: options.forwardCookie },
  )
  if (res.status === 409) {
    const conflict = await res.json().catch((_error) => null) as { conflict?: { remoteRevision?: string } } | null
    return {
      ok: false,
      conflict: true,
      error: 'The note changed since it was read.',
      currentRevision: conflict?.conflict?.remoteRevision,
    }
  }
  if (!res.ok) return { ok: false, conflict: false, error: await errorMessage(res, 'Failed to update note') }
  const data = await res.json().catch((_error) => null) as { note?: NoteDoc | null } | null
  return { ok: true, note: data?.note ?? null }
}

function staleRevision(expected: string, current: string): ToolFailure {
  return {
    success: false,
    conflict: true,
    currentRevision: current,
    error: `The note changed since revision ${expected} (now ${current}), likely because someone is editing it. Call get_note again and redo the edit on the current text.`,
  }
}

/**
 * Read → transform → write, guarded by the revision read. Without an
 * `expectedRevision` from the model, a lost race is retried once on fresh text.
 */
async function patchNote(
  options: OverlayToolsOptions,
  input: { noteId: string; expectedRevision?: string },
  transform: (markdown: string) => string,
) {
  const attempts = input.expectedRevision ? 1 : 2
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const note = await fetchNote(options, input.noteId)
    if ('success' in note) return note
    const current = revisionOf(note)
    if (input.expectedRevision && input.expectedRevision !== current) {
      return staleRevision(input.expectedRevision, current)
    }
    let next: string
    try {
      next = transform(note.content)
    } catch (err) {
      if (err instanceof NoteEditError) return { success: false as const, error: err.message }
      throw err
    }
    const written = await writeNote(options, { noteId: note._id, content: next, expectedUpdatedAt: note.updatedAt })
    if (written.ok) {
      return {
        success: true as const,
        noteId: note._id,
        revision: written.note ? revisionOf(written.note) : undefined,
      }
    }
    if (!written.conflict) return { success: false as const, error: written.error }
    if (attempt === attempts - 1) {
      return staleRevision(input.expectedRevision ?? current, written.currentRevision ?? 'unknown')
    }
  }
  return { success: false as const, error: 'Failed to update note' }
}

const LIST_NOTES_LIMIT = 200

type NotesPage = { data: NoteDoc[]; nextCursor?: string; hasMore?: boolean }

/** The notes route answers a list with a page envelope; an older shape was a bare array. Read both. */
function readNotesPage(payload: unknown): NotesPage {
  if (Array.isArray(payload)) return { data: payload as NoteDoc[] }
  const page = payload as Partial<NotesPage> | null
  return { data: Array.isArray(page?.data) ? page.data : [], ...(page?.nextCursor ? { nextCursor: page.nextCursor } : {}), hasMore: page?.hasMore === true }
}

export async function executeListNotes(
  options: OverlayToolsOptions,
  input: { scope?: 'personal' | 'workspace' },
) {
  try {
    const notes: NoteDoc[] = []
    let cursor: string | undefined
    let truncated = false
    do {
      const params = new URLSearchParams({ limit: '100', sort: 'updatedAt', order: 'desc' })
      const scope = roomListScope(options, input.scope)
      if (scope) params.set('view', scope)
      if (cursor) params.set('cursor', cursor)
      const res = await callInternalApiGet(
        `${NOTES_PATH}?${params}`,
        options.accessToken,
        options.baseUrl,
        options.forwardCookie,
        options.serverSecret,
        options.userId,
        options.workspaceId,
      )
      if (!res.ok) return { success: false, error: await errorMessage(res, 'Failed to list notes') }
      const page = readNotesPage(await res.json())
      notes.push(...page.data)
      cursor = page.hasMore ? page.nextCursor : undefined
      truncated = Boolean(cursor)
    } while (cursor && notes.length < LIST_NOTES_LIMIT)
    return {
      success: true,
      notes: notes
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, LIST_NOTES_LIMIT)
        .map((note) => ({
          noteId: note._id,
          title: note.title || 'Untitled',
          tags: note.tags ?? [],
          updatedAt: note.updatedAt,
        })),
      ...(truncated || notes.length > LIST_NOTES_LIMIT ? { truncated: true } : {}),
    }
  } catch (err) {
    return failure(err, 'Failed to list notes')
  }
}

export async function executeGetNote(options: OverlayToolsOptions, input: { noteId: string }) {
  try {
    const note = await fetchNote(options, input.noteId)
    if ('success' in note) return note
    return {
      success: true,
      note: {
        noteId: note._id,
        title: note.title || 'Untitled',
        content: note.content,
        tags: note.tags ?? [],
        revision: revisionOf(note),
        outline: noteOutline(note.content),
        updatedAt: note.updatedAt,
      },
    }
  } catch (err) {
    return failure(err, 'Failed to load note')
  }
}

export async function executeCreateNote(
  options: OverlayToolsOptions,
  input: { title?: string; content: string; tags?: string[] },
) {
  try {
    const res = await callInternalApi(
      NOTES_PATH,
      {
        title: input.title?.trim() || 'Untitled',
        content: input.content,
        ...(input.tags ? { tags: input.tags } : {}),
        ...toolAuthBody(options),
      },
      options.accessToken,
      options.baseUrl,
      { forwardCookie: options.forwardCookie },
    )
    if (!res.ok) return { success: false, error: await errorMessage(res, 'Failed to create note') }
    const data = (await res.json()) as { id?: string; note?: NoteDoc | null }
    return {
      success: true,
      noteId: data.id,
      revision: data.note ? revisionOf(data.note) : undefined,
    }
  } catch (err) {
    return failure(err, 'Failed to create note')
  }
}

export async function executeUpdateNote(
  options: OverlayToolsOptions,
  input: { noteId: string; title?: string; content?: string; tags?: string[]; expectedRevision?: string },
) {
  try {
    const expectedUpdatedAt = input.expectedRevision ? Number(input.expectedRevision) : undefined
    if (input.expectedRevision && !Number.isFinite(expectedUpdatedAt)) {
      return { success: false, error: 'expectedRevision must be the revision returned by get_note.' }
    }
    const written = await writeNote(options, {
      noteId: input.noteId.trim(),
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.content !== undefined ? { content: input.content } : {}),
      ...(input.tags !== undefined ? { tags: input.tags } : {}),
      ...(expectedUpdatedAt !== undefined ? { expectedUpdatedAt } : {}),
    })
    if (written.ok) {
      return {
        success: true,
        noteId: input.noteId.trim(),
        revision: written.note ? revisionOf(written.note) : undefined,
      }
    }
    if (written.conflict) return staleRevision(input.expectedRevision ?? '', written.currentRevision ?? 'unknown')
    return { success: false, error: written.error }
  } catch (err) {
    return failure(err, 'Failed to update note')
  }
}

export async function executeAppendToNote(
  options: OverlayToolsOptions,
  input: { noteId: string; content: string; position?: 'end' | 'start'; expectedRevision?: string },
) {
  try {
    return await patchNote(options, input, (markdown) => (
      input.position === 'start' ? prependToNote(markdown, input.content) : appendToNote(markdown, input.content)
    ))
  } catch (err) {
    return failure(err, 'Failed to append to note')
  }
}

export async function executeReplaceNoteSection(
  options: OverlayToolsOptions,
  input: { noteId: string; heading: string; content: string; createIfMissing?: boolean; expectedRevision?: string },
) {
  try {
    return await patchNote(options, input, (markdown) => (
      replaceNoteSection(markdown, input.heading, input.content, { appendIfMissing: input.createIfMissing })
    ))
  } catch (err) {
    return failure(err, 'Failed to update note section')
  }
}

export async function executeEditNote(
  options: OverlayToolsOptions,
  input: { noteId: string; edits: NoteFindReplace[]; expectedRevision?: string },
) {
  try {
    return await patchNote(options, input, (markdown) => applyNoteEdits(markdown, input.edits))
  } catch (err) {
    return failure(err, 'Failed to edit note')
  }
}

export async function executeDeleteNote(options: OverlayToolsOptions, input: { noteId: string }) {
  try {
    const params = new URLSearchParams({ noteId: input.noteId.trim() })
    const res = await callInternalApi(
      `${NOTES_PATH}?${params}`,
      toolAuthBody(options),
      options.accessToken,
      options.baseUrl,
      { method: 'DELETE', forwardCookie: options.forwardCookie },
    )
    if (!res.ok) return { success: false, error: await errorMessage(res, 'Failed to delete note') }
    return { success: true }
  } catch (err) {
    return failure(err, 'Failed to delete note')
  }
}
