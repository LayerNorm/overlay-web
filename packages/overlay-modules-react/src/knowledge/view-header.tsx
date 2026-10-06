'use client'

import React, { createContext, useContext, type ReactNode } from 'react'
import {
  ArrowLeft,
  ChevronRight,
  FolderInput,
  FolderOpen,
  LayoutGrid,
  LayoutList,
  Plus,
  RefreshCw,
  SquareMousePointer,
  Trash2,
} from 'lucide-react'
import type {
  KnowledgeFileNode as FileNode,
  KnowledgeOutputFilter as OutputFilter,
  KnowledgeTab as Tab,
} from '@overlay/app-core'
import { AppScreenHeader } from '@overlay/modules-react/shell'
import { HeaderSearch } from '@overlay/ui/primitives'
import { FilesCreateUploadControls, OutputFilterMenu } from './toolbar-menus'

const TOOLBAR_ICON_BUTTON_CLASS =
  'inline-flex h-8 min-h-8 w-8 items-center justify-center rounded-md border border-[var(--border)] bg-[var(--surface-elevated)] text-[var(--muted)] transition-colors hover:bg-[var(--surface-subtle)] hover:text-[var(--foreground)]'

const TOOLBAR_FILLED_BUTTON_CLASS =
  'inline-flex h-8 min-h-8 items-center gap-1.5 rounded-md border border-[var(--border)] bg-[var(--surface-subtle)] px-2.5 py-0 text-xs leading-none text-[var(--foreground)] transition-colors hover:bg-[var(--border)]'

type KnowledgeLayout = 'list' | 'cards'
type FilesCategory = 'all' | 'notes' | 'files' | 'outputs'

function SelectedFileHeader({
  fileTitle,
  isSavingFile,
  onClose,
  onTitleChange,
}: {
  fileTitle: string
  isSavingFile: boolean
  onClose: () => void
  onTitleChange: (value: string) => void
}) {
  return (
    <>
      <button
        type="button"
        onClick={onClose}
        title="Back to files"
        className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-[var(--muted)] transition-colors hover:bg-[var(--surface-subtle)] hover:text-[var(--foreground)]"
      >
        <ArrowLeft size={17} />
      </button>
      <input
        type="text"
        aria-label="File title"
        value={fileTitle}
        onChange={(e) => onTitleChange(e.target.value)}
        placeholder="File title..."
        className="min-w-0 flex-1 bg-transparent font-medium text-xl text-[var(--foreground)] outline-none placeholder:text-[var(--muted)]"
        style={{ fontFamily: 'var(--font-serif)' }}
      />
      {isSavingFile ? (
        <span className="shrink-0 text-[11px] text-[var(--muted-light)]">Saving...</span>
      ) : null}
    </>
  )
}

function FolderHeader({
  activeFolder,
  folderBreadcrumb,
  itemCount,
  memorySearchOpen,
  moveFileToParent,
  navigateToFolder,
}: {
  activeFolder: FileNode
  folderBreadcrumb: FileNode[]
  itemCount: number
  memorySearchOpen: boolean
  moveFileToParent: (fileId: string, parentId: string | null) => void
  navigateToFolder: (folderId: string | null) => void
}) {
  return (
    <div className="flex min-w-0 shrink flex-1 items-center gap-2">
      <button
        type="button"
        onClick={() => navigateToFolder(activeFolder.parentId)}
        onDragOver={(e) => {
          if (!e.dataTransfer.types.includes('application/x-overlay-file-id')) return
          e.preventDefault()
          e.dataTransfer.dropEffect = 'move'
        }}
        onDrop={(e) => {
          e.preventDefault()
          const fileId = e.dataTransfer.getData('application/x-overlay-file-id')
          if (!fileId || fileId === activeFolder._id) return
          moveFileToParent(fileId, activeFolder.parentId)
        }}
        title={activeFolder.parentId ? 'Back to parent folder' : 'Back to all files'}
        className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-[var(--muted)] transition-colors hover:bg-[var(--surface-subtle)] hover:text-[var(--foreground)]"
      >
        <ArrowLeft size={17} />
      </button>
      <FolderOpen size={18} className="shrink-0 text-[var(--muted-light)]" />
      <nav aria-label="Folder breadcrumbs" className="flex min-w-0 items-center gap-1 truncate text-sm">
        <button
          type="button"
          onClick={() => navigateToFolder(null)}
          className="shrink-0 text-[var(--muted)] transition-colors hover:text-[var(--foreground)]"
        >
          Files
        </button>
        {folderBreadcrumb.map((node, i) => (
          <span key={node._id} className="flex min-w-0 items-center gap-1">
            <ChevronRight size={12} className="shrink-0 text-[var(--muted-light)]" />
            {i === folderBreadcrumb.length - 1 ? (
              <span aria-current="page" className="truncate font-medium text-[var(--foreground)]">{node.name}</span>
            ) : (
              <button
                type="button"
                onClick={() => navigateToFolder(node._id)}
                className="truncate text-[var(--muted)] transition-colors hover:text-[var(--foreground)]"
              >
                {node.name}
              </button>
            )}
          </span>
        ))}
      </nav>
      {!memorySearchOpen && (
        <span className="shrink-0 text-xs text-[var(--muted-light)]">{itemCount} items</span>
      )}
    </div>
  )
}

function HeaderTitle({
  activeTab,
  fileCount,
  filesCategory,
  memoryCount,
  memorySearchOpen,
  mode,
}: {
  activeTab: Tab
  fileCount: number
  filesCategory: FilesCategory
  memoryCount: number
  memorySearchOpen: boolean
  mode: 'knowledge' | 'files'
}) {
  const filesTitle =
    filesCategory === 'all'
      ? 'All'
      : filesCategory === 'notes'
        ? 'Notes'
        : filesCategory === 'outputs'
          ? 'Outputs'
          : 'Files'
  return (
    <div className="flex min-w-0 shrink-0 items-center gap-3">
      <h1 className="text-sm font-medium text-[var(--foreground)]">
        {mode === 'files' ? filesTitle : activeTab === 'memories' ? 'Memories' : activeTab === 'files' ? 'Files' : 'Outputs'}
      </h1>
      {activeTab !== 'outputs' && !memorySearchOpen && (
        <span className="text-xs text-[var(--muted-light)]">
          {activeTab === 'memories' ? memoryCount : fileCount} items
        </span>
      )}
    </div>
  )
}

function BulkSelectControls({
  activeTab,
  bulkDeleting,
  onBulkDeleteFiles,
  onBulkDeleteMemories,
  onBulkDeleteOutputs,
  onExitSelectMode,
  onSetSelectMode,
  selectMode,
  selectedFileCount,
  selectedMemoryCount,
  selectedOutputCount,
}: {
  activeTab: Tab
  bulkDeleting: boolean
  onBulkDeleteFiles: () => void
  onBulkDeleteMemories: () => void
  onBulkDeleteOutputs: () => void
  onExitSelectMode: () => void
  onSetSelectMode: (value: boolean) => void
  selectMode: boolean
  selectedFileCount: number
  selectedMemoryCount: number
  selectedOutputCount: number
}) {
  const renderBulkActions = useContext(KnowledgeBulkActionsContext)
  const bulkSelection = useContext(KnowledgeBulkSelectionContext)
  if (activeTab !== 'memories' && activeTab !== 'files' && activeTab !== 'outputs') return null
  const selectedCount =
    activeTab === 'memories'
      ? selectedMemoryCount
      : activeTab === 'files'
        ? selectedFileCount
        : selectedOutputCount

  if (!selectMode) {
    return (
      <button
        type="button"
        title="Select items"
        aria-label="Select items"
        onClick={() => onSetSelectMode(true)}
        className={TOOLBAR_ICON_BUTTON_CLASS}
      >
        <SquareMousePointer size={14} />
      </button>
    )
  }

  return (
    <>
      <button type="button" onClick={onExitSelectMode} className={TOOLBAR_FILLED_BUTTON_CLASS}>
        Cancel
      </button>
      {activeTab === 'files' && bulkSelection && selectedCount > 0 ? renderBulkActions?.(bulkSelection) : null}
      <button
        type="button"
        disabled={bulkDeleting || selectedCount === 0}
        onClick={() => {
          if (activeTab === 'memories') onBulkDeleteMemories()
          else if (activeTab === 'files') onBulkDeleteFiles()
          else onBulkDeleteOutputs()
        }}
        className="inline-flex h-8 min-h-8 items-center gap-1.5 rounded-md border border-red-500/25 bg-red-500/10 px-2.5 py-0 text-xs leading-none text-red-600 transition-colors hover:bg-red-500/15 disabled:cursor-not-allowed disabled:opacity-40"
      >
        <Trash2 size={13} />
        {bulkDeleting ? 'Deleting…' : `Delete (${selectedCount})`}
      </button>
    </>
  )
}

function LayoutControls({
  layout,
  onUpdateQuery,
}: {
  layout: KnowledgeLayout
  onUpdateQuery: (updates: Record<string, string | null | undefined>) => void
}) {
  return (
    <div className="flex h-8 min-h-8 items-center rounded-md border border-[var(--border)] bg-[var(--surface-muted)] p-0.5">
      <button
        type="button"
        title="List"
        aria-label="List layout"
        aria-pressed={layout === 'list'}
        onClick={() => onUpdateQuery({ layout: 'list' })}
        className={`inline-flex h-7 items-center rounded px-2 transition-colors ${
          layout === 'list'
            ? 'bg-[var(--surface-elevated)] text-[var(--foreground)] shadow-sm'
            : 'text-[var(--muted-light)] hover:text-[var(--foreground)]'
        }`}
      >
        <LayoutList size={14} strokeWidth={1.75} />
      </button>
      <button
        type="button"
        title="Cards"
        aria-label="Cards layout"
        aria-pressed={layout === 'cards'}
        onClick={() => onUpdateQuery({ layout: 'cards' })}
        className={`inline-flex h-7 items-center rounded px-2 transition-colors ${
          layout === 'cards'
            ? 'bg-[var(--surface-elevated)] text-[var(--foreground)] shadow-sm'
            : 'text-[var(--muted-light)] hover:text-[var(--foreground)]'
        }`}
      >
        <LayoutGrid size={14} strokeWidth={1.75} />
      </button>
    </div>
  )
}

function HeaderSearchForTab({
  activeTab,
  fileSearchOpen,
  fileSearchQuery,
  memorySearchOpen,
  memorySearchQuery,
  onSetFileSearchOpen,
  onSetFileSearchQuery,
  onSetMemorySearchOpen,
  onSetMemorySearchQuery,
}: {
  activeTab: Tab
  fileSearchOpen: boolean
  fileSearchQuery: string
  memorySearchOpen: boolean
  memorySearchQuery: string
  onSetFileSearchOpen: (value: boolean | ((value: boolean) => boolean)) => void
  onSetFileSearchQuery: (value: string) => void
  onSetMemorySearchOpen: (value: boolean | ((value: boolean) => boolean)) => void
  onSetMemorySearchQuery: (value: string) => void
}) {
  if (activeTab === 'files') {
    return (
      <HeaderSearch
        value={fileSearchQuery}
        onChange={onSetFileSearchQuery}
        open={fileSearchOpen}
        onOpenChange={onSetFileSearchOpen}
        label="Search files"
        placeholder="Search files…"
      />
    )
  }
  if (activeTab === 'memories') {
    return (
      <HeaderSearch
        value={memorySearchQuery}
        onChange={onSetMemorySearchQuery}
        open={memorySearchOpen}
        onOpenChange={onSetMemorySearchOpen}
        label="Search memories"
        placeholder="Search memories…"
      />
    )
  }
  return null
}

/**
 * Whether the person may add files here. A host that shows a place where nothing can be added (an archive, or a
 * workspace whose admin restricted creating) provides `false` and the create and upload controls are left out.
 */
export const KnowledgeCreateAccessContext = createContext(true)

/** The files selected in select mode, and what to call once they have left this list. */
export interface KnowledgeBulkSelection {
  nodes: readonly FileNode[]
  afterChange: () => void
}

export const KnowledgeBulkSelectionContext = createContext<KnowledgeBulkSelection | null>(null)

/**
 * Extra bulk controls shown beside Delete in select mode (the web app adds Move and Archive, which depend on who is
 * viewing). Absent means none.
 */
export const KnowledgeBulkActionsContext = createContext<((selection: KnowledgeBulkSelection) => ReactNode) | null>(null)

function TabActionControls({
  activeTab,
  activeFolder,
  createMenuOpen,
  createMenuRef,
  fileUploadRef,
  folderUploadRef,
  mode,
  onCreateNoteFile,
  onImportMemory,
  onNewMemory,
  onPickFile,
  onPickFolder,
  setCreateMenuOpen,
  setDialog,
  setDialogName,
  setUploadMenuOpen,
  uploadMenuOpen,
  uploadMenuRef,
}: {
  activeTab: Tab
  activeFolder: FileNode | null
  createMenuOpen: boolean
  createMenuRef: React.RefObject<HTMLDivElement | null>
  fileUploadRef: React.RefObject<HTMLInputElement | null>
  folderUploadRef: React.RefObject<HTMLInputElement | null>
  mode: 'knowledge' | 'files'
  onCreateNoteFile: () => void
  onImportMemory: () => void
  onNewMemory: () => void
  onPickFile?: () => void
  onPickFolder?: () => void
  setCreateMenuOpen: (value: boolean | ((value: boolean) => boolean)) => void
  setDialog: (value: { type: 'file' | 'folder'; parentId: string | null } | null) => void
  setDialogName: (value: string) => void
  setUploadMenuOpen: (value: boolean | ((value: boolean) => boolean)) => void
  uploadMenuOpen: boolean
  uploadMenuRef: React.RefObject<HTMLDivElement | null>
}) {
  const canCreate = useContext(KnowledgeCreateAccessContext)
  if (activeTab === 'memories') {
    return (
      <>
        <button type="button" onClick={onImportMemory} className={TOOLBAR_FILLED_BUTTON_CLASS}>
          <FolderInput size={13} />
          Import
        </button>
        <button type="button" onClick={onNewMemory} className={TOOLBAR_FILLED_BUTTON_CLASS}>
          <Plus size={13} />
          New Memory
        </button>
      </>
    )
  }
  if (activeTab === 'files') {
    if (!canCreate) return null
    return (
      <FilesCreateUploadControls
        activeFolder={activeFolder}
        createMenuOpen={createMenuOpen}
        createMenuRef={createMenuRef}
        fileUploadRef={fileUploadRef}
        folderUploadRef={folderUploadRef}
        mode={mode}
        onCreateNoteFile={onCreateNoteFile}
        onPickFile={onPickFile}
        onPickFolder={onPickFolder}
        setCreateMenuOpen={setCreateMenuOpen}
        setDialog={setDialog}
        setDialogName={setDialogName}
        setUploadMenuOpen={setUploadMenuOpen}
        uploadMenuOpen={uploadMenuOpen}
        uploadMenuRef={uploadMenuRef}
      />
    )
  }
  return null
}

function TabToolbar({
  activeFolder,
  activeTab,
  bulkDeleting,
  createMenuOpen,
  createMenuRef,
  fileUploadRef,
  folderUploadRef,
  layout,
  mode,
  onBulkDeleteFiles,
  onBulkDeleteMemories,
  onBulkDeleteOutputs,
  onCommitOutputFilter,
  onCreateNoteFile,
  onExitSelectMode,
  onImportMemory,
  onNewMemory,
  onPickFile,
  onPickFolder,
  onRefreshOutputs,
  onSetSelectMode,
  onUpdateQuery,
  outputFilter,
  outputFilterOpen,
  outputFilterRef,
  selectMode,
  selectedFileCount,
  selectedMemoryCount,
  selectedOutputCount,
  setCreateMenuOpen,
  setDialog,
  setDialogName,
  setOutputFilterOpen,
  setUploadMenuOpen,
  uploadMenuOpen,
  uploadMenuRef,
}: {
  activeFolder: FileNode | null
  activeTab: Tab
  bulkDeleting: boolean
  createMenuOpen: boolean
  createMenuRef: React.RefObject<HTMLDivElement | null>
  fileUploadRef: React.RefObject<HTMLInputElement | null>
  folderUploadRef: React.RefObject<HTMLInputElement | null>
  layout: KnowledgeLayout
  mode: 'knowledge' | 'files'
  onBulkDeleteFiles: () => void
  onBulkDeleteMemories: () => void
  onBulkDeleteOutputs: () => void
  onCommitOutputFilter: (filter: OutputFilter) => void
  onCreateNoteFile: () => void
  onExitSelectMode: () => void
  onImportMemory: () => void
  onNewMemory: () => void
  onPickFile?: () => void
  onPickFolder?: () => void
  onRefreshOutputs: () => void
  onSetSelectMode: (value: boolean) => void
  onUpdateQuery: (updates: Record<string, string | null | undefined>) => void
  outputFilter: OutputFilter
  outputFilterOpen: boolean
  outputFilterRef: React.RefObject<HTMLDivElement | null>
  selectMode: boolean
  selectedFileCount: number
  selectedMemoryCount: number
  selectedOutputCount: number
  setCreateMenuOpen: (value: boolean | ((value: boolean) => boolean)) => void
  setDialog: (value: { type: 'file' | 'folder'; parentId: string | null } | null) => void
  setDialogName: (value: string) => void
  setOutputFilterOpen: (value: boolean | ((value: boolean) => boolean)) => void
  setUploadMenuOpen: (value: boolean | ((value: boolean) => boolean)) => void
  uploadMenuOpen: boolean
  uploadMenuRef: React.RefObject<HTMLDivElement | null>
}) {
  return (
    <div className="flex max-w-full shrink-0 items-center gap-2 overflow-x-auto [scrollbar-width:none] max-sm:order-2 max-sm:w-full sm:ml-auto sm:w-auto sm:overflow-visible [&::-webkit-scrollbar]:hidden">
      <BulkSelectControls
        activeTab={activeTab}
        bulkDeleting={bulkDeleting}
        onBulkDeleteFiles={onBulkDeleteFiles}
        onBulkDeleteMemories={onBulkDeleteMemories}
        onBulkDeleteOutputs={onBulkDeleteOutputs}
        onExitSelectMode={onExitSelectMode}
        onSetSelectMode={onSetSelectMode}
        selectMode={selectMode}
        selectedFileCount={selectedFileCount}
        selectedMemoryCount={selectedMemoryCount}
        selectedOutputCount={selectedOutputCount}
      />
      {activeTab === 'outputs' ? (
        <OutputFilterMenu
          onCommit={onCommitOutputFilter}
          open={outputFilterOpen}
          outputFilter={outputFilter}
          outputFilterRef={outputFilterRef}
          setOpen={setOutputFilterOpen}
        />
      ) : null}
      {(activeTab === 'memories' || activeTab === 'files' || activeTab === 'outputs') ? (
        <LayoutControls layout={layout} onUpdateQuery={onUpdateQuery} />
      ) : null}
      {activeTab === 'outputs' ? (
        <button
          type="button"
          title="Refresh"
          onClick={onRefreshOutputs}
          className={TOOLBAR_ICON_BUTTON_CLASS}
        >
          <RefreshCw size={14} strokeWidth={1.75} />
        </button>
      ) : null}
      <TabActionControls
        activeTab={activeTab}
        activeFolder={activeFolder}
        createMenuOpen={createMenuOpen}
        createMenuRef={createMenuRef}
        fileUploadRef={fileUploadRef}
        folderUploadRef={folderUploadRef}
        mode={mode}
        onCreateNoteFile={onCreateNoteFile}
        onImportMemory={onImportMemory}
        onNewMemory={onNewMemory}
        onPickFile={onPickFile}
        onPickFolder={onPickFolder}
        setCreateMenuOpen={setCreateMenuOpen}
        setDialog={setDialog}
        setDialogName={setDialogName}
        setUploadMenuOpen={setUploadMenuOpen}
        uploadMenuOpen={uploadMenuOpen}
        uploadMenuRef={uploadMenuRef}
      />
    </div>
  )
}

export function KnowledgeViewHeader({
  activeFolder,
  activeTab,
  bulkDeleting,
  createMenuOpen,
  createMenuRef,
  fileCount,
  fileSearchOpen,
  fileSearchQuery,
  filesCategory,
  fileTitle,
  fileUploadRef,
  folderBreadcrumb,
  folderUploadRef,
  isSavingFile,
  layout,
  memoryCount,
  memorySearchOpen,
  memorySearchQuery,
  mode,
  moveFileToParent,
  navigateToFolder,
  onBulkDeleteFiles,
  onBulkDeleteMemories,
  onBulkDeleteOutputs,
  onCloseFile,
  onCreateNoteFile,
  onPickFile,
  onPickFolder,
  onExitSelectMode,
  onFileTitleChange,
  onSetFileSearchOpen,
  onSetFileSearchQuery,
  onImportMemory,
  onNewMemory,
  onRefreshOutputs,
  onSetMemorySearchOpen,
  onSetMemorySearchQuery,
  onSetSelectMode,
  onUpdateQuery,
  outputFilter,
  outputFilterOpen,
  outputFilterRef,
  rootItemCount,
  selectedFile,
  selectedFileCount,
  selectedMemoryCount,
  selectedOutputCount,
  selectMode,
  setCreateMenuOpen,
  setDialog,
  setDialogName,
  setOutputFilterOpen,
  setUploadMenuOpen,
  uploadMenuOpen,
  uploadMenuRef,
  onCommitOutputFilter,
}: {
  activeFolder: FileNode | null
  activeTab: Tab
  bulkDeleting: boolean
  createMenuOpen: boolean
  createMenuRef: React.RefObject<HTMLDivElement | null>
  fileCount: number
  fileSearchOpen: boolean
  fileSearchQuery: string
  filesCategory: FilesCategory
  fileTitle: string
  fileUploadRef: React.RefObject<HTMLInputElement | null>
  folderBreadcrumb: FileNode[]
  folderUploadRef: React.RefObject<HTMLInputElement | null>
  isSavingFile: boolean
  layout: KnowledgeLayout
  memoryCount: number
  memorySearchOpen: boolean
  memorySearchQuery: string
  mode: 'knowledge' | 'files'
  moveFileToParent: (fileId: string, parentId: string | null) => void
  navigateToFolder: (folderId: string | null) => void
  onBulkDeleteFiles: () => void
  onBulkDeleteMemories: () => void
  onBulkDeleteOutputs: () => void
  onCloseFile: () => void
  onCreateNoteFile: () => void
  onPickFile?: () => void
  onPickFolder?: () => void
  onExitSelectMode: () => void
  onFileTitleChange: (value: string) => void
  onSetFileSearchOpen: (value: boolean | ((value: boolean) => boolean)) => void
  onSetFileSearchQuery: (value: string) => void
  onImportMemory: () => void
  onNewMemory: () => void
  onRefreshOutputs: () => void
  onSetMemorySearchOpen: (value: boolean | ((value: boolean) => boolean)) => void
  onSetMemorySearchQuery: (value: string) => void
  onSetSelectMode: (value: boolean) => void
  onUpdateQuery: (updates: Record<string, string | null | undefined>) => void
  outputFilter: OutputFilter
  outputFilterOpen: boolean
  outputFilterRef: React.RefObject<HTMLDivElement | null>
  rootItemCount: number
  selectedFile: FileNode | null
  selectedFileCount: number
  selectedMemoryCount: number
  selectedOutputCount: number
  selectMode: boolean
  setCreateMenuOpen: (value: boolean | ((value: boolean) => boolean)) => void
  setDialog: (value: { type: 'file' | 'folder'; parentId: string | null } | null) => void
  setDialogName: (value: string) => void
  setOutputFilterOpen: (value: boolean | ((value: boolean) => boolean)) => void
  setUploadMenuOpen: (value: boolean | ((value: boolean) => boolean)) => void
  uploadMenuOpen: boolean
  uploadMenuRef: React.RefObject<HTMLDivElement | null>
  onCommitOutputFilter: (filter: OutputFilter) => void
}) {
  return (
    <AppScreenHeader>
      <div className="flex min-w-0 flex-wrap items-center gap-2 sm:gap-3">
      {selectedFile ? (
        <SelectedFileHeader
          fileTitle={fileTitle}
          isSavingFile={isSavingFile}
          onClose={onCloseFile}
          onTitleChange={onFileTitleChange}
        />
      ) : (
        <>
          {activeTab === 'files' && activeFolder ? (
            <FolderHeader
              activeFolder={activeFolder}
              folderBreadcrumb={folderBreadcrumb}
              itemCount={rootItemCount}
              memorySearchOpen={memorySearchOpen}
              moveFileToParent={moveFileToParent}
              navigateToFolder={navigateToFolder}
            />
          ) : (
            <HeaderTitle
              activeTab={activeTab}
              fileCount={fileCount}
              filesCategory={filesCategory}
              memoryCount={memoryCount}
              memorySearchOpen={memorySearchOpen}
              mode={mode}
            />
          )}
          <HeaderSearchForTab
            activeTab={activeTab}
            fileSearchOpen={fileSearchOpen}
            fileSearchQuery={fileSearchQuery}
            memorySearchOpen={memorySearchOpen}
            memorySearchQuery={memorySearchQuery}
            onSetFileSearchOpen={onSetFileSearchOpen}
            onSetFileSearchQuery={onSetFileSearchQuery}
            onSetMemorySearchOpen={onSetMemorySearchOpen}
            onSetMemorySearchQuery={onSetMemorySearchQuery}
          />
          <TabToolbar
            activeFolder={activeFolder}
            activeTab={activeTab}
            bulkDeleting={bulkDeleting}
            createMenuOpen={createMenuOpen}
            createMenuRef={createMenuRef}
            fileUploadRef={fileUploadRef}
            folderUploadRef={folderUploadRef}
            layout={layout}
            mode={mode}
            onBulkDeleteFiles={onBulkDeleteFiles}
            onBulkDeleteMemories={onBulkDeleteMemories}
            onBulkDeleteOutputs={onBulkDeleteOutputs}
            onCommitOutputFilter={onCommitOutputFilter}
            onCreateNoteFile={onCreateNoteFile}
            onExitSelectMode={onExitSelectMode}
            onImportMemory={onImportMemory}
            onNewMemory={onNewMemory}
            onPickFile={onPickFile}
            onPickFolder={onPickFolder}
            onRefreshOutputs={onRefreshOutputs}
            onSetSelectMode={onSetSelectMode}
            onUpdateQuery={onUpdateQuery}
            outputFilter={outputFilter}
            outputFilterOpen={outputFilterOpen}
            outputFilterRef={outputFilterRef}
            selectMode={selectMode}
            selectedFileCount={selectedFileCount}
            selectedMemoryCount={selectedMemoryCount}
            selectedOutputCount={selectedOutputCount}
            setCreateMenuOpen={setCreateMenuOpen}
            setDialog={setDialog}
            setDialogName={setDialogName}
            setOutputFilterOpen={setOutputFilterOpen}
            setUploadMenuOpen={setUploadMenuOpen}
            uploadMenuOpen={uploadMenuOpen}
            uploadMenuRef={uploadMenuRef}
          />
        </>
      )}
      </div>
    </AppScreenHeader>
  )
}
