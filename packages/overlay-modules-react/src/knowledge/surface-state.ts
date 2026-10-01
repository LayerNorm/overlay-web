'use client'

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import {
  canMoveKnowledgeFile,
  collectKnowledgeFileSubtreeIds,
  filterKnowledgeFileNodes,
  filterMemoryRows,
  folderBreadcrumb as buildFolderBreadcrumb,
  knowledgePendingPreview,
  opensInDocumentEditor,
  removeKnowledgeFileSubtrees,
  resolveKnowledgeLayout,
  resolveKnowledgeOutputFilter,
  resolveKnowledgeTab,
  sortedCurrentFolderFiles,
  sortedCurrentFolderFolders,
  sortedCurrentFolderNodes,
  type KnowledgeFileNode as FileNode,
  type KnowledgeLayout,
  type KnowledgeOutputFilter as OutputFilter,
  type KnowledgePickedFile,
  type KnowledgeSurfaceAdapters,
  type KnowledgeTab as Tab,
  type MemoryRow as MemoryListItem,
} from '@overlay/app-core'
import type {
  SharedKnowledgeFilePort,
  SharedKnowledgeMemoryPort,
  SharedKnowledgeRouteState,
} from './surface'

type FilesCategory = 'all' | 'notes' | 'files' | 'outputs'

function resolveFilesCategory(view: string | null | undefined): FilesCategory {
  if (view === 'notes' || view === 'files' || view === 'outputs') return view
  return 'all'
}

function filterFilesByCategory(files: readonly FileNode[], category: FilesCategory): FileNode[] {
  const keep = new Set<string>()
  const fileById = new Map(files.map((file) => [file._id, file]))

  for (const file of files) {
    const matches =
      category === 'all'
        ? true
        : category === 'notes'
        ? file.kind === 'note'
        : category === 'outputs'
          ? file.kind === 'output'
          : file.type === 'folder' || (file.kind !== 'note' && file.kind !== 'output')

    if (!matches) continue
    keep.add(file._id)
    let parentId = file.parentId
    while (parentId) {
      keep.add(parentId)
      parentId = fileById.get(parentId)?.parentId ?? null
    }
  }

  return files.filter((file) => keep.has(file._id))
}

export function useSurfaceRouting({
  mode,
  route,
  onUpdateQuery,
}: {
  mode: 'knowledge' | 'files'
  route: SharedKnowledgeRouteState
  onUpdateQuery: (updates: Record<string, string | null | undefined>) => void
}) {
  const fileOpenParam = route.file
  const memoryOpenParam = route.memory
  const folderParam = route.folder
  const viewParam = route.view ?? (mode === 'files' ? 'files' : 'memories')
  const activeTab: Tab = resolveKnowledgeTab({ mode, view: viewParam })
  const filesCategory = mode === 'files' ? resolveFilesCategory(route.view) : 'files'

  const layout = resolveKnowledgeLayout({ layout: route.layout, activeTab })
  const [pendingFilesLayout, setPendingFilesLayout] = useState<KnowledgeLayout | null>(null)
  const visibleFilesLayout = pendingFilesLayout ?? layout

  function updateQuery(updates: Record<string, string | null | undefined>) {
    const nextLayout = updates.layout === 'list' || updates.layout === 'cards' ? updates.layout : null
    if (activeTab === 'files' && nextLayout && nextLayout !== layout) {
      setPendingFilesLayout(nextLayout)
    }
    onUpdateQuery(updates)
  }

  return {
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
  }
}

export function useOutputFilterMenu({
  route,
  updateQuery,
}: {
  route: SharedKnowledgeRouteState
  updateQuery: (updates: Record<string, string | null | undefined>) => void
}) {
  const [outputFilterOpen, setOutputFilterOpen] = useState(false)
  const outputFilterRef = useRef<HTMLDivElement>(null)

  const outputFilter = resolveKnowledgeOutputFilter(route.outputFilter)

  function commitOutputFilter(next: OutputFilter) {
    if (next === 'all') updateQuery({ out: null })
    else updateQuery({ out: next })
    setOutputFilterOpen(false)
  }

  useEffect(() => {
    if (!outputFilterOpen) return
    function handleMouseDown(e: MouseEvent) {
      if (outputFilterRef.current && !outputFilterRef.current.contains(e.target as Node)) {
        setOutputFilterOpen(false)
      }
    }
    document.addEventListener('mousedown', handleMouseDown)
    return () => document.removeEventListener('mousedown', handleMouseDown)
  }, [outputFilterOpen])

  return { outputFilter, outputFilterOpen, setOutputFilterOpen, outputFilterRef, commitOutputFilter }
}

export function useSurfaceMenus() {
  const createMenuRef = useRef<HTMLDivElement>(null)
  const uploadMenuRef = useRef<HTMLDivElement>(null)
  const [createMenuOpen, setCreateMenuOpen] = useState(false)
  const [uploadMenuOpen, setUploadMenuOpen] = useState(false)

  useEffect(() => {
    if (!createMenuOpen && !uploadMenuOpen) return
    function handleMouseDown(e: MouseEvent) {
      const target = e.target as Node
      if (createMenuOpen && createMenuRef.current && !createMenuRef.current.contains(target)) {
        setCreateMenuOpen(false)
      }
      if (uploadMenuOpen && uploadMenuRef.current && !uploadMenuRef.current.contains(target)) {
        setUploadMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handleMouseDown)
    return () => document.removeEventListener('mousedown', handleMouseDown)
  }, [createMenuOpen, uploadMenuOpen])

  return {
    createMenuRef,
    uploadMenuRef,
    createMenuOpen,
    setCreateMenuOpen,
    uploadMenuOpen,
    setUploadMenuOpen,
  }
}

export function useSurfaceMemories({
  initialMemories,
  memoryPort,
  memoryOpenParam,
  activeTab,
  updateQuery,
}: {
  initialMemories: MemoryListItem[] | undefined
  memoryPort: SharedKnowledgeMemoryPort
  memoryOpenParam: string | null
  activeTab: Tab
  updateQuery: (updates: Record<string, string | null | undefined>) => void
}) {
  const [memories, setMemories] = useState<MemoryListItem[]>(() => initialMemories ?? [])
  const [memoriesLoading, setMemoriesLoading] = useState(initialMemories === undefined)
  const [selectedMemory, setSelectedMemory] = useState<MemoryListItem | null>(null)
  const [showAddMemory, setShowAddMemory] = useState(false)
  const [addText, setAddText] = useState('')
  const [isSavingMemory, setIsSavingMemory] = useState(false)
  const [memorySaveError, setMemorySaveError] = useState<string | null>(null)
  const [memorySavePendingPreview, setMemorySavePendingPreview] = useState<string | null>(null)
  const [showImportMemory, setShowImportMemory] = useState(false)
  const [importText, setImportText] = useState('')
  const [isImporting, setIsImporting] = useState(false)
  const [importMemoryError, setImportMemoryError] = useState<string | null>(null)
  const [importPendingPreview, setImportPendingPreview] = useState<string | null>(null)
  const [importPromptCopied, setImportPromptCopied] = useState(false)
  const [memorySearchOpen, setMemorySearchOpen] = useState(false)
  const [memorySearchQuery, setMemorySearchQuery] = useState('')

  const loadMemories = useCallback(async () => {
    try {
      setMemories(await memoryPort.list())
    } catch { /* ignore */ } finally { setMemoriesLoading(false) }
  }, [memoryPort])

  useEffect(() => {
    if (initialMemories !== undefined || activeTab !== 'memories') return
    void loadMemories()
  }, [activeTab, initialMemories, loadMemories])

  useEffect(() => {
    if (activeTab !== 'memories') return
    const onVis = () => {
      if (document.visibilityState === 'visible') void loadMemories()
    }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [activeTab, loadMemories])

  useEffect(() => {
    if (!memoryOpenParam || memoriesLoading || memories.length === 0) return
    const mem = memories.find((m) => m.memoryId === memoryOpenParam)
    if (!mem) return
    setSelectedMemory(mem)
  }, [memoryOpenParam, memories, memoriesLoading])

  async function handleAddMemory() {
    const text = addText.trim()
    if (!text || isSavingMemory) return
    setIsSavingMemory(true)
    setMemorySaveError(null)
    const preview = knowledgePendingPreview(text)
    setMemorySavePendingPreview(preview)
    try {
      const result = await memoryPort.create(text)
      if (!result.ok) {
        setMemorySaveError(result.error ?? 'Could not save memory')
        return
      }
      setAddText('')
      setShowAddMemory(false)
      await loadMemories()
    } finally {
      setMemorySavePendingPreview(null)
      setIsSavingMemory(false)
    }
  }

  async function handleImportMemory() {
    const text = importText.trim()
    if (!text || isImporting) return
    setIsImporting(true)
    setImportMemoryError(null)
    const preview = knowledgePendingPreview(text)
    setImportPendingPreview(preview)
    try {
      const result = await memoryPort.create(text)
      if (!result.ok) {
        setImportMemoryError(result.error ?? 'Could not import memory')
        return
      }
      setImportText('')
      setShowImportMemory(false)
      await loadMemories()
    } finally {
      setImportPendingPreview(null)
      setIsImporting(false)
    }
  }

  async function handleDeleteMemory(memoryId: string) {
    if (!(await memoryPort.delete(memoryId))) return
    if (selectedMemory?.memoryId === memoryId) {
      setSelectedMemory(null)
      updateQuery({ memory: null })
    }
    setMemories((prev) => prev.filter((m) => m.memoryId !== memoryId))
  }

  function openMemory(memory: MemoryListItem) {
    setSelectedMemory(memory)
    updateQuery({ view: 'memories', memory: memory.memoryId })
  }

  function closeMemoryDialog() {
    setSelectedMemory(null)
    updateQuery({ memory: null })
  }

  const memoriesFiltered = useMemo(() => {
    return filterMemoryRows(memories, memorySearchQuery)
  }, [memories, memorySearchQuery])

  return {
    memories,
    setMemories,
    memoriesLoading,
    memoriesFiltered,
    selectedMemory,
    setSelectedMemory,
    showAddMemory,
    setShowAddMemory,
    addText,
    setAddText,
    isSavingMemory,
    memorySaveError,
    setMemorySaveError,
    memorySavePendingPreview,
    showImportMemory,
    setShowImportMemory,
    importText,
    setImportText,
    isImporting,
    importMemoryError,
    setImportMemoryError,
    importPendingPreview,
    importPromptCopied,
    setImportPromptCopied,
    memorySearchOpen,
    setMemorySearchOpen,
    memorySearchQuery,
    setMemorySearchQuery,
    loadMemories,
    handleAddMemory,
    handleImportMemory,
    handleDeleteMemory,
    openMemory,
    closeMemoryDialog,
  }
}

export function useSurfaceFileList({
  initialFiles,
  adapters,
  activeTab,
}: {
  initialFiles: FileNode[] | undefined
  adapters: KnowledgeSurfaceAdapters
  activeTab: Tab
}) {
  const [files, setFiles] = useState<FileNode[]>(() => initialFiles ?? [])
  const [filesLoading, setFilesLoading] = useState(initialFiles === undefined)
  const [filesRefreshing, setFilesRefreshing] = useState(false)
  const [filesLoadError, setFilesLoadError] = useState<string | null>(null)
  const hasLoadedFilesRef = useRef(initialFiles !== undefined)

  const loadFiles = useCallback(async () => {
    const initial = !hasLoadedFilesRef.current
    if (initial) setFilesLoading(true)
    else setFilesRefreshing(true)
    try {
      const result = await adapters.repository.list()
      setFiles([...result.nodes])
      setFilesLoadError(null)
      hasLoadedFilesRef.current = true
    } catch (error) {
      setFilesLoadError(error instanceof Error ? error.message : 'Could not load files')
    } finally {
      setFilesLoading(false)
      setFilesRefreshing(false)
    }
  }, [adapters.repository])

  useEffect(() => adapters.repository.subscribe((event) => {
    if (event.type === 'reset') {
      setFiles([...event.nodes])
      return
    }
    if (event.type === 'created' || event.type === 'updated') {
      setFiles((current) => {
        const exists = current.some((node) => node._id === event.node._id)
        return exists
          ? current.map((node) => node._id === event.node._id ? event.node : node)
          : [...current, event.node]
      })
      return
    }
    if (event.type === 'moved') {
      setFiles((current) => current.map((node) => node._id === event.id
        ? { ...node, parentId: event.parentId }
        : node))
      return
    }
    if (event.type === 'deleted') {
      setFiles((current) => removeKnowledgeFileSubtrees(current, event.ids))
      return
    }
    if (event.type === 'upload-progress' || event.type === 'conflict') {
      setFiles((current) => current.map((node) => node._id === event.id
        ? { ...node, ...(event.type === 'conflict' ? { conflict: event.conflict } : { upload: event.upload }) }
        : node))
    }
  }), [adapters.repository])

  useEffect(() => {
    if (activeTab !== 'files' && activeTab !== 'outputs') return
    // `initialFiles` seeds the first paint so there is no spinner, but it must not
    // suppress loading forever. It is a server snapshot taken when the route
    // rendered: anything created afterwards — notably from the sidebar, which
    // publishes its mutation while this surface is unmounted and navigating away —
    // never reached this list, so a new note stayed invisible until a hard reload.
    // Revalidate on mount and let the seeded rows cover the gap.
    void loadFiles()
  }, [activeTab, loadFiles])

  return {
    files,
    setFiles,
    filesLoading,
    filesRefreshing,
    filesLoadError,
    loadFiles,
  }
}

export function useOpenedFile({
  adapters,
  filePort,
  setFiles,
  openFilesInHost,
  updateQuery,
}: {
  adapters: KnowledgeSurfaceAdapters
  filePort: SharedKnowledgeFilePort
  setFiles: React.Dispatch<React.SetStateAction<FileNode[]>>
  openFilesInHost: boolean
  updateQuery: (updates: Record<string, string | null | undefined>) => void
}) {
  const [selectedFile, setSelectedFile] = useState<FileNode | null>(null)
  const [fileContent, setFileContent] = useState('')
  const [fileTitle, setFileTitle] = useState('')
  const [isSavingFile, setIsSavingFile] = useState(false)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const titleSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastFileTriggerRef = useRef<HTMLElement | null>(null)

  const loadFile = useCallback(async (fileId: string) => {
    if (document.activeElement instanceof HTMLElement) {
      lastFileTriggerRef.current = document.activeElement
    }
    const file = await adapters.repository.get(fileId)
    if (!file) return
    if (opensInDocumentEditor(file)) {
      await adapters.navigation.open(file, { replace: true })
      return
    }
    setSelectedFile(file)
    setFileTitle(file.name)
    setFileContent(file.textContent ?? file.content ?? '')
  }, [adapters.navigation, adapters.repository])

  useEffect(() => () => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    if (titleSaveTimerRef.current) clearTimeout(titleSaveTimerRef.current)
  }, [])

  function handleSelectFile(node: FileNode) {
    if (openFilesInHost || opensInDocumentEditor(node)) {
      void adapters.navigation.open(node as Parameters<typeof adapters.navigation.open>[0])
      return
    }
    void loadFile(node._id)
    updateQuery({ view: 'files', file: node._id })
  }

  function closeFileDialog() {
    setSelectedFile(null)
    setFileContent('')
    setFileTitle('')
    updateQuery({ file: null })
    requestAnimationFrame(() => {
      if (lastFileTriggerRef.current?.isConnected) lastFileTriggerRef.current.focus()
    })
  }

  function handleFileContentChange(val: string) {
    setFileContent(val)
    if (!selectedFile) return
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(async () => {
      setIsSavingFile(true)
      const saved = await filePort.saveContent(selectedFile._id, val)
      if (saved) filePort.entityChanged('file', selectedFile._id, 'updated')
      setFiles((prev) => prev.map((f) => f._id === selectedFile._id ? { ...f } : f))
      setIsSavingFile(false)
    }, 800)
  }

  function handleFileTitleChange(val: string) {
    setFileTitle(val)
    if (!selectedFile) return
    const nextName = val.trim() || 'Untitled'
    if (titleSaveTimerRef.current) clearTimeout(titleSaveTimerRef.current)
    titleSaveTimerRef.current = setTimeout(async () => {
      setIsSavingFile(true)
      try {
        await adapters.repository.rename({ id: selectedFile._id, name: nextName })
        setSelectedFile((prev) => prev ? { ...prev, name: nextName } : prev)
        setFiles((prev) => prev.map((f) => f._id === selectedFile._id ? { ...f, name: nextName } : f))
      } catch {
        // Keep the previous persisted title when the host rejects the rename.
      }
      setIsSavingFile(false)
    }, 600)
  }

  return {
    selectedFile,
    setSelectedFile,
    fileContent,
    setFileContent,
    fileTitle,
    setFileTitle,
    isSavingFile,
    loadFile,
    handleSelectFile,
    closeFileDialog,
    handleFileContentChange,
    handleFileTitleChange,
  }
}

export function useFolderBrowser({
  files,
  filesCategory,
  folderParam,
  adapters,
  updateQuery,
}: {
  files: FileNode[]
  filesCategory: FilesCategory
  folderParam: string | null
  adapters: KnowledgeSurfaceAdapters
  updateQuery: (updates: Record<string, string | null | undefined>) => void
}) {
  const [fileSearchOpen, setFileSearchOpen] = useState(false)
  const [fileSearchQuery, setFileSearchQuery] = useState('')

  const activeFolder = useMemo(
    () => folderParam ? (files.find((f) => f._id === folderParam && f.type === 'folder') ?? null) : null,
    [files, folderParam],
  )
  const folderBreadcrumb = useMemo(() => buildFolderBreadcrumb(files, activeFolder), [activeFolder, files])

  async function moveFileToParent(fileId: string, parentId: string | null) {
    if (!canMoveKnowledgeFile(files, fileId, parentId)) return
    try {
      await adapters.repository.move({ id: fileId, parentId })
    } catch {
      // Keep the previous hierarchy when the host rejects the move.
    }
  }

  function navigateToFolder(folderId: string | null) {
    updateQuery({ folder: folderId, file: null })
  }

  const filesFiltered = useMemo(() => {
    return filterKnowledgeFileNodes(filterFilesByCategory(files, filesCategory), fileSearchQuery)
  }, [files, fileSearchQuery, filesCategory])

  const currentParentId = activeFolder?._id ?? null
  const rootNodes = sortedCurrentFolderNodes(filesFiltered, currentParentId)
  const flatFilesSorted = sortedCurrentFolderFiles(filesFiltered, currentParentId)
  const folderCardsSorted = sortedCurrentFolderFolders(filesFiltered, currentParentId)

  return {
    fileSearchOpen,
    setFileSearchOpen,
    fileSearchQuery,
    setFileSearchQuery,
    activeFolder,
    folderBreadcrumb,
    navigateToFolder,
    moveFileToParent,
    filesFiltered,
    rootNodes,
    flatFilesSorted,
    folderCardsSorted,
  }
}

export function useFileMutations({
  adapters,
  activeFolder,
  files,
  setFiles,
  selectedFile,
  setSelectedFile,
  setFileContent,
  setFileTitle,
  updateQuery,
  navigateToFolder,
}: {
  adapters: KnowledgeSurfaceAdapters
  activeFolder: FileNode | null
  files: FileNode[]
  setFiles: React.Dispatch<React.SetStateAction<FileNode[]>>
  selectedFile: FileNode | null
  setSelectedFile: React.Dispatch<React.SetStateAction<FileNode | null>>
  setFileContent: React.Dispatch<React.SetStateAction<string>>
  setFileTitle: React.Dispatch<React.SetStateAction<string>>
  updateQuery: (updates: Record<string, string | null | undefined>) => void
  navigateToFolder: (folderId: string | null) => void
}) {
  const [dialog, setDialog] = useState<{ type: 'file' | 'folder'; parentId: string | null } | null>(null)
  const [dialogName, setDialogName] = useState('')
  const [isCreating, setIsCreating] = useState(false)

  async function handleCreateFile() {
    const name = dialogName.trim()
    if (!name || isCreating || !dialog) return
    setIsCreating(true)
    try {
      const created = await adapters.repository.create({
        name,
        kind: dialog.type === 'folder' ? 'folder' : 'file',
        parentId: dialog.parentId,
      })
      if (created) {
        adapters.analytics.track('knowledge_file_created', { file_name: name, type: dialog.type })
        if (dialog.type === 'folder') adapters.analytics.track('knowledge_folder_created', { folder_name: name })
        setDialogName(''); setDialog(null)
      }
    } finally { setIsCreating(false) }
  }

  async function handleCreateNoteFile() {
    const created = await adapters.repository.create({
      kind: 'note',
      name: 'Untitled',
      content: '',
      parentId: activeFolder?._id ?? null,
    })
    await adapters.navigation.open(created)
  }

  async function handleDeleteNode(id: string, e: React.MouseEvent) {
    e.stopPropagation()
    const node = files.find((f) => f._id === id)
    await adapters.repository.delete({ ids: [id] })
    const deletedIds = collectKnowledgeFileSubtreeIds(files, [id])
    setFiles((prev) => removeKnowledgeFileSubtrees(prev, [id]))
    if (node) {
      adapters.analytics.track('knowledge_file_deleted', { file_name: node.name, type: node.type })
    }
    if (selectedFile && deletedIds.has(selectedFile._id)) {
      setSelectedFile(null)
      setFileContent('')
      setFileTitle('')
      updateQuery({ file: null })
    }
    if (activeFolder && deletedIds.has(activeFolder._id)) {
      navigateToFolder(null)
    }
  }

  return {
    dialog,
    setDialog,
    dialogName,
    setDialogName,
    isCreating,
    handleCreateFile,
    handleCreateNoteFile,
    handleDeleteNode,
  }
}

export function useSelectMode({
  activeTab,
  adapters,
  memoryPort,
  loadMemories,
  selectedMemory,
  setSelectedMemory,
  selectedFile,
  setSelectedFile,
  setFileContent,
  setFileTitle,
  files,
  setFiles,
  activeFolder,
  navigateToFolder,
  updateQuery,
}: {
  activeTab: Tab
  adapters: KnowledgeSurfaceAdapters
  memoryPort: SharedKnowledgeMemoryPort
  loadMemories: () => Promise<void>
  selectedMemory: MemoryListItem | null
  setSelectedMemory: React.Dispatch<React.SetStateAction<MemoryListItem | null>>
  selectedFile: FileNode | null
  setSelectedFile: React.Dispatch<React.SetStateAction<FileNode | null>>
  setFileContent: React.Dispatch<React.SetStateAction<string>>
  setFileTitle: React.Dispatch<React.SetStateAction<string>>
  files: FileNode[]
  setFiles: React.Dispatch<React.SetStateAction<FileNode[]>>
  activeFolder: FileNode | null
  navigateToFolder: (folderId: string | null) => void
  updateQuery: (updates: Record<string, string | null | undefined>) => void
}) {
  const [selectMode, setSelectMode] = useState(false)
  const [selectedMemoryIds, setSelectedMemoryIds] = useState<Set<string>>(() => new Set())
  const [selectedFileIds, setSelectedFileIds] = useState<Set<string>>(() => new Set())
  const [selectedOutputIds, setSelectedOutputIds] = useState<Set<string>>(() => new Set())
  const [bulkDeleting, setBulkDeleting] = useState(false)
  const [, setOutputsRefreshKey] = useState(0)

  const [prevActiveTab, setPrevActiveTab] = useState(activeTab)
  if (prevActiveTab !== activeTab) {
    setPrevActiveTab(activeTab)
    setSelectMode(false)
    setSelectedMemoryIds(new Set())
    setSelectedFileIds(new Set())
    setSelectedOutputIds(new Set())
  }

  function exitSelectMode() {
    setSelectMode(false)
    setSelectedMemoryIds(new Set())
    setSelectedFileIds(new Set())
    setSelectedOutputIds(new Set())
  }

  function toggleMemorySelect(memoryId: string) {
    setSelectedMemoryIds((prev) => {
      const n = new Set(prev)
      if (n.has(memoryId)) n.delete(memoryId)
      else n.add(memoryId)
      return n
    })
  }

  function toggleFileBulkSelect(fileId: string) {
    setSelectedFileIds((prev) => {
      const n = new Set(prev)
      if (n.has(fileId)) n.delete(fileId)
      else n.add(fileId)
      return n
    })
  }

  async function bulkDeleteMemories() {
    if (selectedMemoryIds.size === 0 || bulkDeleting) return
    setBulkDeleting(true)
    try {
      await Promise.all(
        [...selectedMemoryIds].map((id) => memoryPort.delete(id)),
      )
      if (selectedMemory && selectedMemoryIds.has(selectedMemory.memoryId)) {
        setSelectedMemory(null)
        updateQuery({ memory: null })
      }
      await loadMemories()
      exitSelectMode()
    } finally {
      setBulkDeleting(false)
    }
  }

  async function bulkDeleteFiles() {
    if (selectedFileIds.size === 0 || bulkDeleting) return
    const ids = Array.from(selectedFileIds)
    setBulkDeleting(true)
    try {
      await adapters.repository.delete({ ids })
      const deletedRootIds = ids

      const deletedIds = collectKnowledgeFileSubtreeIds(files, deletedRootIds)
      setFiles((prev) => removeKnowledgeFileSubtrees(prev, deletedRootIds))

      if (selectedFile && deletedIds.has(selectedFile._id)) {
        setSelectedFile(null)
        setFileContent('')
        setFileTitle('')
        updateQuery({ file: null })
      }
      if (activeFolder && deletedIds.has(activeFolder._id)) {
        navigateToFolder(null)
      }
      exitSelectMode()
    } finally {
      setBulkDeleting(false)
    }
  }

  async function bulkDeleteOutputs() {
    if (selectedOutputIds.size === 0 || bulkDeleting) return
    setBulkDeleting(true)
    try {
      await adapters.repository.delete({ ids: [...selectedOutputIds] })
      setOutputsRefreshKey((k) => k + 1)
      exitSelectMode()
    } finally {
      setBulkDeleting(false)
    }
  }

  return {
    selectMode,
    setSelectMode,
    selectedMemoryIds,
    selectedFileIds,
    selectedOutputIds,
    bulkDeleting,
    setOutputsRefreshKey,
    exitSelectMode,
    toggleMemorySelect,
    toggleFileBulkSelect,
    bulkDeleteMemories,
    bulkDeleteFiles,
    bulkDeleteOutputs,
  }
}

async function uploadSingleFile(filePort: SharedKnowledgeFilePort, file: File, parentId: string | null): Promise<{ ok: boolean; error?: string; file?: FileNode }> {
  try {
    return await filePort.upload(file, parentId)
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Upload failed' }
  }
}

async function pickedFileToBrowserFile(picked: KnowledgePickedFile): Promise<File> {
  const file = new File([Uint8Array.from(await picked.read())], picked.name, {
    type: picked.mimeType ?? 'application/octet-stream',
  })
  if (picked.relativePath) {
    Object.defineProperty(file, 'webkitRelativePath', { value: picked.relativePath })
  }
  return file
}

export function useFileUploads({
  adapters,
  filePort,
  activeFolder,
  setFiles,
  setFileUploadPending,
  setFileUploadError,
}: {
  adapters: KnowledgeSurfaceAdapters
  filePort: SharedKnowledgeFilePort
  activeFolder: FileNode | null
  setFiles: React.Dispatch<React.SetStateAction<FileNode[]>>
  setFileUploadPending: React.Dispatch<React.SetStateAction<{ label: string } | null>>
  setFileUploadError: React.Dispatch<React.SetStateAction<string | null>>
}) {
  const fileUploadRef = useRef<HTMLInputElement>(null)

  async function uploadFiles(list: readonly File[], folderUpload: boolean) {
    if (list.length === 0) return
    setFileUploadError(null)
    setFileUploadPending({ label: list.length === 1 ? list[0]!.name : `${folderUpload ? 'Folder' : 'Files'} · ${list.length} files` })
    try {
      if (!folderUpload) {
        for (const file of list) {
          const result = await uploadSingleFile(filePort, file, activeFolder?._id ?? null)
          if (!result.ok) {
            setFileUploadError(result.error ?? 'One or more files failed to upload.')
            break
          }
          if (result.file) {
            setFiles((current) => [...current.filter((node) => node._id !== result.file!._id), result.file!])
            filePort.entityChanged('file', result.file._id, 'created')
          }
        }
      } else {
        const folders = new Map<string, string>()
        for (const file of list) {
          const parts = file.webkitRelativePath.split('/').filter(Boolean)
          for (let index = 0; index < parts.length - 1; index += 1) {
            const folderPath = parts.slice(0, index + 1).join('/')
            if (folders.has(folderPath)) continue
            const parentPath = index === 0 ? null : parts.slice(0, index).join('/')
            // Sequential on purpose: nested folders need their parent's id,
            // which only exists after the earlier create resolves.
            // react-doctor-disable-next-line react-doctor/async-await-in-loop
            const created = await adapters.repository.create({
              name: parts[index] ?? 'Folder',
              kind: 'folder',
              parentId: parentPath ? (folders.get(parentPath) ?? null) : (activeFolder?._id ?? null),
            })
            folders.set(folderPath, created.id)
          }
          const parentFolderPath = parts.slice(0, -1).join('/')
          const result = await uploadSingleFile(filePort, file, folders.get(parentFolderPath) ?? activeFolder?._id ?? null)
          if (!result.ok) {
            setFileUploadError(result.error ?? 'One or more files failed to upload.')
            break
          }
          if (result.file) setFiles((current) => [...current.filter((node) => node._id !== result.file!._id), result.file!])
        }
      }
    } finally {
      setFileUploadPending(null)
    }
  }

  async function handleNativePick(folder: boolean) {
    const picked = folder
      ? await adapters.filePicker.pickFolder?.() ?? []
      : await adapters.filePicker.pickFiles({ multiple: true })
    const files = await Promise.all(picked.map(pickedFileToBrowserFile))
    await uploadFiles(files, folder)
  }

  async function handleUploadFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setFileUploadError(null)
    setFileUploadPending({ label: file.name })
    try {
      const result = await uploadSingleFile(filePort, file, activeFolder?._id ?? null)
      if (!result.ok) {
        setFileUploadError(result.error ?? 'Upload failed. Check the file and try again.')
        return
      }
      if (result.file) {
        setFiles((current) => [...current.filter((node) => node._id !== result.file!._id), result.file!])
        filePort.entityChanged('file', result.file._id, 'created')
      }
    } finally {
      setFileUploadPending(null)
      e.target.value = ''
    }
  }

  return {
    fileUploadRef,
    uploadFiles,
    handleNativePick,
    handleUploadFile,
  }
}

export function useFolderUpload({
  adapters,
  filePort,
  setFiles,
  setFileUploadPending,
  setFileUploadError,
}: {
  adapters: KnowledgeSurfaceAdapters
  filePort: SharedKnowledgeFilePort
  setFiles: React.Dispatch<React.SetStateAction<FileNode[]>>
  setFileUploadPending: React.Dispatch<React.SetStateAction<{ label: string } | null>>
  setFileUploadError: React.Dispatch<React.SetStateAction<string | null>>
}) {
  const folderUploadRef = useRef<HTMLInputElement>(null)

  async function handleUploadFolder(e: React.ChangeEvent<HTMLInputElement>) {
    const uploadedFiles = e.target.files
    if (!uploadedFiles) return
    const list = Array.from(uploadedFiles)
    setFileUploadError(null)
    setFileUploadPending({ label: list.length === 1 ? list[0]!.name : `Folder · ${list.length} files` })
    try {
      const folders = new Map<string, string>()
      for (const file of list) {
        const parts = file.webkitRelativePath.split('/')
        for (let i = 0; i < parts.length - 1; i++) {
          const folderPath = parts.slice(0, i + 1).join('/')
          if (!folders.has(folderPath)) {
            const parentPath = i === 0 ? null : parts.slice(0, i).join('/')
            const parentId = parentPath ? (folders.get(parentPath) ?? null) : null
            // Sequential on purpose: nested folders need their parent's id,
            // which only exists after the earlier create resolves.
            // react-doctor-disable-next-line react-doctor/async-await-in-loop
            const created = await adapters.repository.create({
              name: parts[i] ?? 'Folder',
              kind: 'folder',
              parentId,
            })
            folders.set(folderPath, created.id)
          }
        }
        const parentFolderPath = parts.slice(0, -1).join('/')
        const parentId = folders.get(parentFolderPath) ?? null
        const result = await uploadSingleFile(filePort, file, parentId)
        if (!result.ok) {
          setFileUploadError(result.error ?? 'One or more files failed to upload.')
          break
        }
        if (result.file) {
          setFiles((current) => [...current.filter((node) => node._id !== result.file!._id), result.file!])
          filePort.entityChanged('file', result.file._id, 'created')
        }
      }
    } finally {
      setFileUploadPending(null)
      e.target.value = ''
    }
  }

  return {
    folderUploadRef,
    handleUploadFolder,
  }
}
