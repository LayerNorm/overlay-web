'use client'

// Canonical notebook editor. Platform routing, persistence, and rich host UI
// are supplied through the adapter props declared below.

import {
  useState,
  useCallback,
  type ReactNode,
  type Ref,
} from 'react'
import { Orb } from '@overlay/ui'
import { EditorContent } from '@tiptap/react'
import {
  Check,
  ChevronDown,
} from 'lucide-react'
import { SlashMenu } from './slash-menu'
import {
  type NotebookEditorConflict,
  type NotebookNote,
  type NoteDoc,
  type NotebookAgentRequest,
} from '@overlay/app-core'
import { NotebookAgentComposer, NotebookAgentPanel } from './agent-panel'
import { NotebookAgentHeader, NotebookHeader } from './header'
import {
  NotebookEmptyState,
  NotebookNotesSidebar,
  type NotebookNotesSidebarProps,
} from './sidebar'
import { NotebookFloatingFormatToolbar } from './format-toolbar'
import { AppScreenBody, AppScreenShell } from '../shell'
import { getPendingDiffs } from './inline-diff-extension'
import {
  useEditorLifecycle,
  useEditorRequests,
  useNotebookAgent,
  useNotebookEditor,
  useNotebookNotes,
  useNoteMutations,
  useSlashMenu,
  useSlashMenuState,
} from './editor-state'

export interface NotebookEditorMention {
  type: string
  id: string
  name: string
}

export interface NotebookEditorModel {
  id: string
  name: string
}

export interface NotebookEditorRepository {
  list(signal?: AbortSignal): Promise<NoteDoc[]>
  get(noteId: string, signal?: AbortSignal): Promise<NoteDoc | null>
  create(input?: { title?: string; content?: string }): Promise<NoteDoc>
  save(input: {
    noteId: string
    title: string
    content: string
    expectedUpdatedAt?: number
  }): Promise<{ note?: NoteDoc | null; conflict?: NotebookEditorConflict }>
  delete?(noteId: string): Promise<void>
}

export interface NotebookEditorMediaAdapter {
  persistImage(file: File): Promise<{ src: string; alt?: string }>
}

export interface NotebookAgentComposerRenderProps {
  value: string
  disabled: boolean
  running: boolean
  canSend: boolean
  placeholder: string
  models: readonly NotebookEditorModel[]
  selectedModelId: string
  onChange(value: string): void
  onMentionsChange(mentions: NotebookEditorMention[]): void
  onModelChange(modelId: string): void
  onKeyDown(event: React.KeyboardEvent): void
  onSend(): void
  onStop(): void
}

export interface NotebookEditorHeaderRenderProps {
  activeNote: NotebookNote | null
  loading: boolean
  title: string
  isDirty: boolean
  agentPanelOpen: boolean
  onCreateNote(): void
  onDeleteNote?(): void
  onTitleChange(value: string): void
  onTitleBlur(): void
  onTitleKeyDown(event: React.KeyboardEvent<HTMLInputElement>): void
  onToggleAgentPanel(): void
}

export interface CanonicalNotebookEditorProps {
  noteId: string | null
  hideSidebar?: boolean
  showNotesSidebar?: boolean
  hideBackButton?: boolean
  compactHeader?: boolean
  selectionPending?: boolean
  headerLeading?: ReactNode
  projectName?: string
  repository: NotebookEditorRepository
  runAgent(request: NotebookAgentRequest, signal: AbortSignal): Promise<Response>
  models: readonly NotebookEditorModel[]
  initialModelId: string
  onModelChange?(modelId: string): void
  onNavigateNote(noteId: string): void
  onBackToFiles(): void
  onNoteChanged?(note: NotebookNote): void
  renderExportMenu?(input: { note: NotebookNote; title: string; content: string }): ReactNode
  renderAgentInput?(input: {
    value: string
    disabled: boolean
    placeholder: string
    onChange(value: string): void
    onMentionsChange(mentions: NotebookEditorMention[]): void
    onKeyDown(event: React.KeyboardEvent<HTMLElement>): void
  }): ReactNode
  renderMarkdown?(text: string, streaming: boolean): ReactNode
  logo?: ReactNode
  media?: NotebookEditorMediaAdapter
  focusRequest?: number
  contentContainerRef?: Ref<HTMLDivElement>
  externalInsertion?: { id: string; text: string }
  controlledAgentPanelOpen?: boolean
  agentPanelMode?: 'docked' | 'floating'
  /** Lets the assistant header move itself between floating and docked. */
  onAgentPanelModeChange?: (mode: 'docked' | 'floating') => void
  createNoteRequest?: number
  onHydrated?(note: NotebookNote): void
  onAgentPanelOpenChange?(open: boolean): void
  onDeleteNote?(noteId: string): void
  renderNotesSidebar?(props: NotebookNotesSidebarProps): ReactNode
  renderAgentComposer?(props: NotebookAgentComposerRenderProps): ReactNode
  renderHeader?(props: NotebookEditorHeaderRenderProps): ReactNode
}

type EditorLifecycle = ReturnType<typeof useEditorLifecycle>
type SlashState = ReturnType<typeof useSlashMenuState>
type SlashMenuApi = ReturnType<typeof useSlashMenu>
type NoteMutations = ReturnType<typeof useNoteMutations>
type NotebookAgent = ReturnType<typeof useNotebookAgent>
type TiptapEditor = ReturnType<typeof useNotebookEditor>['editor']

function NotebookModelPicker({
  models,
  selectedModelId,
  agentRunning,
  showModelPicker,
  modelPickerRef,
  setSelectedModelId,
  setShowModelPicker,
  onModelChange,
}: {
  models: readonly NotebookEditorModel[]
  selectedModelId: string
  agentRunning: boolean
  showModelPicker: boolean
  modelPickerRef: NotebookAgent['modelPickerRef']
  setSelectedModelId: NotebookAgent['setSelectedModelId']
  setShowModelPicker: NotebookAgent['setShowModelPicker']
  onModelChange?: (modelId: string) => void
}) {
  return (
    <div ref={modelPickerRef} className="relative">
      <button
        type="button"
        onClick={() => !agentRunning && setShowModelPicker((v) => !v)}
        disabled={agentRunning}
        className={`flex h-8 min-h-8 items-center justify-between gap-2 rounded-md bg-[var(--surface-subtle)] px-2.5 py-0 text-left text-xs leading-none md:py-1 ${
          agentRunning ? 'cursor-not-allowed text-[var(--muted-light)]' : 'text-[var(--muted)] hover:bg-[var(--border)]'
        }`}
      >
        <span className='min-w-0 truncate'>
          {models.find((model) => model.id === selectedModelId)?.name ??
            selectedModelId}
        </span>
        <ChevronDown size={11} className="shrink-0" />
      </button>
      {showModelPicker && (
        <div className="overlay-pop-in absolute right-0 top-full z-20 mt-1 w-64 max-w-[calc(100vw-1.5rem)] rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)] py-1 shadow-lg">
          <div className="max-h-72 overflow-y-auto">
            {models.map((m) => {
              const isSel = m.id === selectedModelId
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => {
                    setSelectedModelId(m.id)
                    onModelChange?.(m.id)
                    setShowModelPicker(false)
                  }}
                  className={`w-full text-left px-3 py-1.5 text-xs flex items-center justify-between hover:bg-[var(--surface-muted)] ${
                    isSel ? 'text-[var(--foreground)] font-medium' : 'text-[var(--muted)]'
                  }`}
                >
                  <span className="flex items-center gap-2">
                    {isSel ? (
                      <Check size={10} />
                    ) : (
                      <span className='w-[10px] inline-block' />
                    )}
                    {m.name}
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

function NotebookAssistantHeader({
  editor,
  modelPicker,
  agentPanelMode,
  onAgentPanelModeChange,
  onToggleAgentPanel,
}: {
  editor: TiptapEditor
  modelPicker: ReactNode
  agentPanelMode: 'docked' | 'floating'
  onAgentPanelModeChange?: (mode: 'docked' | 'floating') => void
  onToggleAgentPanel: () => Promise<void>
}) {
  return (
    <NotebookAgentHeader
      pendingDiffCount={editor ? getPendingDiffs(editor).length : 0}
      modelPicker={modelPicker}
      presentation={
        onAgentPanelModeChange
          ? agentPanelMode === 'docked'
            ? 'sidebar'
            : 'floating'
          : undefined
      }
      onPresentationChange={
        onAgentPanelModeChange
          ? (presentation) =>
              onAgentPanelModeChange(
                presentation === 'sidebar' ? 'docked' : 'floating',
              )
          : undefined
      }
      onAcceptAllDiffs={() => editor?.chain().focus().acceptAllDiffs().run()}
      onRejectAllDiffs={() => editor?.chain().focus().rejectAllDiffs().run()}
      onClose={() => void onToggleAgentPanel()}
    />
  )
}

function NotebookAgentComposerArea({
  agent,
  models,
  onModelChange,
  renderAgentComposer,
  renderAgentInput,
}: {
  agent: NotebookAgent
  models: readonly NotebookEditorModel[]
  onModelChange?: (modelId: string) => void
  renderAgentComposer?: (props: NotebookAgentComposerRenderProps) => ReactNode
  renderAgentInput?: (input: {
    value: string
    disabled: boolean
    placeholder: string
    onChange(value: string): void
    onMentionsChange(mentions: NotebookEditorMention[]): void
    onKeyDown(event: React.KeyboardEvent<HTMLElement>): void
  }) => ReactNode
}) {
  const agentComposerProps: NotebookAgentComposerRenderProps = {
    value: agent.agentInput,
    disabled: agent.agentRunning,
    running: agent.agentRunning,
    canSend: Boolean(agent.agentInput.trim()),
    placeholder: 'Ask about this note or describe edits, use @ to reference files, skills...',
    models,
    selectedModelId: agent.selectedModelId,
    onChange: agent.setAgentInput,
    onMentionsChange: agent.setAgentMentions,
    onModelChange: (modelId) => {
      agent.setSelectedModelId(modelId)
      onModelChange?.(modelId)
    },
    onKeyDown: (event) => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault()
        if (!agent.agentRunning && agent.agentInput.trim()) void agent.runNotebookAgent()
      }
    },
    onSend: () => void agent.runNotebookAgent(),
    onStop: agent.stopNotebookAgent,
  }
  return renderAgentComposer?.(agentComposerProps) ?? (
    <NotebookAgentComposer
      running={agent.agentRunning}
      canSend={Boolean(agent.agentInput.trim())}
      onSend={() => void agent.runNotebookAgent()}
      onStop={agent.stopNotebookAgent}
      input={
        renderAgentInput?.({
          value: agent.agentInput,
          onChange: agent.setAgentInput,
          onMentionsChange: agent.setAgentMentions,
          onKeyDown: (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              if (!agent.agentRunning && agent.agentInput.trim()) void agent.runNotebookAgent()
            }
          },
          placeholder: 'Ask about this note or describe edits, use @ to reference files, skills...',
          disabled: agent.agentRunning,
        }) ?? (
          <textarea
            aria-label="Ask about this note"
            value={agent.agentInput}
            onChange={(event) => agent.setAgentInput(event.target.value)}
            disabled={agent.agentRunning}
            placeholder="Ask about this note or describe edits..."
            className="min-h-20 w-full resize-none bg-transparent text-sm outline-none"
          />
        )
      }
    />
  )
}

function NotebookEditorBody({
  lifecycle,
  mutations,
  slashState,
  slashMenu,
  editor,
  showNotesSidebar,
  renderNotesSidebar,
  onNavigateNote,
  contentContainerRef,
  showFloatingFormatToolbar,
  setShowFloatingFormatToolbar,
  resolvingRequestedNote,
}: {
  lifecycle: EditorLifecycle
  mutations: NoteMutations
  slashState: SlashState
  slashMenu: SlashMenuApi
  editor: TiptapEditor
  showNotesSidebar?: boolean
  renderNotesSidebar?: (props: NotebookNotesSidebarProps) => ReactNode
  onNavigateNote: (noteId: string) => void
  contentContainerRef?: Ref<HTMLDivElement>
  showFloatingFormatToolbar: boolean
  setShowFloatingFormatToolbar: (open: boolean) => void
  resolvingRequestedNote: boolean
}) {
  const { notes, activeNote, editorConflict } = lifecycle
  return (
    <AppScreenBody padding="none" maxWidth="none" scroll="hidden" className="relative flex h-full flex-row">
      {showNotesSidebar
        ? (renderNotesSidebar?.({
            notes,
            activeNoteId: activeNote?._id,
            onCreateNote: () => void mutations.createNote(),
            onOpenNote: (note) => onNavigateNote(note._id),
            onDeleteNote: mutations.deleteSidebarNote,
          }) ?? (
            <NotebookNotesSidebar
              notes={notes}
              activeNoteId={activeNote?._id}
              onCreateNote={() => void mutations.createNote()}
              onOpenNote={(note) => onNavigateNote(note._id)}
              onDeleteNote={mutations.deleteSidebarNote}
            />
          ))
        : null}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {activeNote ? (
          <>
          {editorConflict ? (
            <div className="shrink-0 border-b border-amber-500/30 bg-amber-500/10 px-6 py-2 text-xs text-amber-800 dark:text-amber-200" role="alert">
              {editorConflict.message} Your local draft has been preserved.
            </div>
          ) : null}
          <div className="flex min-h-0 min-w-0 flex-1 flex-row overflow-hidden">
            <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
              <div ref={contentContainerRef} className="h-full overflow-y-auto px-6 py-4">
                <EditorContent editor={editor} />
              </div>

              <NotebookFloatingFormatToolbar
                editor={editor}
                open={showFloatingFormatToolbar}
                onOpenChange={setShowFloatingFormatToolbar}
              />
            </div>
          </div>
          <SlashMenu
            showSlashMenu={slashState.showSlashMenu}
            slashMenuPosition={slashState.slashMenuPosition}
            slashMenuFilter={slashState.slashMenuFilter}
            selectedSlashIndex={slashState.selectedSlashIndex}
            setSelectedSlashIndex={slashState.setSelectedSlashIndex}
            filteredSlashItems={slashMenu.filteredSlashItems}
            executeSlashCommand={slashMenu.executeSlashCommand}
            onClose={() => {
              slashState.setShowSlashMenu(false)
              slashState.setSlashMenuFilter('')
            }}
          />
          </>
        ) : resolvingRequestedNote ? (
          <div className="h-full w-full" aria-busy="true">
            <span className="sr-only">Loading note</span>
          </div>
        ) : (
          <NotebookEmptyState onCreateNote={() => void mutations.createNote()} />
        )}
      </div>
    </AppScreenBody>
  )
}

function notebookChromeElements({
  agent,
  editor,
  agentPanelMode,
  onAgentPanelModeChange,
  models,
  onModelChange,
  renderAgentComposer,
  renderAgentInput,
}: {
  agent: ReturnType<typeof useNotebookAgent>
  editor: ReturnType<typeof useNotebookEditor>['editor']
  agentPanelMode: 'docked' | 'floating'
  onAgentPanelModeChange: CanonicalNotebookEditorProps['onAgentPanelModeChange']
  models: CanonicalNotebookEditorProps['models']
  onModelChange: CanonicalNotebookEditorProps['onModelChange']
  renderAgentComposer: CanonicalNotebookEditorProps['renderAgentComposer']
  renderAgentInput: CanonicalNotebookEditorProps['renderAgentInput']
}) {
  const modelPicker = (
    <NotebookModelPicker
      models={models}
      selectedModelId={agent.selectedModelId}
      agentRunning={agent.agentRunning}
      showModelPicker={agent.showModelPicker}
      modelPickerRef={agent.modelPickerRef}
      setSelectedModelId={agent.setSelectedModelId}
      setShowModelPicker={agent.setShowModelPicker}
      onModelChange={onModelChange}
    />
  )

  const assistantHeader = (
    <NotebookAssistantHeader
      editor={editor}
      modelPicker={modelPicker}
      agentPanelMode={agentPanelMode}
      onAgentPanelModeChange={onAgentPanelModeChange}
      onToggleAgentPanel={agent.handleToggleAgentPanel}
    />
  )

  const agentComposer = (
    <NotebookAgentComposerArea
      agent={agent}
      models={models}
      onModelChange={onModelChange}
      renderAgentComposer={renderAgentComposer}
      renderAgentInput={renderAgentInput}
    />
  )

  return { modelPicker, assistantHeader, agentComposer }
}

function NotebookHeaderBlock({
  renderHeader,
  activeNote,
  resolvingRequestedNote,
  compactHeader,
  title,
  projectName,
  isDirty,
  agentPanelOpen,
  headerLeading,
  hideBackButton,
  repository,
  mutations,
  renderExportMenu,
  editor,
  handleBackToFiles,
  agent,
}: {
  renderHeader: CanonicalNotebookEditorProps['renderHeader']
  activeNote: ReturnType<typeof useEditorLifecycle>['activeNote']
  resolvingRequestedNote: boolean
  compactHeader: CanonicalNotebookEditorProps['compactHeader']
  title: string
  projectName: CanonicalNotebookEditorProps['projectName']
  isDirty: boolean
  agentPanelOpen: boolean
  headerLeading: CanonicalNotebookEditorProps['headerLeading']
  hideBackButton: CanonicalNotebookEditorProps['hideBackButton']
  repository: CanonicalNotebookEditorProps['repository']
  mutations: ReturnType<typeof useNoteMutations>
  renderExportMenu: CanonicalNotebookEditorProps['renderExportMenu']
  editor: ReturnType<typeof useNotebookEditor>['editor']
  handleBackToFiles: () => Promise<void>
  agent: ReturnType<typeof useNotebookAgent>
}) {
  const notebookHeaderProps: NotebookEditorHeaderRenderProps = {
    activeNote,
    loading: resolvingRequestedNote,
    title,
    isDirty,
    agentPanelOpen,
    onCreateNote: () => void mutations.createNote(),
    onDeleteNote: repository.delete && activeNote ? () => void mutations.deleteNote(activeNote._id) : undefined,
    onTitleChange: mutations.updateTitle,
    onTitleBlur: () => void mutations.commitTitleChange(),
    onTitleKeyDown: mutations.handleTitleKeyDown,
    onToggleAgentPanel: () => void agent.handleToggleAgentPanel(),
  }
  if (renderHeader) {
    return <>{renderHeader(notebookHeaderProps)}</>
  }
  return (
    <NotebookHeader
      activeNote={activeNote}
      loading={resolvingRequestedNote}
      compact={compactHeader}
      title={title}
      projectName={projectName}
      isDirty={isDirty}
      agentPanelOpen={agentPanelOpen}
      leading={headerLeading}
      hideBackButton={hideBackButton}
      onDeleteNote={repository.delete && activeNote ? () => void mutations.deleteNote(activeNote._id) : undefined}
      exportMenu={activeNote ? renderExportMenu?.({
        note: activeNote,
        title: title || 'Untitled',
        content: editor?.getHTML() || activeNote.content || '',
      }) : null}
      onBackToFiles={() => void handleBackToFiles()}
      onCreateNote={() => void mutations.createNote()}
      onTitleChange={mutations.handleTitleChange}
      onTitleBlur={() => void mutations.commitTitleChange()}
      onTitleKeyDown={mutations.handleTitleKeyDown}
      onToggleAgentPanel={() => void agent.handleToggleAgentPanel()}
    />
  )
}

export function CanonicalNotebookEditor({
  noteId,
  hideSidebar,
  showNotesSidebar,
  hideBackButton,
  compactHeader,
  selectionPending,
  headerLeading,
  projectName,
  repository,
  runAgent,
  models,
  initialModelId,
  onModelChange,
  onNavigateNote,
  onBackToFiles,
  onNoteChanged,
  renderExportMenu,
  renderAgentInput,
  renderMarkdown,
  logo,
  media,
  focusRequest,
  contentContainerRef,
  externalInsertion,
  controlledAgentPanelOpen,
  agentPanelMode = 'floating',
  onAgentPanelModeChange,
  createNoteRequest,
  onHydrated,
  onAgentPanelOpenChange,
  onDeleteNote,
  renderNotesSidebar,
  renderAgentComposer,
  renderHeader,
}: CanonicalNotebookEditorProps) {
  const lifecycle = useEditorLifecycle({ repository, hideSidebar, onNoteChanged, media })
  const {
    notes,
    setNotes,
    activeNote,
    setActiveNote,
    title,
    setTitle,
    isDirty,
    lifecycleController,
    activeNoteRef,
    titleRef,
    hydratingEditorRef,
    flushSaveRef,
    mediaRef,
  } = lifecycle

  const slashState = useSlashMenuState()
  const { editor } = useNotebookEditor({
    lifecycleController,
    activeNoteRef,
    titleRef,
    hydratingEditorRef,
    mediaRef,
    slashState,
  })

  const notesApi = useNotebookNotes({
    noteId,
    hideSidebar,
    repository,
    onNavigateNote,
    onHydrated,
    lifecycleController,
    activeNote,
    setNotes,
    setActiveNote,
    setTitle,
    hydratingEditorRef,
    editor,
  })

  useEditorRequests({ editor, focusRequest, externalInsertion })
  const slashMenu = useSlashMenu({ editor, slashState })

  const mutations = useNoteMutations({
    repository,
    notes,
    setNotes,
    setActiveNote,
    setTitle,
    editor,
    lifecycleController,
    activeNoteRef,
    titleRef,
    flushSaveRef,
    onNoteChanged,
    onDeleteNote,
    onNavigateNote,
    openNote: notesApi.openNote,
    createNoteRequest,
  })

  const agent = useNotebookAgent({
    runAgent,
    editor,
    activeNote,
    title,
    initialModelId,
    flushSaveRef,
    controlledAgentPanelOpen,
    onAgentPanelOpenChange,
  })

  const [showFloatingFormatToolbar, setShowFloatingFormatToolbar] = useState(false)

  const handleBackToFiles = useCallback(async () => {
    await flushSaveRef.current()
    onBackToFiles()
  }, [flushSaveRef, onBackToFiles])

  const { assistantHeader, agentComposer } = notebookChromeElements({
    agent,
    editor,
    agentPanelMode,
    onAgentPanelModeChange,
    models,
    onModelChange,
    renderAgentComposer,
    renderAgentInput,
  })

  const overlayLogo = logo ?? (
    <span className="overlay-stream-marker h-3.5 w-3.5" aria-hidden>
      <Orb variant="metal" size={14} animated={false} label="" />
    </span>
  )
  const resolvingRequestedNote = Boolean(selectionPending || (noteId && activeNote?._id !== noteId))
  return (
    <AppScreenShell
      header={
        <NotebookHeaderBlock
          renderHeader={renderHeader}
          activeNote={activeNote}
          resolvingRequestedNote={resolvingRequestedNote}
          compactHeader={compactHeader}
          title={title}
          projectName={projectName}
          isDirty={isDirty}
          agentPanelOpen={agent.agentPanelOpen}
          headerLeading={headerLeading}
          hideBackButton={hideBackButton}
          repository={repository}
          mutations={mutations}
          renderExportMenu={renderExportMenu}
          editor={editor}
          handleBackToFiles={handleBackToFiles}
          agent={agent}
        />
      }
      rightPanel={agent.agentPanelOpen && activeNote ? (
        <NotebookAgentPanel
          header={assistantHeader}
          items={agent.agentItems}
          running={agent.agentRunning}
          logo={overlayLogo}
          composer={agentComposer}
            renderMarkdownMessage={(text, isStreaming) =>
              renderMarkdown?.(text, isStreaming) ?? (
                <p className='whitespace-pre-wrap text-sm leading-relaxed'>
                  {text}
                </p>
              )
            }
        />
      ) : null}
      rightPanelOpen={agent.agentPanelOpen && Boolean(activeNote)}
      rightPanelWidth={400}
      rightPanelMode={agentPanelMode}
      onRightPanelClose={() => void agent.handleToggleAgentPanel()}
    >
      <NotebookEditorBody
        lifecycle={lifecycle}
        mutations={mutations}
        slashState={slashState}
        slashMenu={slashMenu}
        editor={editor}
        showNotesSidebar={showNotesSidebar}
        renderNotesSidebar={renderNotesSidebar}
        onNavigateNote={onNavigateNote}
        contentContainerRef={contentContainerRef}
        showFloatingFormatToolbar={showFloatingFormatToolbar}
        setShowFloatingFormatToolbar={setShowFloatingFormatToolbar}
        resolvingRequestedNote={resolvingRequestedNote}
      />
    </AppScreenShell>
  )
}
