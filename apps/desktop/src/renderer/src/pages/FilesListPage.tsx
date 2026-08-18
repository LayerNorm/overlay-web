import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  ReactElement,
  MouseEvent,
  ComponentType,
  CSSProperties
} from 'react'
import {
  BookOpen,
  File,
  Image as ImageIcon,
  FileSpreadsheet,
  FileText,
  Folder,
  Trash2,
  Video,
  X
} from 'lucide-react'
import { desktopAppJson } from '../services/app-api-client'
import {
  fetchDesktopFileList,
  getCachedDesktopFileList,
  localNoteToItem,
  setCachedDesktopFileList,
  type FileListItem
} from '../services/files-list-cache'
import type { Theme } from '../utils/theme'
import { SidebarListItem, SidebarItemAction } from '../components/ui/SidebarListItem'
import {
  FILES_RECONCILE_EVENT,
  reconcileLocalNoteItems,
  resolveFileListLoadMode
} from './fileListRefresh'
import {
  DESKTOP_KNOWLEDGE_AUTHORITY_EVENT,
  getDesktopKnowledgeAuthority,
  type DesktopKnowledgeAuthority
} from '../services/desktop-knowledge-migration'

interface FilesListPageProps {
  theme: Theme
  onSelectNote?: (id: string) => void
  onSelectOutput?: (id: string) => void
  onSelectFile?: (id: string) => void
  onSelectLocalDocument?: (id: string) => void
  selectedNoteId?: string | null
  selectedOutputId?: string | null
  selectedFileId?: string | null
  selectedLocalDocumentId?: string | null
  isSearchOpen: boolean
  searchQuery: string
  onSearchQueryChange: (value: string) => void
  isSelectMode: boolean
  onSelectModeChange: (value: boolean) => void
}

function getDateLabel(timestamp: number): string {
  const date = new Date(timestamp)
  const today = new Date()
  const yesterday = new Date(today)
  yesterday.setDate(yesterday.getDate() - 1)

  if (date.toDateString() === today.toDateString()) return 'Today'
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday'
  return date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
}

function getFileIcon(
  item: FileListItem
): ComponentType<{ size?: number; color?: string; style?: CSSProperties }> {
  if (item.type === 'folder') return Folder
  if (item.type === 'note') return BookOpen

  const mimeType = item.mimeType ?? ''
  if (item.kind === 'output' && mimeType.startsWith('image/')) return ImageIcon
  if (item.kind === 'output' && mimeType.startsWith('video/')) return Video
  const extension = item.extension ?? item.name.split('.').pop()?.toLowerCase() ?? ''
  if (
    mimeType.includes('spreadsheet') ||
    mimeType.includes('excel') ||
    mimeType.includes('csv') ||
    ['csv', 'xls', 'xlsx'].includes(extension)
  ) {
    return FileSpreadsheet
  }
  if (
    mimeType.includes('text') ||
    mimeType.includes('pdf') ||
    mimeType.includes('document') ||
    ['txt', 'md', 'markdown', 'pdf', 'doc', 'docx'].includes(extension)
  ) {
    return FileText
  }
  return File
}

export function FilesListPage({
  theme,
  onSelectNote,
  onSelectOutput,
  onSelectFile,
  onSelectLocalDocument,
  selectedNoteId,
  selectedOutputId,
  selectedFileId,
  selectedLocalDocumentId,
  isSearchOpen,
  searchQuery,
  onSearchQueryChange,
  isSelectMode,
  onSelectModeChange
}: FilesListPageProps): ReactElement<any> {
  const [authority, setAuthority] = useState<DesktopKnowledgeAuthority>(
    getDesktopKnowledgeAuthority
  )
  const repositoryAuthority = authority === 'cloud' ? 'cloud' : 'on-this-mac'
  const initialFiles = getCachedDesktopFileList(repositoryAuthority)
  const [files, setFiles] = useState<FileListItem[]>(() => initialFiles ?? [])
  const [selectedFileIds, setSelectedFileIds] = useState<Set<string>>(new Set())
  const [isLoading, setIsLoading] = useState(initialFiles === null)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const hasLoadedOnceRef = useRef(initialFiles !== null)
  const loadRequestIdRef = useRef(0)
  const localNotesRequestIdRef = useRef(0)

  const loadFiles = useCallback(async (): Promise<void> => {
    const requestId = ++loadRequestIdRef.current
    const loadMode = resolveFileListLoadMode(hasLoadedOnceRef.current)
    if (loadMode === 'initial') setIsLoading(true)
    else setIsRefreshing(true)
    try {
      const nextFiles = await fetchDesktopFileList({ force: true, authority: repositoryAuthority })
      if (requestId !== loadRequestIdRef.current) return
      setFiles(nextFiles)
      setLoadError(null)
      hasLoadedOnceRef.current = true
    } catch (error) {
      if (requestId !== loadRequestIdRef.current) return
      setLoadError(error instanceof Error ? error.message : String(error))
      if (loadMode === 'initial') setFiles([])
    } finally {
      if (requestId === loadRequestIdRef.current) {
        setIsLoading(false)
        setIsRefreshing(false)
      }
    }
  }, [repositoryAuthority])

  const refreshLocalNotes = useCallback(async (): Promise<void> => {
    const requestId = ++localNotesRequestIdRef.current
    try {
      const localNotes = await window.bridge.loadNotes()
      if (requestId !== localNotesRequestIdRef.current) return
      setFiles((currentFiles) => {
        const nextFiles = reconcileLocalNoteItems(currentFiles, localNotes, localNoteToItem)
        setCachedDesktopFileList(nextFiles, repositoryAuthority)
        return nextFiles
      })
    } catch (error) {
      console.warn('[FilesListPage] Failed to refresh local notes:', error)
    }
  }, [repositoryAuthority])

  useEffect(() => {
    void loadFiles()
  }, [loadFiles])

  useEffect(() => {
    const handleAuthorityChange = (event: Event): void => {
      setAuthority((event as CustomEvent<DesktopKnowledgeAuthority>).detail)
    }
    window.addEventListener(DESKTOP_KNOWLEDGE_AUTHORITY_EVENT, handleAuthorityChange)
    return () =>
      window.removeEventListener(DESKTOP_KNOWLEDGE_AUTHORITY_EVENT, handleAuthorityChange)
  }, [])

  useEffect(() => {
    const handler = (): void => {
      void loadFiles()
    }
    window.addEventListener(FILES_RECONCILE_EVENT, handler)
    const cleanup = window.bridge.onNotesChanged(() => {
      if (authority === 'on-this-mac') void refreshLocalNotes()
    })
    return () => {
      window.removeEventListener(FILES_RECONCILE_EVENT, handler)
      cleanup()
    }
  }, [authority, loadFiles, refreshLocalNotes])

  useEffect(() => {
    if (!isSelectMode) setSelectedFileIds(new Set())
  }, [isSelectMode])

  const filteredFiles = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return files
    return files.filter(
      (file) =>
        file.name.toLowerCase().includes(q) || (file.pathLabel ?? '').toLowerCase().includes(q)
    )
  }, [files, searchQuery])

  const groups = useMemo(() => {
    const sorted = [...filteredFiles].sort((a, b) => b.updatedAt - a.updatedAt)
    const byLabel: Record<string, FileListItem[]> = {}
    for (const file of sorted) {
      const label = getDateLabel(file.updatedAt)
      ;(byLabel[label] ||= []).push(file)
    }
    return byLabel
  }, [filteredFiles])

  const groupLabels = useMemo(() => Object.keys(groups), [groups])

  const toggleSelected = useCallback((id: string): void => {
    setSelectedFileIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const deleteFile = useCallback(async (file: FileListItem): Promise<void> => {
    if (file.source === 'local-note') {
      await window.bridge.deleteNote(file.id)
    } else if (file.source === 'local-document') {
      await window.bridge.document.remove(file.id)
    } else {
      await desktopAppJson(`/api/v1/files?fileId=${encodeURIComponent(file.remoteId ?? file.id)}`, {
        method: 'DELETE'
      })
    }
  }, [])

  const handleDeleteFile = useCallback(
    async (id: string, e: MouseEvent): Promise<void> => {
      e.stopPropagation()
      const file = files.find((item) => item.id === id)
      if (!file) return
      await deleteFile(file)
      setFiles((prev) => {
        const nextFiles = prev.filter((item) => item.id !== id)
        setCachedDesktopFileList(nextFiles, repositoryAuthority)
        return nextFiles
      })
      setSelectedFileIds((prev) => {
        const next = new Set(prev)
        next.delete(id)
        return next
      })
      window.dispatchEvent(
        new CustomEvent(FILES_RECONCILE_EVENT, { detail: { reason: 'explicit-refresh' } })
      )
    },
    [deleteFile, files, repositoryAuthority]
  )

  const exitSelectMode = useCallback(() => {
    onSelectModeChange(false)
    setSelectedFileIds(new Set())
  }, [onSelectModeChange])

  const handleBatchDelete = useCallback(async () => {
    const selectedFiles = files.filter((file) => selectedFileIds.has(file.id))
    for (const file of selectedFiles) {
      await deleteFile(file)
    }
    setFiles((prev) => {
      const nextFiles = prev.filter((file) => !selectedFileIds.has(file.id))
      setCachedDesktopFileList(nextFiles, repositoryAuthority)
      return nextFiles
    })
    exitSelectMode()
    window.dispatchEvent(
      new CustomEvent(FILES_RECONCILE_EVENT, { detail: { reason: 'explicit-refresh' } })
    )
  }, [deleteFile, exitSelectMode, files, repositoryAuthority, selectedFileIds])

  const handleOpenFile = useCallback(
    (file: FileListItem): void => {
      if (isSelectMode) {
        toggleSelected(file.id)
        return
      }
      if (file.type === 'note') {
        onSelectNote?.(file.id)
      } else if (file.kind === 'output') {
        onSelectOutput?.(file.remoteId ?? file.id)
      } else if (file.source === 'local-document') {
        onSelectLocalDocument?.(file.id)
      } else if (file.type === 'file') {
        onSelectFile?.(file.remoteId ?? file.id)
      }
    },
    [
      isSelectMode,
      onSelectFile,
      onSelectLocalDocument,
      onSelectNote,
      onSelectOutput,
      toggleSelected
    ]
  )

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden'
      }}
    >
      {isSearchOpen && (
        <div style={{ padding: '6px 8px', flexShrink: 0 }}>
          <input
            autoFocus
            value={searchQuery}
            onChange={(e) => onSearchQueryChange(e.target.value)}
            placeholder="Search files..."
            style={{
              width: '100%',
              padding: '5px 10px',
              background: 'transparent',
              border: `1px solid ${theme.border}`,
              borderRadius: '6px',
              color: theme.text,
              fontSize: '12px',
              outline: 'none',
              fontFamily: 'system-ui, -apple-system, sans-serif',
              boxSizing: 'border-box'
            }}
          />
        </div>
      )}

      {isSelectMode && selectedFileIds.size > 0 && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '4px 8px',
            flexShrink: 0
          }}
        >
          <span style={{ fontSize: '11px', color: theme.textSecondary }}>
            {selectedFileIds.size} selected
          </span>
          <div style={{ display: 'flex', gap: '4px' }}>
            <button
              onClick={handleBatchDelete}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '3px',
                padding: '3px 8px',
                background: 'transparent',
                border: '1px solid rgba(239,68,68,0.35)',
                borderRadius: '5px',
                color: 'rgb(239,68,68)',
                fontSize: '11px',
                cursor: 'pointer',
                fontFamily: 'system-ui, -apple-system, sans-serif'
              }}
            >
              <Trash2 size={11} /> Delete
            </button>
            <button
              onClick={exitSelectMode}
              style={{
                display: 'flex',
                alignItems: 'center',
                padding: '3px 6px',
                background: 'transparent',
                border: `1px solid ${theme.border}`,
                borderRadius: '5px',
                color: theme.textSecondary,
                fontSize: '11px',
                cursor: 'pointer',
                fontFamily: 'system-ui, -apple-system, sans-serif'
              }}
            >
              <X size={11} />
            </button>
          </div>
        </div>
      )}

      <div
        aria-busy={isLoading || isRefreshing}
        data-refreshing={isRefreshing ? 'true' : undefined}
        style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', padding: '0 8px 4px' }}
      >
        {isLoading ? (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              height: '100%',
              gap: '10px',
              color: theme.textSecondary
            }}
          >
            <FileText size={28} strokeWidth={1} style={{ opacity: 0.35 }} />
            <span style={{ fontSize: '12px', opacity: 0.7 }}>Loading files...</span>
          </div>
        ) : loadError && files.length === 0 ? (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              height: '100%',
              gap: '10px',
              color: theme.textSecondary,
              textAlign: 'center',
              padding: '0 24px'
            }}
          >
            <FileText size={28} strokeWidth={1} style={{ opacity: 0.35 }} />
            <span style={{ fontSize: '12px', opacity: 0.85 }}>Could not load files</span>
            <span
              style={{
                fontSize: '10px',
                lineHeight: '14px',
                opacity: 0.55,
                maxWidth: '240px',
                wordBreak: 'break-word'
              }}
            >
              {loadError}
            </span>
            <button
              onClick={() => void loadFiles()}
              style={{
                padding: '5px 10px',
                borderRadius: '6px',
                border: `1px solid ${theme.border}`,
                background: 'transparent',
                color: theme.text,
                fontSize: '11px',
                cursor: 'pointer',
                fontFamily: 'system-ui, -apple-system, sans-serif'
              }}
            >
              Retry
            </button>
          </div>
        ) : filteredFiles.length === 0 ? (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              height: '100%',
              gap: '10px',
              color: theme.textSecondary
            }}
          >
            <FileText size={28} strokeWidth={1} style={{ opacity: 0.35 }} />
            <span style={{ fontSize: '12px', opacity: 0.7 }}>
              {searchQuery ? 'No results' : 'No files yet'}
            </span>
          </div>
        ) : (
          groupLabels.map((dateLabel, groupIdx) => {
            const items = groups[dateLabel]
            if (!items || items.length === 0) return null
            return (
              <div key={dateLabel}>
                {groupIdx > 0 && (
                  <div
                    style={{
                      height: '1px',
                      background: theme.border,
                      margin: '4px 2px',
                      opacity: 0.5
                    }}
                  />
                )}
                <div
                  style={{
                    fontSize: '10px',
                    color: theme.textSecondary,
                    padding: '4px 10px 2px',
                    opacity: 0.5,
                    letterSpacing: '0.3px'
                  }}
                >
                  {dateLabel}
                </div>
                {items.map((file) => {
                  const isBatchSelected = selectedFileIds.has(file.id)
                  const isActive =
                    selectedNoteId === file.id ||
                    selectedOutputId === (file.remoteId ?? file.id) ||
                    selectedFileId === (file.remoteId ?? file.id) ||
                    selectedLocalDocumentId === file.id
                  const Icon = getFileIcon(file)
                  const iconColor =
                    file.type === 'folder'
                      ? '#fbbf24'
                      : file.kind === 'output'
                        ? theme.text
                        : theme.textSecondary

                  return (
                    <SidebarListItem
                      key={file.id}
                      icon={Icon}
                      iconColor={iconColor}
                      label={file.name}
                      isActive={isActive}
                      isSelectMode={isSelectMode}
                      isBatchSelected={isBatchSelected}
                      onBatchToggle={() => toggleSelected(file.id)}
                      onClick={() => handleOpenFile(file)}
                      theme={theme}
                      actions={
                        <SidebarItemAction
                          onClick={(e) => void handleDeleteFile(file.id, e)}
                          title="Delete file"
                          icon={Trash2}
                          color={theme.textSecondary}
                        />
                      }
                    />
                  )
                })}
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
