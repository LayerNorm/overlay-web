import { useEffect, useMemo, useState, type ReactNode, type RefObject } from 'react'
import {
  CanonicalNotebookEditor,
  type NotebookEditorHeaderRenderProps,
  type NotebookEditorMediaAdapter,
} from '@overlay/modules-react/notes'
import type { NotebookEditorMention } from '@overlay/modules-react/notes'
import type { NotebookNote } from '@overlay/app-core'
import { ChatInputArea } from '../../components/chat/ChatInputArea'
import type { Mention } from '../../components/chat/MentionInput'
import { panelThemeToSharedCssVars } from '../../components/chat/themeBridge'
import { PanelSidebarFrame } from '../../components/panel/PanelSidebarFrame'
import { useAppBootstrap } from '../../contexts/AppBootstrapContext'
import { usePanelTheme } from '../../hooks/usePanelTheme'
import { filterToEnabledChatModels } from '../../utils/enabledChatModels'
import { overlayDesktopAppClient } from '../../services/app-api-client'
import {
  focusAfterPanelPaint,
  markPanelHydrateComplete,
  signalPanelShellReady,
} from '../../utils/panelLatency'
import { createDesktopNotebookRepository } from './desktopNotebookRepository'
import { DesktopNotebookPanelSidebar } from './DesktopNotebookPanelSidebar'
import overlayLogoUrl from '../../../../../resources/logos/overlay-chat-mark.png'

interface DesktopNotebookEditorProps {
  noteId: string | null
  showNotesSidebar?: boolean
  hideBackButton?: boolean
  compactHeader?: boolean
  headerLeading?: ReactNode
  contentContainerRef?: RefObject<HTMLDivElement | null>
  notesSearchInputRef?: RefObject<HTMLInputElement | null>
  onNavigateNote?(noteId: string): void
  onBackToFiles?(): void
  controlledAgentPanelOpen?: boolean
  createNoteRequest?: number
  onNotesSidebarClose?(): void
  onAgentPanelOpenChange?(open: boolean): void
  onActiveNoteChange?(note: NotebookNote): void
  renderHeader?(props: NotebookEditorHeaderRenderProps): ReactNode
  panelSidebar?: {
    accessTabsInSidebar: boolean
    closing: boolean
    width: number
    panelOpacity: number
    frameVisible: boolean
    openTabs: readonly { id: string; title: string }[]
    onRequestClose(): void
    onOpenChange(open: boolean): void
    onWidthChange(width: number): void
    onSelectTab(noteId: string): void
    onCloseTab(noteId: string): void
  }
}

async function fileDataUrl(file: File): Promise<string> {
  return await new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error ?? new Error('Could not read image'))
    reader.readAsDataURL(file)
  })
}

const desktopMediaAdapter: NotebookEditorMediaAdapter = {
  async persistImage(file) {
    const src = await fileDataUrl(file)
    await window.bridge.saveNotebookImage(src, file.type)
    return { src, alt: file.name }
  },
}

function toEditorMentions(mentions: Mention[]): NotebookEditorMention[] {
  return mentions.map((mention) => ({
    id: mention.id,
    type: mention.type,
    name: mention.title,
  }))
}

export function DesktopNotebookEditor({
  noteId,
  showNotesSidebar,
  hideBackButton,
  compactHeader,
  headerLeading,
  contentContainerRef,
  notesSearchInputRef,
  onNavigateNote,
  onBackToFiles,
  controlledAgentPanelOpen,
  createNoteRequest,
  onNotesSidebarClose,
  onAgentPanelOpenChange,
  onActiveNoteChange,
  renderHeader,
  panelSidebar,
}: DesktopNotebookEditorProps): React.ReactElement {
  const { bootstrap, chatModels } = useAppBootstrap()
  const { theme } = usePanelTheme()
  const repository = useMemo(() => createDesktopNotebookRepository(), [])
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(noteId)
  const [selectionPending, setSelectionPending] = useState(noteId === null)
  const [focusRequest, setFocusRequest] = useState(0)
  const [externalInsertion, setExternalInsertion] = useState<{ id: string; text: string }>()
  const enabledModels = useMemo(() => filterToEnabledChatModels(
    chatModels,
    bootstrap?.uiSettings?.enabledChatModelIds,
  ), [bootstrap?.uiSettings?.enabledChatModelIds, chatModels])
  const models = useMemo(
    () => enabledModels.map(({ id, name }) => ({ id, name })),
    [enabledModels],
  )
  const initialModelId = useMemo(() => {
    return localStorage.getItem('overlay-notebook-model')
      || bootstrap?.defaults?.chatModelId
      || models[0]?.id
      || 'openrouter/free'
  }, [bootstrap?.defaults?.chatModelId, models])

  useEffect(() => {
    setSelectedNoteId(noteId)
    if (noteId) setSelectionPending(false)
  }, [noteId])

  useEffect(() => {
    if (selectedNoteId) return
    let cancelled = false
    void (async () => {
      const assigned = window.bridge.getWindowItemId?.()
      const last = assigned || await window.bridge.getLastOpenedNoteId()
      if (last && !cancelled) setSelectedNoteId(last)
      if (!cancelled) setSelectionPending(false)
    })()
    return () => { cancelled = true }
  }, [selectedNoteId])

  useEffect(() => {
    signalPanelShellReady('notebook')
    const unsubscribe = window.bridge.onPanelVisibilityChanged?.((panelType, visible) => {
      if (panelType !== 'notebook' || !visible) return
      focusAfterPanelPaint(() => setFocusRequest((value) => value + 1))
    })
    return () => unsubscribe?.()
  }, [])

  useEffect(() => window.bridge.onNoteInputText?.((text) => {
    setExternalInsertion({ id: crypto.randomUUID(), text })
  }), [])

  useEffect(() => window.bridge.onNewNoteWithText?.((text) => {
    void repository.create({ content: text }).then((note) => setSelectedNoteId(note._id))
  }), [repository])

  useEffect(() => window.bridge.onNewNoteWithTitleAndContent?.(({ title, content }) => {
    void repository.create({ title, content }).then((note) => setSelectedNoteId(note._id))
  }), [repository])

  const navigate = (nextNoteId: string): void => {
    setSelectedNoteId(nextNoteId)
    void window.bridge.setLastOpenedNoteId(nextNoteId)
    onNavigateNote?.(nextNoteId)
  }

  return (
    <div
      className="shared-app-scope h-full min-h-0 w-full overflow-hidden"
      style={panelThemeToSharedCssVars(theme, overlayLogoUrl)}
    >
      <CanonicalNotebookEditor
        noteId={selectedNoteId}
        showNotesSidebar={showNotesSidebar}
        hideBackButton={hideBackButton}
        compactHeader={compactHeader}
        selectionPending={selectionPending}
        headerLeading={headerLeading}
        repository={repository}
        runAgent={(request, signal) => overlayDesktopAppClient.notes.notebookAgentResponse(request, { signal })}
        models={models}
        initialModelId={initialModelId}
        onModelChange={(modelId) => localStorage.setItem('overlay-notebook-model', modelId)}
        onNavigateNote={navigate}
        onBackToFiles={() => onBackToFiles?.()}
        media={desktopMediaAdapter}
        focusRequest={focusRequest}
        contentContainerRef={contentContainerRef}
        externalInsertion={externalInsertion}
        controlledAgentPanelOpen={controlledAgentPanelOpen}
        agentPanelMode="docked"
        createNoteRequest={createNoteRequest}
        onHydrated={(note) => {
          markPanelHydrateComplete('notebook')
          onActiveNoteChange?.(note)
        }}
        onAgentPanelOpenChange={onAgentPanelOpenChange}
        renderHeader={renderHeader}
        renderNotesSidebar={(sidebarProps) => (
          panelSidebar ? (
            <PanelSidebarFrame
              accessTabsInSidebar={panelSidebar.accessTabsInSidebar}
              open={Boolean(showNotesSidebar)}
              closing={panelSidebar.closing}
              width={panelSidebar.width}
              panelOpacity={panelSidebar.panelOpacity}
              frameVisible={panelSidebar.frameVisible}
              theme={theme}
              onRequestClose={panelSidebar.onRequestClose}
              onOpenChange={panelSidebar.onOpenChange}
              onWidthChange={panelSidebar.onWidthChange}
            >
              <DesktopNotebookPanelSidebar
                {...sidebarProps}
                theme={theme}
                accessTabsInSidebar={panelSidebar.accessTabsInSidebar}
                openTabs={panelSidebar.openTabs}
                onSelectTab={panelSidebar.onSelectTab}
                onCloseTab={panelSidebar.onCloseTab}
                isCollapsed={panelSidebar.width < 120}
                searchInputRef={notesSearchInputRef}
                onClose={() => onNotesSidebarClose?.()}
              />
            </PanelSidebarFrame>
          ) : (
            <DesktopNotebookPanelSidebar
              {...sidebarProps}
              theme={theme}
              accessTabsInSidebar={false}
              openTabs={[]}
              onSelectTab={() => undefined}
              onCloseTab={() => undefined}
              searchInputRef={notesSearchInputRef}
              onClose={() => onNotesSidebarClose?.()}
            />
          )
        )}
        renderAgentComposer={(composer) => (
          <ChatInputArea
            theme={theme}
            models={enabledModels}
            selectedModels={enabledModels.filter((model) => model.id === composer.selectedModelId)}
            onModelSelect={(model) => composer.onModelChange(model.id)}
            supportsVision={false}
            placeholder={composer.placeholder}
            dropdownDirection="up"
            onSend={() => composer.onSend()}
            inputValue={composer.value}
            onInputChange={composer.onChange}
            embedded
            chatMode="write"
            forceSingleSelect
            showModelSelector={false}
            showMediaControls={false}
            showScreenshotControl={false}
            isStreaming={composer.running}
            onStop={composer.onStop}
            onMentionsChange={(mentions) => composer.onMentionsChange(toEditorMentions(mentions))}
          />
        )}
        logo={<img src={overlayLogoUrl} alt="" className="mt-0.5 size-3.5 shrink-0 select-none" draggable={false} />}
      />
    </div>
  )
}
