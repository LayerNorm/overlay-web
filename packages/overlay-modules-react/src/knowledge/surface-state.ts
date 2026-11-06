'use client'

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import { toast } from '@overlay/ui/primitives'
import { beginKnowledgeUploadToast } from './upload-toast'
import {
  canMoveKnowledgeFile,
  collectKnowledgeFileSubtreeIds,
  filterKnowledgeFileNodes,
  filterMemoryRows,
  folderBreadcrumb as buildFolderBreadcrumb,
  knowledgePendingPreview,
  normalizeKnowledgeSurfaceNode,
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
  ControlledKnowledgeFileSnapshot,
  SharedKnowledgeFilePort,
  SharedKnowledgeMemoryPort,
  SharedKnowledgeRouteState,
} from './surface'

type FilesCategory = 'all' | 'notes' | 'files' | 'outputs'
const ignoreControlledFiles: Dispatch<SetStateAction<FileNode[]>> = () => undefined

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
  const [memorySavePendingPreview, setMemorySavePendingPreview] = useState<string | null>(null)
  const [showImportMemory, setShowImportMemory] = useState(false)
  const [importText, setImportText] = useState('')
  const [isImporting, setIsImporting] = useState(false)
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
    const preview = knowledgePendingPreview(text)
    setMemorySavePendingPreview(preview)
    try {
      const result = await memoryPort.create(text)
      if (!result.ok) {
        toast.error(result.error ?? 'Could not save memory')
        return
      }
      setAddText('')
      setShowAddMemory(false)
      toast.success('Memory saved.')
      await loadMemories()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not save memory')
    } finally {
      setMemorySavePendingPreview(null)
      setIsSavingMemory(false)
    }
  }

  async function handleImportMemory() {
    const text = importText.trim()
    if (!text || isImporting) return
    setIsImporting(true)
    const preview = knowledgePendingPreview(text)
    setImportPendingPreview(preview)
    try {
      const result = await memoryPort.create(text)
      if (!result.ok) {
        toast.error(result.error ?? 'Could not import memory')
        return
      }
      setImportText('')
      setShowImportMemory(false)
      toast.success('Memory imported.')
      await loadMemories()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not import memory')
    } finally {
      setImportPendingPreview(null)
      setIsImporting(false)
    }
  }

  async function handleDeleteMemory(memoryId: string) {
    try {
      if (!(await memoryPort.delete(memoryId))) {
        toast.error('Could not delete memory.')
        return
      }
      if (selectedMemory?.memoryId === memoryId) {
        setSelectedMemory(null)
        updateQuery({ memory: null })
      }
      setMemories((prev) => prev.filter((m) => m.memoryId !== memoryId))
      toast.success('Memory deleted.')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not delete memory.')
    }
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
    memorySavePendingPreview,
    showImportMemory,
    setShowImportMemory,
    importText,
    setImportText,
    isImporting,
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
  controlledSnapshot,
}: {
  initialFiles: FileNode[] | undefined
  adapters: KnowledgeSurfaceAdapters
  activeTab: Tab
  controlledSnapshot?: ControlledKnowledgeFileSnapshot
}) {
  const [files, setFiles] = useState<FileNode[]>(() => initialFiles ?? [])
  const [filesLoading, setFilesLoading] = useState(initialFiles === undefined)
  const [filesRefreshing, setFilesRefreshing] = useState(false)
  const [filesLoadError, setFilesLoadError] = useState<string | null>(null)
  const hasLoadedFilesRef = useRef(initialFiles !== undefined)

  const loadFiles = useCallback(async () => {
    if (controlledSnapshot) return
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
  }, [adapters.repository, controlledSnapshot])

  useEffect(() => {
    if (controlledSnapshot) return
    return adapters.repository.subscribe((event) => {
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
    })
  }, [adapters.repository, controlledSnapshot])

  useEffect(() => {
    if (controlledSnapshot) return
    if (activeTab !== 'files' && activeTab !== 'outputs') return
    // `initialFiles` seeds the first paint so there is no spinner, but it must not
    // suppress loading forever. It is a server snapshot taken when the route
    // rendered: anything created afterwards — notably from the sidebar, which
    // publishes its mutation while this surface is unmounted and navigating away —
    // never reached this list, so a new note stayed invisible until a hard reload.
    // Revalidate on mount and let the seeded rows cover the gap.
    void loadFiles()
  }, [activeTab, controlledSnapshot, loadFiles])

  return {
    files: controlledSnapshot?.nodes ?? files,
    setFiles: controlledSnapshot ? ignoreControlledFiles : setFiles,
    filesLoading: controlledSnapshot?.loading ?? filesLoading,
    filesRefreshing: controlledSnapshot ? false : filesRefreshing,
    filesLoadError: controlledSnapshot?.error ?? filesLoadError,
    filesTruncated: controlledSnapshot?.truncated ?? false,
    loadFiles,
  }
}

type AcknowledgedUpdate = {
  fileId: string
  selectionEpoch: number
  expectedRevision: number
  updatedAt: number
  acceptedRevisions: number[]
  name?: string
  extension?: string
}

function canSaveDraft({ active, draft, fileId, revision, generation, currentGeneration, epoch, currentEpoch }: {
  active: FileNode | null
  draft: { fileId: string; revision: number; generation: number; dirty: boolean } | null
  fileId: string
  revision: number
  generation: number
  currentGeneration: number
  epoch: number
  currentEpoch: number
}) {
  return active?._id === fileId && active.updatedAt === revision && epoch === currentEpoch
    && generation === currentGeneration && draft?.dirty && draft.fileId === fileId
    && draft.revision === revision && draft.generation === generation
}

function createDraftSaveQueue(onSettled: () => void) {
  let timer: ReturnType<typeof setTimeout> | null = null
  let epoch = 0
  let inFlight = false
  let pending: { revision: number; save(revision: number): Promise<number | undefined> } | null = null

  async function flush() {
    if (inFlight || !pending) return
    const request = pending
    const requestEpoch = epoch
    pending = null
    timer = null
    inFlight = true
    const revision = await request.save(request.revision)
    if (requestEpoch !== epoch) return
    inFlight = false
    onSettled()
    resume(revision)
  }

  function resume(revision: number | undefined) {
    if (revision !== undefined && pending) {
      pending.revision = revision
      void flush()
    } else {
      pending = null
    }
  }

  return {
    get inFlight() { return inFlight },
    schedule(revision: number, save: (revision: number) => Promise<number | undefined>, delay: number) {
      pending = { revision, save }
      if (timer) clearTimeout(timer)
      if (!inFlight) timer = setTimeout(() => { void flush() }, delay)
    },
    clear() {
      epoch += 1
      if (timer) clearTimeout(timer)
      timer = null
      pending = null
      inFlight = false
    },
  }
}

function deriveOpenedFileRoute({
  pendingFileId,
  fileOpenParam,
  pendingRoute,
  controlledSnapshot,
  files,
}: {
  pendingFileId: string | null
  fileOpenParam: string | null
  pendingRoute: string | null
  controlledSnapshot?: ControlledKnowledgeFileSnapshot
  files: FileNode[]
}) {
  const activeFileId = pendingFileId && fileOpenParam === pendingRoute
    ? pendingFileId
    : fileOpenParam ?? pendingFileId
  const listedFile = activeFileId ? files.find((file) => file._id === activeFileId) ?? null : null
  const detailMatches = Boolean(controlledSnapshot && controlledSnapshot.detailFileId === activeFileId)
  const detailSettled = Boolean(detailMatches && !controlledSnapshot?.detailLoading)
  const detailDenied = Boolean(controlledSnapshot && activeFileId && detailMatches && detailSettled
    && (controlledSnapshot.detailError || !controlledSnapshot.detail))
  return { activeFileId, listedFile, detailMatches, detailSettled, detailDenied }
}

function selectOpenedMetadata({
  activeFileId,
  listedFile,
  detailMatches,
  detailSettled,
  controlledSnapshot,
  localSelectedFile,
}: {
  activeFileId: string | null
  listedFile: FileNode | null
  detailMatches: boolean
  detailSettled: boolean
  controlledSnapshot?: ControlledKnowledgeFileSnapshot
  localSelectedFile: FileNode | null
}) {
  if (!controlledSnapshot) {
    return activeFileId
      ? (localSelectedFile?._id === activeFileId ? localSelectedFile : listedFile)
      : null
  }
  if (activeFileId && detailMatches && controlledSnapshot.detailError) return null
  if (activeFileId && detailMatches && detailSettled && !controlledSnapshot.detail) return null
  if (activeFileId && detailMatches && controlledSnapshot.detail) return controlledSnapshot.detail
  return activeFileId && !detailSettled
    ? (localSelectedFile?._id === activeFileId ? localSelectedFile : listedFile)
    : null
}

function deriveOpenedFileSelection({
  pendingFileId,
  fileOpenParam,
  pendingRoute,
  controlledSnapshot,
  files,
  localSelectedFile,
  acknowledgedUpdate,
  selectionEpoch,
}: {
  pendingFileId: string | null
  fileOpenParam: string | null
  pendingRoute: string | null
  controlledSnapshot?: ControlledKnowledgeFileSnapshot
  files: FileNode[]
  localSelectedFile: FileNode | null
  acknowledgedUpdate: AcknowledgedUpdate | null
  selectionEpoch: number
}) {
  const route = deriveOpenedFileRoute({
    pendingFileId,
    fileOpenParam,
    pendingRoute,
    controlledSnapshot,
    files,
  })
  const { activeFileId, listedFile, detailMatches, detailSettled, detailDenied } = route
  const selectedMetadata = selectOpenedMetadata({
    activeFileId,
    listedFile,
    detailMatches,
    detailSettled,
    controlledSnapshot,
    localSelectedFile,
  })
  const acknowledgedForSelection = acknowledgedUpdate
    && acknowledgedUpdate.selectionEpoch === selectionEpoch
    && acknowledgedUpdate.fileId === selectedMetadata?._id
    && acknowledgedUpdate.acceptedRevisions.includes(selectedMetadata.updatedAt)
    ? acknowledgedUpdate
    : null
  const selectedFile = selectedMetadata && acknowledgedForSelection
    ? {
      ...selectedMetadata,
      updatedAt: acknowledgedForSelection.updatedAt,
      ...(acknowledgedForSelection.name !== undefined
        ? { name: acknowledgedForSelection.name, extension: acknowledgedForSelection.extension }
        : {}),
    }
    : selectedMetadata
  return {
    activeFileId,
    detailMatches,
    detailSettled,
    detailDenied,
    selectionId: detailDenied ? null : activeFileId,
    selectedMetadata,
    selectedFile,
  }
}

function deriveOpenedFileDraftView({
  selectedFile,
  titleDraft,
  contentState,
  fileContent,
  contentSaveInFlight,
  titleSaveInFlight,
}: {
  selectedFile: FileNode | null
  titleDraft: {
    fileId: string
    value: string
    revision: number
    dirty: boolean
    generation: number
  } | null
  contentState: {
    fileId: string
    revision: number
    status: 'loading' | 'ready' | 'error'
    dirty: boolean
    generation: number
    error?: string
  } | null
  fileContent: string
  contentSaveInFlight: boolean
  titleSaveInFlight: boolean
}) {
  const contentConflict = Boolean(selectedFile && contentState?.fileId === selectedFile._id
    && contentState.dirty && contentState.revision !== selectedFile.updatedAt && !contentSaveInFlight)
  const contentStatus = !selectedFile ? 'idle'
    : contentConflict ? 'ready'
      : contentState?.fileId === selectedFile._id && (contentState.revision === selectedFile.updatedAt || contentSaveInFlight)
        ? contentState.status
        : 'loading'
  const contentError = contentConflict
    ? 'This file changed elsewhere. Your draft is still here; reopen the file before saving.'
    : contentState && contentState.fileId === selectedFile?._id ? contentState.error ?? null : null
  const visibleContent = selectedFile && contentState?.fileId === selectedFile._id
    && (contentState.dirty || contentState.revision === selectedFile.updatedAt)
    ? fileContent : ''
  const fileTitle = selectedFile
    ? titleDraft?.fileId === selectedFile._id ? titleDraft.value : selectedFile.name
    : ''
  const titleConflict = Boolean(selectedFile && titleDraft?.fileId === selectedFile._id
    && titleDraft.dirty && titleDraft.revision !== selectedFile.updatedAt && !titleSaveInFlight)
  return { contentStatus, contentError, contentConflict, visibleContent, fileTitle, titleConflict }
}

export function useOpenedFile({
  adapters,
  filePort,
  setFiles,
  openFilesInHost,
  fileOpenParam,
  updateQuery,
  controlledSnapshot,
  files,
}: {
  adapters: KnowledgeSurfaceAdapters
  filePort: SharedKnowledgeFilePort
  setFiles: Dispatch<SetStateAction<FileNode[]>>
  openFilesInHost: boolean
  fileOpenParam: string | null
  updateQuery: (updates: Record<string, string | null | undefined>) => void
  controlledSnapshot?: ControlledKnowledgeFileSnapshot
  files: FileNode[]
}) {
  const [localSelectedFile, setSelectedFile] = useState<FileNode | null>(null)
  const [fileContent, setFileContent] = useState('')
  const [pendingFileId, setPendingFileId] = useState<string | null>(null)
  const [titleDraft, setTitleDraft] = useState<{
    fileId: string
    value: string
    revision: number
    dirty: boolean
    generation: number
  } | null>(null)
  const [contentState, setContentState] = useState<{
    fileId: string
    revision: number
    status: 'loading' | 'ready' | 'error'
    dirty: boolean
    generation: number
    error?: string
  } | null>(null)
  const [savingIdentity, setSavingIdentity] = useState<string | null>(null)
  const [acknowledgedUpdate, setAcknowledgedUpdate] = useState<AcknowledgedUpdate | null>(null)
  const [, setSaveVersion] = useState(0)
  const contentSaveQueueRef = useRef(createDraftSaveQueue(() => setSaveVersion((value) => value + 1)))
  const titleSaveQueueRef = useRef(createDraftSaveQueue(() => setSaveVersion((value) => value + 1)))
  const lastFileTriggerRef = useRef<HTMLElement | null>(null)
  const loadVersionRef = useRef(0)
  const loadControllerRef = useRef<AbortController | null>(null)
  const activeLoadKeyRef = useRef<string | null>(null)
  const activeLoadPromiseRef = useRef<Promise<void> | null>(null)
  const filesRef = useRef(files)
  const snapshotRef = useRef(controlledSnapshot)
  const localSelectedFileRef = useRef(localSelectedFile)
  const contentStateRef = useRef(contentState)
  const titleDraftRef = useRef(titleDraft)
  const acknowledgedUpdateRef = useRef(acknowledgedUpdate)
  const selectionIdRef = useRef<string | null>(null)
  const selectionEpochRef = useRef(0)
  const contentGenerationRef = useRef(0)
  const titleGenerationRef = useRef(0)
  filesRef.current = files
  snapshotRef.current = controlledSnapshot
  localSelectedFileRef.current = localSelectedFile
  contentStateRef.current = contentState
  titleDraftRef.current = titleDraft
  acknowledgedUpdateRef.current = acknowledgedUpdate

  const updateSelectionId = useCallback((id: string | null) => {
    if (selectionIdRef.current === id) return
    contentSaveQueueRef.current.clear()
    titleSaveQueueRef.current.clear()
    selectionIdRef.current = id
    selectionEpochRef.current += 1
    contentGenerationRef.current += 1
    titleGenerationRef.current += 1
  }, [])

  const pendingRouteRef = useRef<string | null>(null)
  const selection = deriveOpenedFileSelection({
    pendingFileId,
    fileOpenParam,
    pendingRoute: pendingRouteRef.current,
    controlledSnapshot,
    files,
    localSelectedFile,
    acknowledgedUpdate,
    selectionEpoch: selectionEpochRef.current,
  })
  const { activeFileId, detailMatches, detailSettled, detailDenied, selectedMetadata, selectedFile } = selection
  updateSelectionId(selection.selectionId)
  const selectedFileRef = useRef<FileNode | null>(selectedFile)
  selectedFileRef.current = selectedFile
  const selectedFileIdentity = selectedFile ? `${selectedFile._id}:${selectedFile.updatedAt}` : null

  function rememberAcknowledgedUpdate(input: Omit<AcknowledgedUpdate, 'expectedRevision' | 'acceptedRevisions'> & {
    expectedRevision: number
  }) {
    const previous = acknowledgedUpdateRef.current
    const canExtend = previous?.fileId === input.fileId
      && previous.selectionEpoch === input.selectionEpoch
      && selectedMetadata
      && previous.acceptedRevisions.includes(selectedMetadata.updatedAt)
    const expectedRevision = canExtend ? previous.expectedRevision : input.expectedRevision
    const acceptedRevisions = canExtend
      ? [...new Set([...previous.acceptedRevisions, input.updatedAt])]
      : [...new Set([input.expectedRevision, input.updatedAt])]
    const next: AcknowledgedUpdate = {
      ...input,
      expectedRevision,
      acceptedRevisions,
      ...(!('name' in input) && canExtend && previous.name !== undefined ? { name: previous.name } : {}),
      ...(!('extension' in input) && canExtend && previous.extension !== undefined
        ? { extension: previous.extension }
        : {}),
    }
    acknowledgedUpdateRef.current = next
    setAcknowledgedUpdate(next)
  }

  useEffect(() => {
    const key = selectedFileIdentity
    if (activeLoadKeyRef.current && activeLoadKeyRef.current !== key) {
      loadVersionRef.current += 1
      loadControllerRef.current?.abort()
      loadControllerRef.current = null
      activeLoadKeyRef.current = null
      activeLoadPromiseRef.current = null
    }
    setSavingIdentity(null)
  }, [selectedFileIdentity])

  const clearOpenedFile = useCallback(() => {
    selectionIdRef.current = null
    selectionEpochRef.current += 1
    contentGenerationRef.current += 1
    titleGenerationRef.current += 1
    loadVersionRef.current += 1
    loadControllerRef.current?.abort()
    loadControllerRef.current = null
    activeLoadKeyRef.current = null
    activeLoadPromiseRef.current = null
    contentSaveQueueRef.current.clear()
    titleSaveQueueRef.current.clear()
    setSelectedFile(null)
    setPendingFileId(null)
    setFileContent('')
    setTitleDraft(null)
    setContentState(null)
    setAcknowledgedUpdate(null)
    setSavingIdentity(null)
  }, [])

  const { navigation, repository } = adapters
  const loadFile = useCallback((fileId: string, knownFile?: FileNode): Promise<void> => {
    const selectionEpoch = selectionEpochRef.current
    const contentGeneration = contentGenerationRef.current
    const file = knownFile
      ?? (snapshotRef.current?.detailFileId === fileId ? snapshotRef.current.detail : null)
      ?? filesRef.current.find((candidate) => candidate._id === fileId)
      ?? (localSelectedFileRef.current?._id === fileId ? localSelectedFileRef.current : null)
    const key = `${fileId}:${file?.updatedAt ?? 'unknown'}`
    if (activeLoadKeyRef.current === key && activeLoadPromiseRef.current) return activeLoadPromiseRef.current
    if (file && opensInDocumentEditor(file)) {
      void navigation.open(normalizeKnowledgeSurfaceNode(file), { replace: true })
      return Promise.resolve()
    }
    const currentSelection = selectedFileRef.current
    if (currentSelection && (currentSelection._id !== fileId || currentSelection.updatedAt !== file?.updatedAt)) {
      setSavingIdentity(null)
    }
    if (file) {
      setSelectedFile(file)
      setPendingFileId(fileId)
      setTitleDraft((current) => current?.fileId === fileId && current.dirty
        ? current
        : {
          fileId,
          value: file.name,
          revision: file.updatedAt,
          dirty: false,
          generation: titleGenerationRef.current,
        })
      const currentContent = contentStateRef.current
      if (currentContent?.fileId === fileId && currentContent.revision === file.updatedAt
        && currentContent.status === 'ready') return Promise.resolve()
      if (currentContent?.fileId === fileId && currentContent.dirty) return Promise.resolve()
      setFileContent('')
      setContentState({
        fileId,
        revision: file.updatedAt,
        status: 'loading',
        dirty: false,
        generation: contentGeneration,
      })
    }
    loadControllerRef.current?.abort()
    const controller = new AbortController()
    loadControllerRef.current = controller
    const loadVersion = ++loadVersionRef.current
    activeLoadKeyRef.current = key
    if (typeof document !== 'undefined' && document.activeElement instanceof HTMLElement) {
      lastFileTriggerRef.current = document.activeElement
    }
    const promise = (async () => {
      try {
        const loaded = await repository.get(fileId, controller.signal)
        if (controller.signal.aborted || loadVersion !== loadVersionRef.current
          || selectionEpochRef.current !== selectionEpoch
          || contentGenerationRef.current !== contentGeneration
          || contentStateRef.current?.fileId === fileId && contentStateRef.current.dirty) return
        if (!loaded || loaded._id !== fileId) {
          if (file) setContentState({
            fileId,
            revision: file.updatedAt,
            status: 'error',
            dirty: false,
            generation: contentGeneration,
            error: 'File is unavailable.',
          })
          return
        }
        if (file && loaded.updatedAt !== file.updatedAt) {
          setContentState({
            fileId,
            revision: file.updatedAt,
            status: 'error',
            dirty: false,
            generation: contentGeneration,
            error: 'The file changed while it was opening. Reopen it to load the latest version.',
          })
          return
        }
        if (!snapshotRef.current) {
          setSelectedFile((current) => current?._id === fileId ? { ...current, ...loaded } : current ?? loaded)
        }
        setFileContent(loaded.textContent ?? loaded.content ?? '')
        setContentState({
          fileId,
          revision: loaded.updatedAt,
          status: 'ready',
          dirty: false,
          generation: contentGeneration,
        })
      } catch (error) {
        if (controller.signal.aborted || loadVersion !== loadVersionRef.current
          || selectionEpochRef.current !== selectionEpoch
          || contentGenerationRef.current !== contentGeneration
          || contentStateRef.current?.fileId === fileId && contentStateRef.current.dirty) return
        if (file) setContentState({
          fileId,
          revision: file.updatedAt,
          status: 'error',
          dirty: false,
          generation: contentGeneration,
          error: error instanceof Error ? error.message : 'Could not load file.',
        })
      } finally {
        if (activeLoadKeyRef.current === key) {
          activeLoadKeyRef.current = null
          activeLoadPromiseRef.current = null
        }
      }
    })()
    activeLoadPromiseRef.current = promise
    return promise
  }, [navigation, repository])

  useEffect(() => () => {
    selectionIdRef.current = null
    selectionEpochRef.current += 1
    contentGenerationRef.current += 1
    titleGenerationRef.current += 1
    loadVersionRef.current += 1
    loadControllerRef.current?.abort()
    contentSaveQueueRef.current.clear()
    titleSaveQueueRef.current.clear()
  }, [])

  useEffect(() => () => {
    loadControllerRef.current?.abort()
    loadControllerRef.current = null
    activeLoadKeyRef.current = null
    activeLoadPromiseRef.current = null
    contentSaveQueueRef.current.clear()
    titleSaveQueueRef.current.clear()
  }, [fileOpenParam])

  useEffect(() => {
    if (!pendingFileId) return
    if (fileOpenParam === pendingFileId || fileOpenParam !== pendingRouteRef.current) {
      pendingRouteRef.current = null
      setPendingFileId(null)
    }
  }, [fileOpenParam, pendingFileId])

  useEffect(() => {
    if (!controlledSnapshot || !activeFileId || !detailMatches || !detailSettled
      || !detailDenied) return
    loadVersionRef.current += 1
    loadControllerRef.current?.abort()
    loadControllerRef.current = null
    activeLoadKeyRef.current = null
    activeLoadPromiseRef.current = null
    contentSaveQueueRef.current.clear()
    titleSaveQueueRef.current.clear()
    setSelectedFile(null)
    setFileContent('')
    setTitleDraft(null)
    setContentState(null)
    setAcknowledgedUpdate(null)
    setSavingIdentity(null)
  }, [activeFileId, controlledSnapshot, detailDenied, detailMatches, detailSettled])

  const {
    contentStatus,
    contentError,
    contentConflict,
    visibleContent,
    fileTitle,
    titleConflict,
  } = deriveOpenedFileDraftView({
    selectedFile, titleDraft, contentState, fileContent,
    contentSaveInFlight: contentSaveQueueRef.current.inFlight,
    titleSaveInFlight: titleSaveQueueRef.current.inFlight,
  })
  const isSavingFile = Boolean(selectedFile && savingIdentity === `${selectedFile._id}:${selectedFile.updatedAt}`)

  function setFileTitle(value: React.SetStateAction<string>) {
    if (!selectedFile) return
    const generation = ++titleGenerationRef.current
    setTitleDraft((current) => {
      const currentValue = current?.fileId === selectedFile._id ? current.value : selectedFile.name
      return {
        fileId: selectedFile._id,
        value: typeof value === 'function' ? value(currentValue) : value,
        revision: selectedFile.updatedAt,
        dirty: false,
        generation,
      }
    })
  }

  function handleSelectFile(node: FileNode) {
    if (openFilesInHost || opensInDocumentEditor(node)) {
      void adapters.navigation.open(node as Parameters<typeof adapters.navigation.open>[0])
      return
    }
    updateSelectionId(node._id)
    if (controlledSnapshot) {
      pendingRouteRef.current = fileOpenParam
      setSelectedFile(node)
      setPendingFileId(node._id)
      if (controlledSnapshot.detailFileId === node._id && controlledSnapshot.detail) {
        void loadFile(node._id, controlledSnapshot.detail)
      }
      updateQuery({ view: 'files', file: node._id })
      return
    }
    void loadFile(node._id, node)
    updateQuery({ view: 'files', file: node._id })
  }

  function closeFileDialog() {
    clearOpenedFile()
    updateQuery({ file: null })
    requestAnimationFrame(() => {
      if (lastFileTriggerRef.current?.isConnected) lastFileTriggerRef.current.focus()
    })
  }

  function handleFileContentChange(val: string) {
    if (!selectedFile || contentStatus !== 'ready' || contentConflict || !contentState) return
    const fileId = selectedFile._id
    const draftRevision = contentSaveQueueRef.current.inFlight ? contentState.revision : selectedFile.updatedAt
    const selectionEpoch = selectionEpochRef.current
    const generation = ++contentGenerationRef.current
    setFileContent(val)
    const nextDraft = { fileId, revision: draftRevision, status: 'ready' as const, dirty: true, generation }
    contentStateRef.current = nextDraft
    setContentState(nextDraft)
    contentSaveQueueRef.current.schedule(draftRevision, async (revision) => {
      const identity = `${fileId}:${revision}`
      const active = selectedFileRef.current
      const draft = contentStateRef.current
      if (!canSaveDraft({ active, draft, fileId, revision, generation,
        currentGeneration: contentGenerationRef.current, epoch: selectionEpoch,
        currentEpoch: selectionEpochRef.current })) return
      setSavingIdentity(identity)
      try {
        const saved = await filePort.saveContent(fileId, val, revision)
        if (!saved) throw new Error('Could not save file.')
        const current = selectedFileRef.current
        if (!current || current._id !== fileId || selectionEpochRef.current !== selectionEpoch) return
        const acknowledgedRevision = typeof saved === 'object' ? saved.updatedAt : undefined
        if (acknowledgedRevision !== undefined) {
          if (current.updatedAt !== revision && current.updatedAt !== acknowledgedRevision) return
          rememberAcknowledgedUpdate({
            fileId,
            selectionEpoch,
            expectedRevision: revision,
            updatedAt: acknowledgedRevision,
          })
          selectedFileRef.current = { ...current, updatedAt: acknowledgedRevision }
        } else if (current.updatedAt !== revision) {
          return
        }
        filePort.entityChanged('file', fileId, 'updated')
        const currentDraft = contentStateRef.current
        if (currentDraft?.fileId === fileId && currentDraft.revision === revision) {
          const next = {
            ...currentDraft,
            revision: acknowledgedRevision ?? revision,
            dirty: currentDraft.generation !== generation,
          }
          contentStateRef.current = next
          setContentState(next)
        }
        if (acknowledgedRevision !== undefined) {
          setFiles((prev) => prev.map((f) => f._id === fileId
            ? { ...f, updatedAt: acknowledgedRevision }
            : f))
        }
        return acknowledgedRevision
      } catch (error) {
        if (selectedFileRef.current?._id !== fileId || selectionEpochRef.current !== selectionEpoch) return
        setContentState((current) => current?.fileId === fileId && current.revision === revision
          ? { ...current, status: 'error', dirty: true, error: error instanceof Error ? error.message : 'Could not save file.' }
          : current)
      } finally {
        if (selectionEpochRef.current === selectionEpoch) {
          setSavingIdentity((current) => current === identity ? null : current)
        }
      }
    }, 800)
  }

  function handleFileTitleChange(val: string) {
    if (!selectedFile || titleConflict) return
    const fileId = selectedFile._id
    const draftRevision = titleSaveQueueRef.current.inFlight
      ? titleDraftRef.current?.revision ?? selectedFile.updatedAt
      : selectedFile.updatedAt
    const selectionEpoch = selectionEpochRef.current
    const generation = ++titleGenerationRef.current
    const nextDraft = { fileId, value: val, revision: draftRevision, dirty: true, generation }
    titleDraftRef.current = nextDraft
    setTitleDraft(nextDraft)
    const nextName = val.trim() || 'Untitled'
    titleSaveQueueRef.current.schedule(draftRevision, async (revision) => {
      const active = selectedFileRef.current
      const draft = titleDraftRef.current
      if (!canSaveDraft({ active, draft, fileId, revision, generation,
        currentGeneration: titleGenerationRef.current, epoch: selectionEpoch,
        currentEpoch: selectionEpochRef.current })) return
      const identity = `${fileId}:${revision}`
      setSavingIdentity(identity)
      try {
        const renamed = await adapters.repository.rename({ id: fileId, name: nextName, expectedRevision: String(revision) })
        const current = selectedFileRef.current
        if (!current || current._id !== fileId || selectionEpochRef.current !== selectionEpoch) return
        if (current.updatedAt !== revision && current.updatedAt !== renamed.updatedAt) return
        rememberAcknowledgedUpdate({
          fileId,
          selectionEpoch,
          expectedRevision: revision,
          updatedAt: renamed.updatedAt,
          name: renamed.name,
          extension: renamed.extension,
        })
        selectedFileRef.current = renamed
        setSelectedFile(renamed)
        const currentDraft = titleDraftRef.current
        if (currentDraft?.fileId === fileId && currentDraft.revision === revision) {
          const dirty = currentDraft.generation !== generation
          const next = { ...currentDraft, value: dirty ? currentDraft.value : renamed.name, revision: renamed.updatedAt, dirty }
          titleDraftRef.current = next
          setTitleDraft(next)
        }
        setFiles((prev) => prev.map((f) => f._id === fileId
          ? { ...f, name: renamed.name, updatedAt: renamed.updatedAt }
          : f))
        return renamed.updatedAt
      } catch (error) {
        if (selectedFileRef.current?._id === fileId && selectionEpochRef.current === selectionEpoch) {
          toast.error(error instanceof Error ? error.message : 'Could not rename file.')
        }
      } finally {
        if (selectionEpochRef.current === selectionEpoch) {
          setSavingIdentity((current) => current === identity ? null : current)
        }
      }
    }, 600)
  }

  return {
    selectedFile,
    setSelectedFile,
    fileContent: visibleContent,
    setFileContent,
    fileTitle,
    setFileTitle,
    isSavingFile,
    contentStatus,
    contentError,
    contentConflict,
    titleConflict,
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
      toast.success('File moved.')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not move file.')
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
    const ids = [...selectedMemoryIds]
    setBulkDeleting(true)
    try {
      const results = await Promise.all(ids.map(async (id) => ({
        id,
        deleted: await memoryPort.delete(id).catch(() => false),
      })))
      const deletedIds = new Set(results.filter((result) => result.deleted).map((result) => result.id))
      const failedIds = results.filter((result) => !result.deleted).map((result) => result.id)
      if (selectedMemory && deletedIds.has(selectedMemory.memoryId)) {
        setSelectedMemory(null)
        updateQuery({ memory: null })
      }
      if (deletedIds.size > 0) await loadMemories()
      if (failedIds.length > 0) {
        setSelectedMemoryIds(new Set(failedIds))
        toast.error(
          deletedIds.size === 0
            ? 'Could not delete memories.'
            : `Deleted ${deletedIds.size} of ${ids.length} memories. ${failedIds.length} could not be deleted.`,
        )
      } else {
        toast.success(ids.length === 1 ? 'Memory deleted.' : `${ids.length} memories deleted.`)
        exitSelectMode()
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not delete memories.')
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

  /** The selected items left this list without being deleted (moved to another scope, or archived). */
  function dropSelectedFromView() {
    const ids = Array.from(selectedFileIds)
    if (ids.length === 0) return
    setFiles((prev) => removeKnowledgeFileSubtrees(prev, ids))
    exitSelectMode()
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
    dropSelectedFromView,
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

interface UploadBatchResult {
  uploadedCount: number
  errorMessage: string | null
}

async function uploadFlatBatch(
  list: readonly File[],
  filePort: SharedKnowledgeFilePort,
  parentId: string | null,
  setFiles: Dispatch<SetStateAction<FileNode[]>>,
): Promise<UploadBatchResult> {
  let uploadedCount = 0
  try {
    for (const file of list) {
      const result = await uploadSingleFile(filePort, file, parentId)
      if (!result.ok) return { uploadedCount, errorMessage: result.error ?? 'One or more files failed to upload.' }
      uploadedCount += 1
      if (result.file) {
        setFiles((current) => [...current.filter((node) => node._id !== result.file!._id), result.file!])
        filePort.entityChanged('file', result.file._id, 'created')
      }
    }
    return { uploadedCount, errorMessage: null }
  } catch (error) {
    return {
      uploadedCount,
      errorMessage: error instanceof Error ? error.message : 'Could not upload files.',
    }
  }
}

async function uploadFolderBatch(
  list: readonly File[],
  adapters: KnowledgeSurfaceAdapters,
  filePort: SharedKnowledgeFilePort,
  parentId: string | null,
  setFiles: Dispatch<SetStateAction<FileNode[]>>,
): Promise<UploadBatchResult> {
  let uploadedCount = 0
  const folders = new Map<string, string>()
  try {
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
          parentId: parentPath ? (folders.get(parentPath) ?? null) : parentId,
        })
        folders.set(folderPath, created.id)
      }
      const parentFolderPath = parts.slice(0, -1).join('/')
      const result = await uploadSingleFile(filePort, file, folders.get(parentFolderPath) ?? parentId)
      if (!result.ok) return { uploadedCount, errorMessage: result.error ?? 'One or more files failed to upload.' }
      uploadedCount += 1
      if (result.file) setFiles((current) => [...current.filter((node) => node._id !== result.file!._id), result.file!])
    }
    return { uploadedCount, errorMessage: null }
  } catch (error) {
    return {
      uploadedCount,
      errorMessage: error instanceof Error ? error.message : 'Could not upload files.',
    }
  }
}

function settleUploadToast(
  uploadToast: ReturnType<typeof beginKnowledgeUploadToast>,
  result: UploadBatchResult,
  total: number,
  successMessage: string,
) {
  if (!result.errorMessage) {
    uploadToast.success(successMessage)
    return
  }
  const summary = result.uploadedCount > 0
    ? `Uploaded ${result.uploadedCount} of ${total} files. ${result.errorMessage}`
    : result.errorMessage
  uploadToast.error(summary)
}

export function useFileUploads({
  adapters,
  filePort,
  activeFolder,
  setFiles,
}: {
  adapters: KnowledgeSurfaceAdapters
  filePort: SharedKnowledgeFilePort
  activeFolder: FileNode | null
  setFiles: React.Dispatch<React.SetStateAction<FileNode[]>>
}) {
  const fileUploadRef = useRef<HTMLInputElement>(null)

  async function uploadFiles(list: readonly File[], folderUpload: boolean) {
    if (list.length === 0) return
    const label = list.length === 1 ? list[0]!.name : `${folderUpload ? 'Folder' : 'Files'} · ${list.length} files`
    const uploadToast = beginKnowledgeUploadToast(toast, `Uploading ${label}…`)
    const result = folderUpload
      ? await uploadFolderBatch(list, adapters, filePort, activeFolder?._id ?? null, setFiles)
      : await uploadFlatBatch(list, filePort, activeFolder?._id ?? null, setFiles)
    const successMessage = list.length === 1 && !folderUpload ? `Uploaded ${list[0]!.name}.` : `Uploaded ${list.length} files.`
    settleUploadToast(uploadToast, result, list.length, successMessage)
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
    const uploadToast = beginKnowledgeUploadToast(toast, `Uploading ${file.name}…`)
    try {
      const result = await uploadSingleFile(filePort, file, activeFolder?._id ?? null)
      if (!result.ok) {
        uploadToast.error(result.error ?? 'Upload failed. Check the file and try again.')
        return
      }
      if (result.file) {
        setFiles((current) => [...current.filter((node) => node._id !== result.file!._id), result.file!])
        filePort.entityChanged('file', result.file._id, 'created')
      }
      uploadToast.success(`Uploaded ${file.name}.`)
    } catch (error) {
      uploadToast.error(error instanceof Error ? error.message : 'Could not upload file.')
    } finally {
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
}: {
  adapters: KnowledgeSurfaceAdapters
  filePort: SharedKnowledgeFilePort
  setFiles: React.Dispatch<React.SetStateAction<FileNode[]>>
}) {
  const folderUploadRef = useRef<HTMLInputElement>(null)

  async function handleUploadFolder(e: React.ChangeEvent<HTMLInputElement>) {
    const uploadedFiles = e.target.files
    if (!uploadedFiles) return
    const list = Array.from(uploadedFiles)
    if (list.length === 0) return
    const uploadToast = beginKnowledgeUploadToast(toast, `Uploading Folder · ${list.length} files…`)
    let uploadedCount = 0
    let errorMessage: string | null = null
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
          errorMessage = result.error ?? 'One or more files failed to upload.'
          break
        }
        uploadedCount += 1
        if (result.file) {
          setFiles((current) => [...current.filter((node) => node._id !== result.file!._id), result.file!])
          filePort.entityChanged('file', result.file._id, 'created')
        }
      }
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : 'Could not upload folder.'
    } finally {
      if (errorMessage) {
        const summary = uploadedCount > 0
          ? `Uploaded ${uploadedCount} of ${list.length} files. ${errorMessage}`
          : errorMessage
        uploadToast.error(summary)
      } else {
        uploadToast.success(`Uploaded ${list.length} files.`)
      }
      e.target.value = ''
    }
  }

  return {
    folderUploadRef,
    handleUploadFolder,
  }
}
