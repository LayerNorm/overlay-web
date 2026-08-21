'use client'

import dynamic from 'next/dynamic'
import NextImage from 'next/image'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  readStoredPanelPresentation,
  storePanelPresentation,
  toRightPanelMode,
  type PanelPresentation,
} from '@/shared/ui/panel-presentation'
import { useCallback, useMemo, useState } from 'react'
import {
  KNOWLEDGE_ENTITY_MUTATION_EVENT,
  createKnowledgeMutationPublisher,
  createLocalNotebookNote,
  type CreateNoteResponse,
  type NoteDoc,
  type UpdateNoteResponse,
} from '@overlay/app-core'
import {
  CanonicalNotebookEditor,
  type NotebookEditorRepository,
} from '@overlay/modules-react/notes'
import { ExportMenu } from '@/features/files/components/ExportMenu'
import { ShareDialog } from '@/features/share/components/ShareDialog'
import { MentionInput } from '@/features/chat/components/chat-interface/MentionInput'
import { overlayAppClient } from '@/shared/app/overlay-app-client'
import { ACT_MODEL_KEY, readStoredActModelId } from '@/shared/chat/chat-model-prefs'
import { getModelsByIntelligence } from '@/shared/ai/gateway/model-data'

const MarkdownMessage = dynamic(() =>
  import('@overlay/chat-react').then((module) => ({ default: module.MarkdownMessage })),
)

const nextNotebookMutation = createKnowledgeMutationPublisher(
  `web-notebook:${globalThis.crypto?.randomUUID?.() ?? Date.now()}`,
)

function publishNotebookMutation(
  id: string,
  operation: 'created' | 'updated' | 'deleted',
): void {
  window.dispatchEvent(new CustomEvent(KNOWLEDGE_ENTITY_MUTATION_EVENT, {
    detail: nextNotebookMutation({ entity: 'note', id, operation }),
  }))
}

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
  const models = useMemo(
    () => getModelsByIntelligence(false).map(({ id, name }) => ({ id, name })),
    [],
  )
  const initialModelId = useMemo(() => readStoredActModelId(), [])

  // Shared with the chat sources panel so both surfaces present the same way.
  const [panelPresentation, setPanelPresentationState] = useState(readStoredPanelPresentation)
  const setPanelPresentation = useCallback((presentation: PanelPresentation) => {
    setPanelPresentationState(presentation)
    storePanelPresentation(presentation)
  }, [])

  const repository = useMemo<NotebookEditorRepository>(() => ({
    list: (signal) => overlayAppClient.notes.get<NoteDoc[]>({ limit: 100 }, { signal }),
    get: (noteId, signal) => overlayAppClient.notes.get<NoteDoc>({ noteId }, { signal }).catch((error: unknown) => {
      if (error instanceof DOMException && error.name === 'AbortError') throw error
      return null
    }),
    async create() {
      const result = await overlayAppClient.notes.create({ title: 'Untitled', content: '' }) as CreateNoteResponse
      publishNotebookMutation(result.note?._id ?? result.id, 'created')
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
      publishNotebookMutation(body?.note?._id ?? noteId, 'updated')
      return { note: body?.note }
    },
    async delete(noteId) {
      const response = await overlayAppClient.notes.deleteResponse({ noteId })
      if (!response.ok) throw new Error('Could not delete note')
      publishNotebookMutation(noteId, 'deleted')
    },
  }), [])

  return (
    <CanonicalNotebookEditor
      noteId={searchParams?.get('id') ?? null}
      hideSidebar={hideSidebar}
      projectName={projectName}
      repository={repository}
      runAgent={(request, signal) => overlayAppClient.notes.notebookAgentResponse(request, {
        credentials: 'same-origin',
        signal,
      })}
      agentPanelMode={toRightPanelMode(panelPresentation)}
      onAgentPanelModeChange={(mode) => setPanelPresentation(mode === 'docked' ? 'sidebar' : 'floating')}
      models={models}
      initialModelId={initialModelId}
      onModelChange={(modelId) => {
        try { localStorage.setItem(ACT_MODEL_KEY, modelId) } catch { /* storage may be unavailable */ }
      }}
      onNavigateNote={(noteId) => router.replace(`/app/notes?id=${encodeURIComponent(noteId)}`)}
      onBackToFiles={() => router.push('/app/files')}
      renderExportMenu={({ note, title, content }) => (
        <ExportMenu
          type="note"
          title={title}
          content={content}
          metadata={{ createdAt: note.createdAt, updatedAt: note.updatedAt }}
          renderShareDialog={(props) => <ShareDialog {...props} />}
        />
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
        <NextImage
          src="/assets/overlay-logo.png"
          alt=""
          width={14}
          height={14}
          className="mt-0.5 size-3.5 shrink-0 select-none"
          draggable={false}
        />
      )}
    />
  )
}
