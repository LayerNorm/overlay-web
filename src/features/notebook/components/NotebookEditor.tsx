'use client'

import dynamic from 'next/dynamic'
import { OverlayMark } from '@/components/brand/OverlayMark'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  readStoredPanelPresentation,
  storePanelPresentation,
  toRightPanelMode,
  type PanelPresentation,
} from '@/shared/ui/panel-presentation'
import { useCallback, useMemo, useState } from 'react'
import {
  createLocalNotebookNote,
  type CreateNoteResponse,
  type UpdateNoteResponse,
} from '@overlay/app-core'
import {
  CanonicalNotebookEditor,
  type NotebookEditorRepository,
} from '@overlay/modules-react/notes'
import { ExportMenu } from '@/features/files/components/ExportMenu'
import { ShareDialog } from '@/features/share/components/ShareDialog'
import { ScopeItemActions } from '@/components/layout/ScopeItemActions'
import { MentionInput } from '@/features/chat/components/chat-interface/MentionInput'
import { overlayAppClient } from '@/shared/app/overlay-app-client'
import { ACT_MODEL_KEY, readStoredActModelId } from '@/shared/chat/chat-model-prefs'
import { getModelsByIntelligence } from '@/shared/ai/gateway/model-data'
import { isByokModelId } from '@/shared/ai/gateway/byok-model-conversion'
import { DEFAULT_MODEL_ID } from '@/shared/ai/gateway/model-types'
import { useWorkspaceHref } from '@/hooks/use-workspace-href'
import { usePanelScope } from '@/hooks/use-panel-scope'
import { noteDocFromFile, useLiveNote } from '@/hooks/use-file-tree'
import { useConvex } from 'convex/react'
import { useWorkspace } from '@/contexts/WorkspaceContext'
import { isConvexIdShape } from '@/components/providers/usePersonalChatTranscript'
import { api } from '../../../../convex/_generated/api'
import type { Id } from '../../../../convex/_generated/dataModel'

const MarkdownMessage = dynamic(() =>
  import('@overlay/chat-react').then((module) => ({ default: module.MarkdownMessage })),
)

export default function NotebookEditor({
  userId: _userId,
  hideSidebar,
  projectName,
}: {
  userId: string
  hideSidebar?: boolean
  projectName?: string
}) {
  void _userId
  const router = useRouter()
  const searchParams = useSearchParams()
  const buildWorkspaceHref = useWorkspaceHref()
  const convex = useConvex()
  const { activeWorkspaceId } = useWorkspace()
  const scope = usePanelScope()
  const models = useMemo(
    () => getModelsByIntelligence()
      .filter(({ id }) => !isByokModelId(id))
      .map(({ id, name }) => ({ id, name })),
    [],
  )
  const initialModelId = useMemo(() => {
    const storedModelId = readStoredActModelId()
    return isByokModelId(storedModelId) ? DEFAULT_MODEL_ID : storedModelId
  }, [])

  // Shared with the chat sources panel so both surfaces present the same way.
  const [panelPresentation, setPanelPresentationState] = useState(readStoredPanelPresentation)
  const setPanelPresentation = useCallback((presentation: PanelPresentation) => {
    setPanelPresentationState(presentation)
    storePanelPresentation(presentation)
  }, [])

  const noteId = searchParams?.get('id') ?? null
  const liveNote = useLiveNote(noteId)
  // The open note was deleted, archived or became unreadable elsewhere: go back to the files it belonged to.
  const [seenNoteId, setSeenNoteId] = useState<string | null>(null)
  if (liveNote && seenNoteId !== liveNote._id) setSeenNoteId(liveNote._id)
  const noteGone = liveNote === null && noteId !== null && seenNoteId === noteId

  const repository = useMemo<NotebookEditorRepository>(() => ({
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

  return (
    <CanonicalNotebookEditor
      noteId={noteId}
      liveNote={liveNote}
      noteRemoved={noteGone}
      hideSidebar={hideSidebar}
      projectName={projectName}
      repository={repository}
      runAgent={(request, signal) => overlayAppClient.notes.notebookAgentResponse(request, {
        credentials: 'same-origin',
        signal,
      })}
      stopAgent={async ({ conversationId, turnId }) => {
        const response = await overlayAppClient.conversations.stopResponse(
          { conversationId, turnId },
          { credentials: 'same-origin' },
        )
        if (!response.ok) throw new Error('Could not stop the Notebook run.')
      }}
      agentPanelMode={toRightPanelMode(panelPresentation)}
      onAgentPanelModeChange={(mode) => setPanelPresentation(mode === 'docked' ? 'sidebar' : 'floating')}
      models={models}
      initialModelId={initialModelId}
      onModelChange={(modelId) => {
        try { localStorage.setItem(ACT_MODEL_KEY, modelId) } catch { /* storage may be unavailable */ }
      }}
      onNavigateNote={(noteId) => router.replace(buildWorkspaceHref(null, `/app/notes?id=${encodeURIComponent(noteId)}`, scope))}
      onBackToFiles={() => router.push(buildWorkspaceHref(null, '/app/files', scope))}
      renderExportMenu={({ note, title, content }) => (
        <>
        <ScopeItemActions
          kind="content"
          resource="files"
          item={note}
          onChanged={() => {
            // The note left this scope (or was archived): back to the list it belongs to.
            router.push(buildWorkspaceHref(null, '/app/files', scope))
          }}
        />
        <ExportMenu
          type="note"
          title={title}
          content={content}
          metadata={{ createdAt: note.createdAt, updatedAt: note.updatedAt }}
          renderShareDialog={(props) => <ShareDialog {...props} />}
        />
        </>
      )}
      renderAgentInput={(input) => (
        <MentionInput
          value={input.value}
          onChange={input.onChange}
          onMentionsChange={input.onMentionsChange}
          onUploadFile={() => undefined}
          onKeyDown={input.onKeyDown}
          placeholder={input.placeholder}
          disabled={input.disabled}
        />
      )}
      renderMarkdown={(text, streaming) => <MarkdownMessage text={text} isStreaming={streaming} />}
      logo={(
        <span className="mt-0.5 shrink-0 select-none">
          <OverlayMark motion="look" size={14} label="" />
        </span>
      )}
    />
  )
}
