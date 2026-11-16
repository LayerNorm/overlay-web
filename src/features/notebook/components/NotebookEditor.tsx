'use client'

import dynamic from 'next/dynamic'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  readStoredPanelPresentation,
  storePanelPresentation,
  toRightPanelMode,
  type PanelPresentation,
} from '@/shared/ui/panel-presentation'
import { useCallback, useMemo, useRef, useState, type ComponentProps } from 'react'
import {
  DEFAULT_OVERLAY_CAPABILITIES,
  type NotebookAgentRequest,
} from '@overlay/app-core'
import {
  CanonicalNotebookEditor,
  type NotebookAgentComposerRenderProps,
} from '@overlay/modules-react/notes'
import { ExportMenu } from '@/features/files/components/ExportMenu'
import { ShareDialog } from '@/features/share/components/ShareDialog'
import { ScopeItemActions } from '@/components/layout/ScopeItemActions'
import { ChatComposer } from '@/features/chat/components/ChatComposer'
import { getModelsByIntelligence } from '@/shared/ai/gateway/model-data'
import { isByokModelId } from '@/shared/ai/gateway/byok-model-conversion'
import { DEFAULT_MODEL_ID } from '@/shared/ai/gateway/model-types'
import { useWorkspaceHref } from '@/hooks/use-workspace-href'
import { usePanelScope } from '@/hooks/use-panel-scope'
import { useLiveNote } from '@/hooks/use-file-tree'
import { useMutation } from 'convex/react'
import { useWorkspace } from '@/contexts/WorkspaceContext'
import { api } from '../../../../convex/_generated/api'
import { notebookChatClientId, runNotebookChatTurn } from '../lib/notebook-chat-turn'
import { useNotebookRepository } from '@/hooks/use-notebook-repository'

const MarkdownMessage = dynamic(() =>
  import('@overlay/chat-react').then((module) => ({ default: module.MarkdownMessage })),
)

// Separate from chat's last-used model, so a note starts on the chat default until a model is picked here.
const NOTEBOOK_MODEL_KEY = 'overlay_notebook_model'

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
  const { activeWorkspaceId } = useWorkspace()
  const scope = usePanelScope()
  const models = useMemo(
    () => getModelsByIntelligence()
      .filter(({ id }) => !isByokModelId(id))
      .map(({ id, name }) => ({ id, name })),
    [],
  )
  const initialModelId = useMemo(() => {
    let storedModelId: string | null = null
    try { storedModelId = localStorage.getItem(NOTEBOOK_MODEL_KEY) } catch { /* storage may be unavailable */ }
    return models.find(({ id }) => id === storedModelId)?.id ?? DEFAULT_MODEL_ID
  }, [models])

  // Shared with the chat sources panel so both surfaces present the same way.
  const [panelPresentation, setPanelPresentationState] = useState(readStoredPanelPresentation)
  const setPanelPresentation = useCallback((presentation: PanelPresentation) => {
    setPanelPresentationState(presentation)
    storePanelPresentation(presentation)
  }, [])

  const createPersonalChat = useMutation(api.chat.personal.create)
  const noteChatIdsRef = useRef(new Map<string, string>())
  const ensureNoteChat = useCallback(async (request: NotebookAgentRequest) => {
    const known = noteChatIdsRef.current.get(request.noteId)
    if (known) return known
    if (!activeWorkspaceId) throw new Error('Choose a workspace to use the note assistant.')
    const modelId = request.modelId ?? initialModelId
    const conversationId = await createPersonalChat({
      workspaceId: activeWorkspaceId,
      clientId: notebookChatClientId(request.noteId),
      title: request.noteTitle || 'Untitled',
      askModelIds: [modelId],
      actModelId: modelId,
      lastMode: 'act',
    })
    noteChatIdsRef.current.set(request.noteId, conversationId)
    return conversationId
  }, [activeWorkspaceId, createPersonalChat, initialModelId])

  const noteId = searchParams?.get('id') ?? null
  const liveNote = useLiveNote(noteId)
  // The open note was deleted, archived or became unreadable elsewhere: go back to the files it belonged to.
  const [seenNoteId, setSeenNoteId] = useState<string | null>(null)
  if (liveNote && seenNoteId !== liveNote._id) setSeenNoteId(liveNote._id)
  const noteGone = liveNote === null && noteId !== null && seenNoteId === noteId

  const repository = useNotebookRepository()

  return (
    <CanonicalNotebookEditor
      noteId={noteId}
      liveNote={liveNote}
      noteRemoved={noteGone}
      hideSidebar={hideSidebar}
      projectName={projectName}
      repository={repository}
      runAgent={(request, signal) => runNotebookChatTurn({ request, signal, ensureConversation: ensureNoteChat })}
      agentPanelMode={toRightPanelMode(panelPresentation)}
      onAgentPanelModeChange={(mode) => setPanelPresentation(mode === 'docked' ? 'sidebar' : 'floating')}
      models={models}
      initialModelId={initialModelId}
      onModelChange={(modelId) => {
        try { localStorage.setItem(NOTEBOOK_MODEL_KEY, modelId) } catch { /* storage may be unavailable */ }
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
      renderAgentComposer={(composer) => <NotebookChatComposer {...composer} />}
      renderMarkdown={(text, streaming) => <MarkdownMessage text={text} isStreaming={streaming} />}
    />
  )
}

type ComposerProps = ComponentProps<typeof ChatComposer>
type AttachedImages = ComposerProps['attachments']['attachedImages']

const NO_IMAGES: AttachedImages = []
const ignore = () => {}

/** The chat composer, text-only: Notebook turns send the message and @ mentions, not attachments. */
function NotebookChatComposer(props: NotebookAgentComposerRenderProps) {
  const textareaRef = useRef<ComposerProps['inputState']['textareaRef']['current']>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const docInputRef = useRef<HTMLInputElement | null>(null)
  const attachMenuRef = useRef<HTMLDivElement | null>(null)
  const modeMenuRef = useRef<HTMLDivElement | null>(null)
  const [showAttachMenu, setShowAttachMenu] = useState(false)
  const [showModeMenu, setShowModeMenu] = useState(false)

  return (
    <ChatComposer
      mode="chat"
      surface={{
        textOnly: true,
        embedded: true,
        hideModeMenu: true,
        hideGenerationModes: true,
        placeholder: props.placeholder,
      }}
      emptyState={{ showCenteredEmptyChat: false, greetingLine: '' }}
      attachments={{
        attachedImages: NO_IMAGES,
        setAttachedImages: ignore,
        pendingChatDocuments: [],
        removePendingDocument: ignore,
        attachmentError: null,
        fileInputRef,
        docInputRef,
        onAddImages: ignore,
        onAddDocumentsFromPicker: ignore,
        onOpenAttachmentPreview: ignore,
        onOpenFilePreview: ignore,
      }}
      runtime={{
        composerNotice: null,
        isSendBlocked: props.running,
        isActiveLoading: props.running,
        isTemporaryChat: false,
        blockedComposerContent: null,
      }}
      inputState={{
        replyContext: null,
        setReplyContext: ignore,
        textareaRef,
        input: props.value,
        inputRevision: 0,
        onInputChange: props.onChange,
        onMentionsChange: props.onMentionsChange,
        onPaste: ignore,
        hasComposerText: props.canSend,
      }}
      toolState={{
        showAttachMenu,
        setShowAttachMenu,
        attachMenuRef,
        selectedToolIds: [],
        memoryEnabled: true,
        capabilities: DEFAULT_OVERLAY_CAPABILITIES,
        onToggleTool: ignore,
        onToggleMemory: ignore,
        onRemoveTool: ignore,
      }}
      modeState={{
        onModeChange: ignore,
        generationChip: null,
        setGenerationChip: ignore,
        showModeMenu,
        setShowModeMenu,
        modeMenuRef,
        onNavigateMode: ignore,
      }}
      actions={{ onSend: props.onSend, onStop: props.onStop }}
    />
  )
}
