'use client'

import { useMemo } from 'react'
import { useConvex } from 'convex/react'
import {
  createLocalNotebookNote,
  type CreateNoteResponse,
  type UpdateNoteResponse,
} from '@overlay/app-core'
import type { NotebookEditorRepository } from '@overlay/modules-react/notes'
import { overlayAppClient } from '@/shared/app/overlay-app-client'
import { noteDocFromFile } from '@/hooks/use-file-tree'
import { useWorkspace } from '@/contexts/WorkspaceContext'
import { isConvexIdShape } from '@/components/providers/usePersonalChatTranscript'
import { api } from '../../convex/_generated/api'
import type { Id } from '../../convex/_generated/dataModel'

/**
 * Reads and writes one note for the canonical editor: the Files/Notes page and the agent thread's right panel use the
 * same repository, so both save through `/api/v1/notes` with the same revision guard.
 */
export function useNotebookRepository(): NotebookEditorRepository {
  const convex = useConvex()
  const { activeWorkspaceId } = useWorkspace()
  return useMemo<NotebookEditorRepository>(() => ({
    async get(noteId, signal) {
      if (!activeWorkspaceId || !isConvexIdShape(noteId)) return null
      const file = await convex.query(api.files.browse.get, { workspaceId: activeWorkspaceId, fileId: noteId as Id<'files'> })
        .catch(() => null)
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
      return file ? noteDocFromFile(file) : null
    },
    async create() {
      const result = await overlayAppClient.notes.create({ title: 'Untitled', content: '' }) as CreateNoteResponse
      return result.note ?? {
        ...createLocalNotebookNote(result.id),
        title: 'Untitled',
        content: '',
      }
    },
    async save({ noteId, title, content, expectedUpdatedAt }) {
      const response = await overlayAppClient.notes.updateResponse({
        noteId,
        title,
        content,
        expectedUpdatedAt,
      })
      const body = await response.json().catch(() => null) as (UpdateNoteResponse & {
        conflict?: { localRevision?: string; remoteRevision?: string; message: string }
      }) | null
      if (response.status === 409) {
        return {
          conflict: body?.conflict ?? {
            localRevision: String(expectedUpdatedAt ?? ''),
            message: body?.error || 'This note changed in another session.',
          },
        }
      }
      if (!response.ok) throw new Error(body?.error || 'Could not save note')
      return { note: body?.note }
    },
    async delete(noteId) {
      const response = await overlayAppClient.notes.deleteResponse({ noteId })
      if (!response.ok) throw new Error('Could not delete note')
    },
  }), [activeWorkspaceId, convex])
}
