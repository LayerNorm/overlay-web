import {
  KNOWLEDGE_ENTITY_MUTATION_EVENT,
  createKnowledgeMutationPublisher,
  type KnowledgeEntityMutation,
  type NoteDoc,
  type NotebookEditorConflict,
} from '@overlay/app-core'
import type { NotebookEditorRepository } from '@overlay/modules-react/notes'
import { overlayDesktopAppClient } from '../../services/app-api-client'
import {
  getLocalIdForRemoteNote,
  getRemoteIdForLocalNote,
  registerMigratedNoteMappings,
} from '../../services/desktop-sync-service'
import { getDesktopKnowledgeAuthority } from '../../services/desktop-knowledge-migration'

type LocalNote = {
  id: string
  title: string
  content: string
  updatedAt: number
}

function localDocument(note: LocalNote): NoteDoc {
  return {
    _id: note.id,
    clientId: note.id,
    title: note.title || 'Untitled',
    content: note.content || '',
    tags: [],
    createdAt: note.updatedAt,
    updatedAt: note.updatedAt,
  }
}

async function responseBody(response: Response): Promise<{
  error?: string
  note?: NoteDoc | null
  conflict?: NotebookEditorConflict
}> {
  return await response.json().catch(() => ({})) as {
    error?: string
    note?: NoteDoc | null
    conflict?: NotebookEditorConflict
  }
}

export function createDesktopNotebookRepository(
  origin = `desktop-notebook:${globalThis.crypto?.randomUUID?.() ?? Date.now()}`,
): NotebookEditorRepository {
  const remoteByLocal = new Map<string, string>()
  const localByRemote = new Map<string, string>()
  const cache = new Map<string, NoteDoc>()
  const nextMutation = createKnowledgeMutationPublisher(origin)

  function publish(mutation: Omit<KnowledgeEntityMutation, 'origin' | 'revision'>): void {
    if (typeof window === 'undefined' || typeof CustomEvent === 'undefined') return
    window.dispatchEvent(new CustomEvent(KNOWLEDGE_ENTITY_MUTATION_EVENT, {
      detail: nextMutation(mutation),
    }))
  }

  function rememberRemote(note: NoteDoc): NoteDoc {
    const localId = note.clientId || getLocalIdForRemoteNote(note._id) || `note-remote-${note._id}`
    remoteByLocal.set(localId, note._id)
    localByRemote.set(note._id, localId)
    registerMigratedNoteMappings({ [localId]: { remoteId: note._id, updatedAt: note.updatedAt } })
    const document = { ...note, _id: localId, clientId: localId }
    cache.set(localId, document)
    return document
  }

  async function loadLocal(id: string): Promise<NoteDoc | null> {
    const localId = localByRemote.get(id) || getLocalIdForRemoteNote(id) || id
    const note = await window.bridge.loadNote(localId) as LocalNote | null
    if (!note) return null
    const document = localDocument({ ...note, id: localId })
    cache.set(localId, document)
    return document
  }

  async function saveLocal(note: NoteDoc): Promise<void> {
    await window.bridge.saveNote({
      id: note._id,
      title: note.title,
      content: note.content,
      updatedAt: note.updatedAt,
    })
    cache.set(note._id, note)
  }

  function usesCloudAuthority(): boolean {
    return getDesktopKnowledgeAuthority() === 'cloud'
  }

  async function listLocal(): Promise<NoteDoc[]> {
    const summaries = await window.bridge.loadNotes()
    return summaries.map((note) => ({
      _id: note.id,
      clientId: note.id,
      title: note.title || 'Untitled',
      content: '',
      tags: [],
      createdAt: note.updatedAt,
      updatedAt: note.updatedAt,
    }))
  }

  return {
    async list(signal) {
      if (!usesCloudAuthority()) return listLocal()
      try {
        const remote = await overlayDesktopAppClient.notes.get<NoteDoc[]>({ limit: 100 }, { signal })
        return Array.isArray(remote) ? remote.map(rememberRemote) : []
      } catch (error) {
        if (signal?.aborted) throw error
        return listLocal()
      }
    },

    async get(noteId, signal) {
      const cached = cache.get(noteId)
      if (cached?.content) return cached
      if (!usesCloudAuthority()) return loadLocal(noteId)
      const remoteId = remoteByLocal.get(noteId) || getRemoteIdForLocalNote(noteId) || noteId
      try {
        const remote = await overlayDesktopAppClient.notes.get<NoteDoc>({ noteId: remoteId }, { signal })
        return rememberRemote(remote)
      } catch (error) {
        if (signal?.aborted) throw error
        return loadLocal(noteId)
      }
    },

    async create(input) {
      const localId = `desktop-note-${crypto.randomUUID()}`
      const now = Date.now()
      const local = localDocument({
        id: localId,
        title: input?.title || 'Untitled',
        content: input?.content || '',
        updatedAt: now,
      })
      await saveLocal(local)
      if (!usesCloudAuthority()) return local
      try {
        const response = await overlayDesktopAppClient.notes.create({
          clientId: localId,
          title: local.title,
          content: local.content,
          tags: [],
        })
        if (response.note) {
          publish({ entity: 'note', id: response.note._id, operation: 'created' })
          return rememberRemote(response.note)
        }
      } catch {
        // The local replica is the offline outbox; desktop sync reconciles it later.
      }
      return local
    },

    async save({ noteId, title, content, expectedUpdatedAt }) {
      const now = Date.now()
      const local: NoteDoc = {
        ...(cache.get(noteId) ?? localDocument({ id: noteId, title, content, updatedAt: now })),
        _id: noteId,
        clientId: noteId,
        title,
        content,
        updatedAt: now,
      }
      const remoteId = remoteByLocal.get(noteId) || getRemoteIdForLocalNote(noteId)
      if (usesCloudAuthority() && remoteId) {
        try {
          const response = await overlayDesktopAppClient.notes.updateResponse({
            noteId: remoteId,
            title,
            content,
            expectedUpdatedAt,
          })
          const body = await responseBody(response)
          if (response.status === 409) {
            return {
              conflict: body.conflict ?? {
                localRevision: expectedUpdatedAt ? String(expectedUpdatedAt) : undefined,
                message: body.error || 'This note changed on another device. Review your local draft before saving again.',
              },
            }
          }
          if (!response.ok) throw new Error(body.error || 'Could not save note')
          if (body.note) {
            publish({ entity: 'note', id: body.note._id, operation: 'updated' })
            const persisted = rememberRemote(body.note)
            await saveLocal(persisted)
            return { note: persisted }
          }
        } catch {
          // Preserve the edit locally; the existing sync outbox will retry it.
        }
      }
      await saveLocal(local)
      return { note: local }
    },

    async delete(noteId) {
      const remoteId = remoteByLocal.get(noteId) || getRemoteIdForLocalNote(noteId)
      if (usesCloudAuthority() && remoteId) {
        try {
          const response = await overlayDesktopAppClient.notes.deleteResponse({ noteId: remoteId })
          if (response.ok) publish({ entity: 'note', id: remoteId, operation: 'deleted' })
        } catch { /* offline outbox */ }
      }
      await window.bridge.deleteNote(noteId)
      cache.delete(noteId)
    },
  }
}
