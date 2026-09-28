'use client'

import type { ReactNode } from 'react'
import { useState, useEffect } from 'react'
import {
  IMPORT_MEMORY_PROMPT,
  type KnowledgeFileNode as FileNode,
  type KnowledgeLayout,
  type KnowledgeSurfaceAdapters,
  type KnowledgeTab as Tab,
  type MemoryRow as MemoryListItem,
} from '@overlay/app-core'
import {
  AddMemoryDialog,
  CreateKnowledgeItemDialog,
  ImportMemoryDialog,
  KnowledgePendingNotice,
  MemoryDetailDialog,
} from './dialogs'
import { KnowledgeFileDetailPanel } from './file-detail-panel'
import { HiddenKnowledgeFileInputs, KnowledgeFilesPanel, KnowledgeMemoriesPanel } from './panels'
import { KnowledgeViewHeader } from './view-header'
import { AppScreenBody, AppScreenShell } from '../shell'
import {
  useFileMutations,
  useFileUploads,
  useFolderBrowser,
  useFolderUpload,
  useOpenedFile,
  useOutputFilterMenu,
  useSelectMode,
  useSurfaceFileList,
  useSurfaceMemories,
  useSurfaceMenus,
  useSurfaceRouting,
} from './surface-state'

// ─── Main KnowledgeView ───────────────────────────────────────────────────────

export interface SharedKnowledgeRouteState {
  file: string | null
  memory: string | null
  folder: string | null
  view: string | null
  layout: string | null
  outputFilter: string | null
}

export interface SharedKnowledgeMemoryPort {
  list(): Promise<MemoryListItem[]>
  create(content: string): Promise<{ ok: boolean; error?: string }>
  delete(memoryId: string): Promise<boolean>
}

export interface SharedKnowledgeFilePort {
  saveContent(fileId: string, content: string): Promise<boolean>
  upload(file: File, parentId: string | null): Promise<{ ok: boolean; error?: string; file?: FileNode }>
  isEditable(name: string): boolean
  contentUrl(file: FileNode): string | undefined
  entityChanged(entity: 'file' | 'note', id: string, operation: 'created' | 'updated' | 'moved' | 'deleted'): void
}

export interface SharedKnowledgeSurfaceProps {
  mode?: 'knowledge' | 'files'
  initialFiles?: FileNode[]
  initialMemories?: MemoryListItem[]
  route: SharedKnowledgeRouteState
  queryPending?: boolean
  onUpdateQuery(updates: Record<string, string | null | undefined>): void
  adapters: KnowledgeSurfaceAdapters
  memories: SharedKnowledgeMemoryPort
  files: SharedKnowledgeFilePort
  renderFileViewer(props: { file: FileNode; name: string; content: string; url?: string }): ReactNode
  openFilesInHost?: boolean
  selectedFileId?: string | null
  enableExternalDrop?: boolean
}

function KnowledgeSurfaceDialogs({
  memories,
  mutations,
  uploads,
  folderUpload,
}: {
  memories: ReturnType<typeof useSurfaceMemories>
  mutations: ReturnType<typeof useFileMutations>
  uploads: ReturnType<typeof useFileUploads>
  folderUpload: ReturnType<typeof useFolderUpload>
}) {
  return (
    <>
      {memories.showAddMemory && (
        <AddMemoryDialog
          value={memories.addText}
          saving={memories.isSavingMemory}
          error={memories.memorySaveError}
          onChange={memories.setAddText}
          onSave={memories.handleAddMemory}
          onClose={() => {
            memories.setShowAddMemory(false)
            memories.setAddText('')
            memories.setMemorySaveError(null)
          }}
        />
      )}

      {memories.showImportMemory && (
        <ImportMemoryDialog
          value={memories.importText}
          saving={memories.isImporting}
          error={memories.importMemoryError}
          promptCopied={memories.importPromptCopied}
          onChange={memories.setImportText}
          onSave={memories.handleImportMemory}
          onCopyPrompt={async () => {
            await navigator.clipboard.writeText(IMPORT_MEMORY_PROMPT)
            memories.setImportPromptCopied(true)
            setTimeout(() => memories.setImportPromptCopied(false), 2000)
          }}
          onClose={() => {
            memories.setShowImportMemory(false)
            memories.setImportText('')
            memories.setImportMemoryError(null)
          }}
        />
      )}

      {mutations.dialog && (
        <CreateKnowledgeItemDialog
          type={mutations.dialog.type}
          value={mutations.dialogName}
          creating={mutations.isCreating}
          onChange={mutations.setDialogName}
          onCreate={mutations.handleCreateFile}
          onClose={() => {
            mutations.setDialog(null)
            mutations.setDialogName('')
          }}
        />
      )}

      <HiddenKnowledgeFileInputs
        fileUploadRef={uploads.fileUploadRef}
        folderUploadRef={folderUpload.folderUploadRef}
        onFileChange={uploads.handleUploadFile}
        onFolderChange={folderUpload.handleUploadFolder}
      />

      {memories.selectedMemory && (
        <MemoryDetailDialog
          memory={memories.selectedMemory}
          onClose={memories.closeMemoryDialog}
          onDelete={memories.handleDeleteMemory}
        />
      )}
    </>
  )
}

function KnowledgeMemoriesTab({
  memories,
  select,
  layout,
}: {
  memories: ReturnType<typeof useSurfaceMemories>
  select: ReturnType<typeof useSelectMode>
  layout: KnowledgeLayout
}) {
  const hasPending = Boolean(memories.memorySavePendingPreview || memories.importPendingPreview)
  return (
    <>
      {hasPending && (
        <KnowledgePendingNotice
          title={memories.memorySavePendingPreview ? 'Saving memory…' : 'Importing memory…'}
          preview={memories.memorySavePendingPreview ?? memories.importPendingPreview}
        />
      )}
      <KnowledgeMemoriesPanel
        loading={memories.memoriesLoading}
        memoriesCount={memories.memories.length}
        memories={memories.memoriesFiltered}
        layout={layout}
        selectedIds={select.selectedMemoryIds}
        selectMode={select.selectMode}
        hasPending={hasPending}
        onOpen={memories.openMemory}
        onToggleSelect={select.toggleMemorySelect}
        onAddFirst={() => { memories.setShowAddMemory(true); memories.setMemorySaveError(null) }}
        onDelete={(memoryId, event) => {
          event.stopPropagation()
          void memories.handleDeleteMemory(memoryId)
        }}
      />
    </>
  )
}

function KnowledgeFilesTabNotices({
  fileUploadPending,
  fileUploadError,
  fileList,
}: {
  fileUploadPending: { label: string } | null
  fileUploadError: string | null
  fileList: ReturnType<typeof useSurfaceFileList>
}) {
  return (
    <>
      {fileUploadPending && (
        <KnowledgePendingNotice title="Uploading…" preview={fileUploadPending.label} />
      )}
      {fileUploadError && (
        <p className="mx-auto mb-3 max-w-3xl text-xs text-red-400" role="alert">
          {fileUploadError}
        </p>
      )}
      {fileList.filesLoadError && (
        <p className="mx-auto mb-3 max-w-3xl text-xs text-red-400" role="alert">
          {fileList.filesLoadError}
        </p>
      )}
    </>
  )
}

function KnowledgeSurfaceBody({
  activeTab,
  layout,
  visibleFilesLayout,
  pendingFilesLayout,
  hostSelectedFileId,
  filePort,
  renderFileViewer,
  fileUploadPending,
  fileUploadError,
  memories,
  fileList,
  opened,
  folderBrowser,
  mutations,
  select,
}: {
  activeTab: Tab
  layout: KnowledgeLayout
  visibleFilesLayout: KnowledgeLayout
  pendingFilesLayout: KnowledgeLayout | null
  hostSelectedFileId: string | null
  filePort: SharedKnowledgeFilePort
  renderFileViewer: (props: { file: FileNode; name: string; content: string; url?: string }) => ReactNode
  fileUploadPending: { label: string } | null
  fileUploadError: string | null
  memories: ReturnType<typeof useSurfaceMemories>
  fileList: ReturnType<typeof useSurfaceFileList>
  opened: ReturnType<typeof useOpenedFile>
  folderBrowser: ReturnType<typeof useFolderBrowser>
  mutations: ReturnType<typeof useFileMutations>
  select: ReturnType<typeof useSelectMode>
}) {
  return (
    <AppScreenBody
      padding="none"
      maxWidth="none"
      scroll={activeTab === 'outputs' ? 'hidden' : 'auto'}
      className={`px-6 py-4 ${activeTab === 'outputs' ? 'flex flex-col' : ''}`}
      aria-busy={fileList.filesLoading || fileList.filesRefreshing || undefined}
    >
      {activeTab === 'files' && opened.selectedFile && (
        <KnowledgeFileDetailPanel
          fileName={opened.selectedFile.name}
          isEditable={filePort.isEditable(opened.selectedFile.name)}
          fileContent={opened.fileContent}
          onContentChange={opened.handleFileContentChange}
          renderViewer={() =>
            renderFileViewer({
              name: opened.selectedFile!.name,
              file: opened.selectedFile!,
              content: opened.fileContent,
              url: filePort.contentUrl(opened.selectedFile!),
            })
          }
        />
      )}

      {activeTab === 'memories' && (
        <KnowledgeMemoriesTab memories={memories} select={select} layout={layout} />
      )}

      {activeTab === 'files' && !opened.selectedFile && (
        <KnowledgeFilesTabNotices
          fileUploadPending={fileUploadPending}
          fileUploadError={fileUploadError}
          fileList={fileList}
        />
      )}
      {activeTab === 'files' && fileList.filesRefreshing && (
        <span className="sr-only" role="status">Refreshing files</span>
      )}

      {activeTab === 'files' && !opened.selectedFile && (
        <KnowledgeFilesPanel
          loading={fileList.filesLoading || Boolean(pendingFilesLayout)}
          filesCount={folderBrowser.filesFiltered.length}
          nodes={folderBrowser.rootNodes}
          folders={folderBrowser.folderCardsSorted}
          flatFiles={folderBrowser.flatFilesSorted}
          allFiles={folderBrowser.filesFiltered}
          layout={visibleFilesLayout}
          selectedFileId={hostSelectedFileId}
          selectedIds={select.selectedFileIds}
          selectMode={select.selectMode}
          onSelect={opened.handleSelectFile}
          onFolderOpen={folderBrowser.navigateToFolder}
          onDelete={mutations.handleDeleteNode}
          onToggleBulk={select.toggleFileBulkSelect}
          onMove={folderBrowser.moveFileToParent}
        />
      )}
    </AppScreenBody>
  )
}

export function SharedKnowledgeSurface({
  mode = 'knowledge',
  initialFiles,
  initialMemories,
  route,
  queryPending = false,
  onUpdateQuery,
  adapters,
  memories: memoryPort,
  files: filePort,
  renderFileViewer,
  openFilesInHost = false,
  selectedFileId: hostSelectedFileId = null,
  enableExternalDrop = false,
}: SharedKnowledgeSurfaceProps) {
  const {
    fileOpenParam,
    memoryOpenParam,
    folderParam,
    activeTab,
    filesCategory,
    layout,
    pendingFilesLayout,
    setPendingFilesLayout,
    visibleFilesLayout,
    updateQuery,
  } = useSurfaceRouting({ mode, route, onUpdateQuery })

  if (pendingFilesLayout && !queryPending && layout === pendingFilesLayout) {
    setPendingFilesLayout(null)
  }

  const {
    outputFilter,
    outputFilterOpen,
    setOutputFilterOpen,
    outputFilterRef,
    commitOutputFilter,
  } = useOutputFilterMenu({ route, updateQuery })

  const {
    createMenuRef,
    uploadMenuRef,
    createMenuOpen,
    setCreateMenuOpen,
    uploadMenuOpen,
    setUploadMenuOpen,
  } = useSurfaceMenus()

  const memories = useSurfaceMemories({
    initialMemories,
    memoryPort,
    memoryOpenParam,
    activeTab,
    updateQuery,
  })

  const fileList = useSurfaceFileList({ initialFiles, adapters, activeTab })
  const { files, setFiles, filesLoading } = fileList

  const [fileUploadPending, setFileUploadPending] = useState<{ label: string } | null>(null)
  const [fileUploadError, setFileUploadError] = useState<string | null>(null)

  const opened = useOpenedFile({
    adapters,
    filePort,
    setFiles,
    openFilesInHost,
    updateQuery,
  })
  const { loadFile } = opened

  const folderBrowser = useFolderBrowser({
    files,
    filesCategory,
    folderParam,
    adapters,
    updateQuery,
  })
  const { activeFolder, navigateToFolder } = folderBrowser

  const mutations = useFileMutations({
    adapters,
    activeFolder,
    files,
    setFiles,
    selectedFile: opened.selectedFile,
    setSelectedFile: opened.setSelectedFile,
    setFileContent: opened.setFileContent,
    setFileTitle: opened.setFileTitle,
    updateQuery,
    navigateToFolder,
  })

  const select = useSelectMode({
    activeTab,
    adapters,
    memoryPort,
    loadMemories: memories.loadMemories,
    selectedMemory: memories.selectedMemory,
    setSelectedMemory: memories.setSelectedMemory,
    selectedFile: opened.selectedFile,
    setSelectedFile: opened.setSelectedFile,
    setFileContent: opened.setFileContent,
    setFileTitle: opened.setFileTitle,
    files,
    setFiles,
    activeFolder,
    navigateToFolder,
    updateQuery,
  })

  const uploads = useFileUploads({
    adapters,
    filePort,
    activeFolder,
    setFiles,
    setFileUploadPending,
    setFileUploadError,
  })

  const folderUpload = useFolderUpload({
    adapters,
    filePort,
    setFiles,
    setFileUploadPending,
    setFileUploadError,
  })

  useEffect(() => {
    if (!fileOpenParam || filesLoading || files.length === 0) return
    const node = files.find((f) => f._id === fileOpenParam && f.type === 'file')
    if (!node) return
    // Deep-link file open — intentional state write from the param effect.
    // react-doctor-disable-next-line react-doctor/no-pass-live-state-to-parent
    void loadFile(node._id)
  }, [fileOpenParam, files, filesLoading, loadFile])

  return (
    <>
      <KnowledgeSurfaceDialogs
        memories={memories}
        mutations={mutations}
        uploads={uploads}
        folderUpload={folderUpload}
      />

      <AppScreenShell
        className="overlay-knowledge-surface"
        onDragOver={enableExternalDrop ? (event) => {
          if (event.dataTransfer.types.includes('Files')) event.preventDefault()
        } : undefined}
        onDrop={enableExternalDrop ? (event) => {
          if (event.dataTransfer.files.length === 0) return
          event.preventDefault()
          void uploads.uploadFiles(Array.from(event.dataTransfer.files), false)
        } : undefined}
        header={
          <KnowledgeViewHeader
            activeFolder={activeFolder}
            activeTab={activeTab}
            bulkDeleting={select.bulkDeleting}
            createMenuOpen={createMenuOpen}
            createMenuRef={createMenuRef}
            fileCount={folderBrowser.filesFiltered.length}
            fileSearchOpen={folderBrowser.fileSearchOpen}
            fileSearchQuery={folderBrowser.fileSearchQuery}
            filesCategory={filesCategory}
            fileTitle={opened.fileTitle}
            fileUploadRef={uploads.fileUploadRef}
            folderBreadcrumb={folderBrowser.folderBreadcrumb}
            folderUploadRef={folderUpload.folderUploadRef}
            isSavingFile={opened.isSavingFile}
            layout={activeTab === 'files' ? visibleFilesLayout : layout}
            memoryCount={memories.memoriesFiltered.length}
            memorySearchOpen={memories.memorySearchOpen}
            memorySearchQuery={memories.memorySearchQuery}
            mode={mode}
            moveFileToParent={(fileId, parentId) => void folderBrowser.moveFileToParent(fileId, parentId)}
            navigateToFolder={navigateToFolder}
            onBulkDeleteFiles={() => void select.bulkDeleteFiles()}
            onBulkDeleteMemories={() => void select.bulkDeleteMemories()}
            onBulkDeleteOutputs={() => void select.bulkDeleteOutputs()}
            onCloseFile={opened.closeFileDialog}
            onCommitOutputFilter={commitOutputFilter}
            onCreateNoteFile={() => void mutations.handleCreateNoteFile()}
            onPickFile={() => void uploads.handleNativePick(false)}
            onPickFolder={() => void uploads.handleNativePick(true)}
            onExitSelectMode={select.exitSelectMode}
            onFileTitleChange={opened.handleFileTitleChange}
            onSetFileSearchOpen={folderBrowser.setFileSearchOpen}
            onSetFileSearchQuery={folderBrowser.setFileSearchQuery}
            onImportMemory={() => { memories.setShowImportMemory(true); memories.setImportMemoryError(null) }}
            onNewMemory={() => { memories.setShowAddMemory(true); memories.setMemorySaveError(null) }}
            onRefreshOutputs={() => select.setOutputsRefreshKey((k) => k + 1)}
            onSetMemorySearchOpen={memories.setMemorySearchOpen}
            onSetMemorySearchQuery={memories.setMemorySearchQuery}
            onSetSelectMode={select.setSelectMode}
            onUpdateQuery={updateQuery}
            outputFilter={outputFilter}
            outputFilterOpen={outputFilterOpen}
            outputFilterRef={outputFilterRef}
            rootItemCount={folderBrowser.rootNodes.length}
            selectedFile={opened.selectedFile}
            selectedFileCount={select.selectedFileIds.size}
            selectedMemoryCount={select.selectedMemoryIds.size}
            selectedOutputCount={select.selectedOutputIds.size}
            selectMode={select.selectMode}
            setCreateMenuOpen={setCreateMenuOpen}
            setDialog={mutations.setDialog}
            setDialogName={mutations.setDialogName}
            setOutputFilterOpen={setOutputFilterOpen}
            setUploadMenuOpen={setUploadMenuOpen}
            uploadMenuOpen={uploadMenuOpen}
            uploadMenuRef={uploadMenuRef}
          />
        }
      >
        {/* ── Main content ── */}
        <KnowledgeSurfaceBody
          activeTab={activeTab}
          layout={layout}
          visibleFilesLayout={visibleFilesLayout}
          pendingFilesLayout={pendingFilesLayout}
          hostSelectedFileId={hostSelectedFileId}
          filePort={filePort}
          renderFileViewer={renderFileViewer}
          fileUploadPending={fileUploadPending}
          fileUploadError={fileUploadError}
          memories={memories}
          fileList={fileList}
          opened={opened}
          folderBrowser={folderBrowser}
          mutations={mutations}
          select={select}
        />
      </AppScreenShell>
    </>
  )
}
