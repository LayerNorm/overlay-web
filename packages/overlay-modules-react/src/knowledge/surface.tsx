'use client'

import type { ReactNode } from 'react'
import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import {
  IMPORT_MEMORY_PROMPT,
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
  type KnowledgeLayout,
  type KnowledgePickedFile,
  type KnowledgeSurfaceAdapters,
  sortedCurrentFolderFiles,
  sortedCurrentFolderFolders,
  sortedCurrentFolderNodes,
  type KnowledgeFileNode as FileNode,
  type KnowledgeOutputFilter as OutputFilter,
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

// ─── Main KnowledgeView ───────────────────────────────────────────────────────

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

  useEffect(() => {
    if (!pendingFilesLayout) return
    if (!queryPending && layout === pendingFilesLayout) {
      setPendingFilesLayout(null)
    }
  }, [layout, pendingFilesLayout, queryPending])

  const [, setOutputsRefreshKey] = useState(0)
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

  // ── Memories state ──
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
  const [fileUploadPending, setFileUploadPending] = useState<{ label: string } | null>(null)
  const [fileUploadError, setFileUploadError] = useState<string | null>(null)

  // ── File system state ──
  const [files, setFiles] = useState<FileNode[]>(() => initialFiles ?? [])
  const [filesLoading, setFilesLoading] = useState(initialFiles === undefined)
  const [filesRefreshing, setFilesRefreshing] = useState(false)
  const [filesLoadError, setFilesLoadError] = useState<string | null>(null)
  const hasLoadedFilesRef = useRef(initialFiles !== undefined)
  const [selectedFile, setSelectedFile] = useState<FileNode | null>(null)
  const [fileContent, setFileContent] = useState('')
  const [fileTitle, setFileTitle] = useState('')
  const [isSavingFile, setIsSavingFile] = useState(false)
  const [dialog, setDialog] = useState<{ type: 'file' | 'folder'; parentId: string | null } | null>(null)
  const [dialogName, setDialogName] = useState('')
  const [isCreating, setIsCreating] = useState(false)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const titleSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastFileTriggerRef = useRef<HTMLElement | null>(null)
  const fileUploadRef = useRef<HTMLInputElement>(null)
  const folderUploadRef = useRef<HTMLInputElement>(null)
  const createMenuRef = useRef<HTMLDivElement>(null)
  const uploadMenuRef = useRef<HTMLDivElement>(null)
  const [createMenuOpen, setCreateMenuOpen] = useState(false)
  const [uploadMenuOpen, setUploadMenuOpen] = useState(false)

  const [memorySearchOpen, setMemorySearchOpen] = useState(false)
  const [memorySearchQuery, setMemorySearchQuery] = useState('')
  const [fileSearchOpen, setFileSearchOpen] = useState(false)
  const [fileSearchQuery, setFileSearchQuery] = useState('')

  const [selectMode, setSelectMode] = useState(false)
  const [selectedMemoryIds, setSelectedMemoryIds] = useState<Set<string>>(() => new Set())
  const [selectedFileIds, setSelectedFileIds] = useState<Set<string>>(() => new Set())
  const [selectedOutputIds, setSelectedOutputIds] = useState<Set<string>>(() => new Set())
  const [bulkDeleting, setBulkDeleting] = useState(false)

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

  useEffect(() => {
    setSelectMode(false)
    setSelectedMemoryIds(new Set())
    setSelectedFileIds(new Set())
    setSelectedOutputIds(new Set())
  }, [activeTab])

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

  const loadMemories = useCallback(async () => {
    try {
      setMemories(await memoryPort.list())
    } catch { /* ignore */ } finally { setMemoriesLoading(false) }
  }, [memoryPort])

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

  useEffect(() => () => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    if (titleSaveTimerRef.current) clearTimeout(titleSaveTimerRef.current)
  }, [])

  useEffect(() => {
    if (initialMemories !== undefined || activeTab !== 'memories') return
    void loadMemories()
  }, [activeTab, initialMemories, loadMemories])

  useEffect(() => {
    if (initialFiles !== undefined || (activeTab !== 'files' && activeTab !== 'outputs')) return
    void loadFiles()
  }, [activeTab, initialFiles, loadFiles])

  useEffect(() => {
    if (activeTab !== 'memories') return
    const onVis = () => {
      if (document.visibilityState === 'visible') void loadMemories()
    }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [activeTab, loadMemories])

  useEffect(() => {
    if (!fileOpenParam || filesLoading || files.length === 0) return
    const node = files.find((f) => f._id === fileOpenParam && f.type === 'file')
    if (!node) return
    void loadFile(node._id)
  }, [fileOpenParam, files, filesLoading, loadFile])

  useEffect(() => {
    if (!memoryOpenParam || memoriesLoading || memories.length === 0) return
    const mem = memories.find((m) => m.memoryId === memoryOpenParam)
    if (!mem) return
    setSelectedMemory(mem)
  }, [memoryOpenParam, memories, memoriesLoading])

  // ── Memory handlers ──
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

  function closeFileDialog() {
    setSelectedFile(null)
    setFileContent('')
    setFileTitle('')
    updateQuery({ file: null })
    requestAnimationFrame(() => {
      if (lastFileTriggerRef.current?.isConnected) lastFileTriggerRef.current.focus()
    })
  }

  // ── File handlers ──
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

  function handleSelectFile(node: FileNode) {
    if (openFilesInHost || opensInDocumentEditor(node)) {
      void adapters.navigation.open(node as Parameters<typeof adapters.navigation.open>[0])
      return
    }
    void loadFile(node._id)
    updateQuery({ view: 'files', file: node._id })
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

  async function uploadSingleFile(file: File, parentId: string | null): Promise<{ ok: boolean; error?: string; file?: FileNode }> {
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

  async function uploadFiles(list: readonly File[], folderUpload: boolean) {
    if (list.length === 0) return
    setFileUploadError(null)
    setFileUploadPending({ label: list.length === 1 ? list[0]!.name : `${folderUpload ? 'Folder' : 'Files'} · ${list.length} files` })
    try {
      if (!folderUpload) {
        for (const file of list) {
          const result = await uploadSingleFile(file, activeFolder?._id ?? null)
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
            const created = await adapters.repository.create({
              name: parts[index] ?? 'Folder',
              kind: 'folder',
              parentId: parentPath ? (folders.get(parentPath) ?? null) : (activeFolder?._id ?? null),
            })
            folders.set(folderPath, created.id)
          }
          const parentFolderPath = parts.slice(0, -1).join('/')
          const result = await uploadSingleFile(file, folders.get(parentFolderPath) ?? activeFolder?._id ?? null)
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
      const result = await uploadSingleFile(file, activeFolder?._id ?? null)
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
        const result = await uploadSingleFile(file, parentId)
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

  const memoriesFiltered = useMemo(() => {
    return filterMemoryRows(memories, memorySearchQuery)
  }, [memories, memorySearchQuery])

  const currentParentId = activeFolder?._id ?? null
  const rootNodes = sortedCurrentFolderNodes(filesFiltered, currentParentId)
  const flatFilesSorted = sortedCurrentFolderFiles(filesFiltered, currentParentId)
  const folderCardsSorted = sortedCurrentFolderFolders(filesFiltered, currentParentId)

  return (
    <>
      {showAddMemory && (
        <AddMemoryDialog
          value={addText}
          saving={isSavingMemory}
          error={memorySaveError}
          onChange={setAddText}
          onSave={handleAddMemory}
          onClose={() => {
            setShowAddMemory(false)
            setAddText('')
            setMemorySaveError(null)
          }}
        />
      )}

      {showImportMemory && (
        <ImportMemoryDialog
          value={importText}
          saving={isImporting}
          error={importMemoryError}
          promptCopied={importPromptCopied}
          onChange={setImportText}
          onSave={handleImportMemory}
          onCopyPrompt={async () => {
            await navigator.clipboard.writeText(IMPORT_MEMORY_PROMPT)
            setImportPromptCopied(true)
            setTimeout(() => setImportPromptCopied(false), 2000)
          }}
          onClose={() => {
            setShowImportMemory(false)
            setImportText('')
            setImportMemoryError(null)
          }}
        />
      )}

      {dialog && (
        <CreateKnowledgeItemDialog
          type={dialog.type}
          value={dialogName}
          creating={isCreating}
          onChange={setDialogName}
          onCreate={handleCreateFile}
          onClose={() => {
            setDialog(null)
            setDialogName('')
          }}
        />
      )}

      <HiddenKnowledgeFileInputs
        fileUploadRef={fileUploadRef}
        folderUploadRef={folderUploadRef}
        onFileChange={handleUploadFile}
        onFolderChange={handleUploadFolder}
      />

      {selectedMemory && (
        <MemoryDetailDialog
          memory={selectedMemory}
          onClose={closeMemoryDialog}
          onDelete={handleDeleteMemory}
        />
      )}

      <AppScreenShell
        className="overlay-knowledge-surface"
        onDragOver={enableExternalDrop ? (event) => {
          if (event.dataTransfer.types.includes('Files')) event.preventDefault()
        } : undefined}
        onDrop={enableExternalDrop ? (event) => {
          if (event.dataTransfer.files.length === 0) return
          event.preventDefault()
          void uploadFiles(Array.from(event.dataTransfer.files), false)
        } : undefined}
        header={
          <KnowledgeViewHeader
            activeFolder={activeFolder}
            activeTab={activeTab}
            bulkDeleting={bulkDeleting}
            createMenuOpen={createMenuOpen}
            createMenuRef={createMenuRef}
            fileCount={filesFiltered.length}
            fileSearchOpen={fileSearchOpen}
            fileSearchQuery={fileSearchQuery}
            filesCategory={filesCategory}
            fileTitle={fileTitle}
            fileUploadRef={fileUploadRef}
            folderBreadcrumb={folderBreadcrumb}
            folderUploadRef={folderUploadRef}
            isSavingFile={isSavingFile}
            layout={activeTab === 'files' ? visibleFilesLayout : layout}
            memoryCount={memoriesFiltered.length}
            memorySearchOpen={memorySearchOpen}
            memorySearchQuery={memorySearchQuery}
            mode={mode}
            moveFileToParent={(fileId, parentId) => void moveFileToParent(fileId, parentId)}
            navigateToFolder={navigateToFolder}
            onBulkDeleteFiles={() => void bulkDeleteFiles()}
            onBulkDeleteMemories={() => void bulkDeleteMemories()}
            onBulkDeleteOutputs={() => void bulkDeleteOutputs()}
            onCloseFile={closeFileDialog}
            onCommitOutputFilter={commitOutputFilter}
            onCreateNoteFile={() => void handleCreateNoteFile()}
            onPickFile={() => void handleNativePick(false)}
            onPickFolder={() => void handleNativePick(true)}
            onExitSelectMode={exitSelectMode}
            onFileTitleChange={handleFileTitleChange}
            onSetFileSearchOpen={setFileSearchOpen}
            onSetFileSearchQuery={setFileSearchQuery}
            onImportMemory={() => { setShowImportMemory(true); setImportMemoryError(null) }}
            onNewMemory={() => { setShowAddMemory(true); setMemorySaveError(null) }}
            onRefreshOutputs={() => setOutputsRefreshKey((k) => k + 1)}
            onSetMemorySearchOpen={setMemorySearchOpen}
            onSetMemorySearchQuery={setMemorySearchQuery}
            onSetSelectMode={setSelectMode}
            onUpdateQuery={updateQuery}
            outputFilter={outputFilter}
            outputFilterOpen={outputFilterOpen}
            outputFilterRef={outputFilterRef}
            rootItemCount={rootNodes.length}
            selectedFile={selectedFile}
            selectedFileCount={selectedFileIds.size}
            selectedMemoryCount={selectedMemoryIds.size}
            selectedOutputCount={selectedOutputIds.size}
            selectMode={selectMode}
            setCreateMenuOpen={setCreateMenuOpen}
            setDialog={setDialog}
            setDialogName={setDialogName}
            setOutputFilterOpen={setOutputFilterOpen}
            setUploadMenuOpen={setUploadMenuOpen}
            uploadMenuOpen={uploadMenuOpen}
            uploadMenuRef={uploadMenuRef}
          />
        }
      >
        {/* ── Main content ── */}
        <AppScreenBody
          padding="none"
          maxWidth="none"
          scroll={activeTab === 'outputs' ? 'hidden' : 'auto'}
          className={`px-6 py-4 ${activeTab === 'outputs' ? 'flex flex-col' : ''}`}
          aria-busy={filesLoading || filesRefreshing || undefined}
        >
        {activeTab === 'files' && selectedFile && (
          <KnowledgeFileDetailPanel
            fileName={selectedFile.name}
            isEditable={filePort.isEditable(selectedFile.name)}
            fileContent={fileContent}
            onContentChange={handleFileContentChange}
            renderViewer={() =>
              renderFileViewer({
                name: selectedFile.name,
                file: selectedFile,
                content: fileContent,
                url: filePort.contentUrl(selectedFile),
              })
            }
          />
        )}

        {activeTab === 'memories' && (memorySavePendingPreview || importPendingPreview) && (
          <KnowledgePendingNotice
            title={memorySavePendingPreview ? 'Saving memory…' : 'Importing memory…'}
            preview={memorySavePendingPreview ?? importPendingPreview}
          />
        )}

        {activeTab === 'memories' && (
          <KnowledgeMemoriesPanel
            loading={memoriesLoading}
            memoriesCount={memories.length}
            memories={memoriesFiltered}
            layout={layout}
            selectedIds={selectedMemoryIds}
            selectMode={selectMode}
            hasPending={Boolean(memorySavePendingPreview || importPendingPreview)}
            onOpen={openMemory}
            onToggleSelect={toggleMemorySelect}
            onAddFirst={() => { setShowAddMemory(true); setMemorySaveError(null) }}
            onDelete={(memoryId, event) => {
              event.stopPropagation()
              void handleDeleteMemory(memoryId)
            }}
          />
        )}

        {activeTab === 'files' && !selectedFile && fileUploadPending && (
          <KnowledgePendingNotice title="Uploading…" preview={fileUploadPending.label} />
        )}
        {activeTab === 'files' && !selectedFile && fileUploadError && (
          <p className="mx-auto mb-3 max-w-3xl text-xs text-red-400" role="alert">
            {fileUploadError}
          </p>
        )}
        {activeTab === 'files' && !selectedFile && filesLoadError && (
          <p className="mx-auto mb-3 max-w-3xl text-xs text-red-400" role="alert">
            {filesLoadError}
          </p>
        )}
        {activeTab === 'files' && filesRefreshing && (
          <span className="sr-only" role="status">Refreshing files</span>
        )}

        {activeTab === 'files' && !selectedFile && (
          <KnowledgeFilesPanel
            loading={filesLoading || Boolean(pendingFilesLayout)}
            filesCount={filesFiltered.length}
            nodes={rootNodes}
            folders={folderCardsSorted}
            flatFiles={flatFilesSorted}
            allFiles={filesFiltered}
            layout={visibleFilesLayout}
            selectedFileId={hostSelectedFileId}
            selectedIds={selectedFileIds}
            selectMode={selectMode}
            onSelect={handleSelectFile}
            onFolderOpen={navigateToFolder}
            onDelete={handleDeleteNode}
            onToggleBulk={toggleFileBulkSelect}
            onMove={moveFileToParent}
          />
        )}
        </AppScreenBody>
      </AppScreenShell>
    </>
  )
}
