import { useCallback, useEffect, useMemo, useState, type RefObject } from 'react'
import {
  CheckSquare,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Folder,
  FolderOpen,
  FolderPlus,
  Square,
  SquarePen,
  Trash2,
  X,
} from 'lucide-react'
import type { NotebookNote } from '@overlay/app-core'
import type { NotebookNotesSidebarProps } from '@overlay/modules-react/notes'
import {
  PanelSidebarActionButton,
  PanelSidebarActionGrid,
  PanelSidebarSearch,
} from '../../components/panel/PanelSidebarControls'
import type { PanelTheme } from '../../hooks/usePanelTheme'
import {
  createNoteFolder,
  loadNoteFolderMap,
  loadNoteFolders,
  toggleNoteFolderExpanded,
  type Folder as NoteFolder,
} from '../../utils/folderStorage'

interface DesktopNotebookPanelSidebarProps extends NotebookNotesSidebarProps {
  theme: PanelTheme
  accessTabsInSidebar: boolean
  openTabs: readonly { id: string; title: string }[]
  onSelectTab(noteId: string): void
  onCloseTab(noteId: string): void
  searchInputRef?: RefObject<HTMLInputElement | null>
  isCollapsed?: boolean
  onClose(): void
}

function noteFolderId(note: NotebookNote, map: Record<string, string>): string | null {
  return map[note._id] ?? null
}

export function DesktopNotebookPanelSidebar({
  notes,
  activeNoteId,
  onCreateNote,
  onOpenNote,
  onDeleteNote,
  onClose,
  theme,
  accessTabsInSidebar,
  openTabs,
  onSelectTab,
  onCloseTab,
  searchInputRef,
  isCollapsed = false,
}: DesktopNotebookPanelSidebarProps): React.ReactElement<any> {
  const [query, setQuery] = useState('')
  const [folders, setFolders] = useState<NoteFolder[]>(() => loadNoteFolders())
  const [folderMap, setFolderMap] = useState<Record<string, string>>(() => loadNoteFolderMap())
  const [selectMode, setSelectMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set())

  const refreshFolders = useCallback((): void => {
    setFolders(loadNoteFolders())
    setFolderMap(loadNoteFolderMap())
  }, [])

  useEffect(() => {
    const handleStorage = (event: StorageEvent): void => {
      if (event.key === 'overlay-note-folders' || event.key === 'overlay-note-folder-map') {
        refreshFolders()
      }
    }
    window.addEventListener('storage', handleStorage)
    return () => window.removeEventListener('storage', handleStorage)
  }, [refreshFolders])

  const filteredNotes = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    if (!normalized) return notes
    return notes.filter((note) => (note.title || 'Untitled').toLowerCase().includes(normalized))
  }, [notes, query])

  const isSearching = query.trim().length > 0
  const canSelectNotes = notes.length > 0

  const exitSelectMode = (): void => {
    setSelectMode(false)
    setSelectedIds(new Set())
  }

  const toggleSelected = (noteId: string): void => {
    setSelectedIds((current) => {
      const next = new Set(current)
      if (next.has(noteId)) next.delete(noteId)
      else next.add(noteId)
      return next
    })
  }

  const openNote = (note: NotebookNote): void => {
    if (selectMode) {
      toggleSelected(note._id)
      return
    }
    onOpenNote(note)
    if (!accessTabsInSidebar) onClose()
  }

  const deleteSelected = (): void => {
    for (const noteId of selectedIds) onDeleteNote(noteId)
    exitSelectMode()
  }

  const renderNote = (note: NotebookNote, depth = 0): React.ReactElement<any> => {
    const active = note._id === activeNoteId
    const selected = selectedIds.has(note._id)
    return (
      <div
        key={note._id}
        className="group mb-0.5 flex items-center rounded-md transition-colors"
        style={{
          marginLeft: isCollapsed ? 0 : depth * 12,
          background: active || selected ? theme.sidebarItemActive : 'transparent',
        }}
        onMouseEnter={(event) => {
          if (!active && !selected) event.currentTarget.style.background = theme.sidebarItemHover
        }}
        onMouseLeave={(event) => {
          event.currentTarget.style.background = active || selected
            ? theme.sidebarItemActive
            : 'transparent'
        }}
      >
        <button
          type="button"
          onClick={() => openNote(note)}
          className="flex min-w-0 flex-1 items-center gap-2 truncate px-2.5 py-2 text-left text-[13px]"
          style={{ color: active ? theme.text : theme.textSecondary }}
          title={note.title || 'Untitled'}
        >
          {selectMode ? (
            selected
              ? <CheckSquare size={13} className="shrink-0" />
              : <Square size={13} className="shrink-0" />
          ) : null}
          <span className="truncate">
            {isCollapsed ? (note.title || 'Untitled').slice(0, 1) : note.title || 'Untitled'}
          </span>
        </button>
        {!isCollapsed && !selectMode ? (
          <button
            type="button"
            onClick={(event) => onDeleteNote(note._id, event)}
            aria-label={`Delete ${note.title || 'Untitled'}`}
            className="mr-1 flex size-6 items-center justify-center rounded opacity-0 transition-opacity hover:opacity-100 focus:opacity-100 group-hover:opacity-70"
          >
            <Trash2 size={12} color={theme.iconColorMuted} />
          </button>
        ) : null}
      </div>
    )
  }

  const renderFolder = (folder: NoteFolder, depth = 0): React.ReactElement<any> => {
    const childFolders = folders.filter((candidate) => candidate.parentId === folder.id)
    const folderNotes = filteredNotes.filter((note) => noteFolderId(note, folderMap) === folder.id)
    return (
      <div key={folder.id}>
        <button
          type="button"
          onClick={() => {
            toggleNoteFolderExpanded(folder.id)
            refreshFolders()
          }}
          className="mb-0.5 flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-[13px] transition-colors"
          style={{
            paddingLeft: isCollapsed ? 10 : 10 + depth * 12,
            color: theme.text,
          }}
          onMouseEnter={(event) => {
            event.currentTarget.style.background = theme.sidebarItemHover
          }}
          onMouseLeave={(event) => {
            event.currentTarget.style.background = 'transparent'
          }}
          title={folder.name}
        >
          {folder.isExpanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
          {folder.isExpanded ? <FolderOpen size={13} /> : <Folder size={13} />}
          {isCollapsed ? null : <span className="truncate">{folder.name}</span>}
        </button>
        {folder.isExpanded ? (
          <div>
            {childFolders.map((child) => renderFolder(child, depth + 1))}
            {folderNotes.map((note) => renderNote(note, depth + 1))}
          </div>
        ) : null}
      </div>
    )
  }

  const rootFolders = folders.filter((folder) => folder.parentId === null)
  const rootNotes = filteredNotes.filter((note) => noteFolderId(note, folderMap) === null)

  return (
    <div className="flex h-full min-h-0 w-full flex-col" aria-label="Notes sidebar">
      {isCollapsed ? null : (
        <PanelSidebarActionGrid>
          <PanelSidebarActionButton
            title="New note in current tab"
            theme={theme}
            onClick={() => {
              onCreateNote()
              onClose()
            }}
          >
            <SquarePen size={14} />
          </PanelSidebarActionButton>
          <PanelSidebarActionButton
            title="New folder"
            theme={theme}
            onClick={() => {
              createNoteFolder('New Folder')
              refreshFolders()
            }}
          >
            <FolderPlus size={14} />
          </PanelSidebarActionButton>
          <PanelSidebarActionButton
            title="Open note in new window"
            theme={theme}
            disabled={!activeNoteId}
            onClick={() => {
              if (activeNoteId) void window.bridge.openInNewWindow('notebook', activeNoteId)
            }}
          >
            <ExternalLink size={14} />
          </PanelSidebarActionButton>
          <PanelSidebarActionButton
            title={selectMode ? 'Cancel selection' : 'Select notes'}
            theme={theme}
            active={selectMode}
            disabled={!canSelectNotes}
            onClick={() => {
              if (!canSelectNotes) return
              if (selectMode) exitSelectMode()
              else setSelectMode(true)
            }}
          >
            <CheckSquare size={14} />
          </PanelSidebarActionButton>
        </PanelSidebarActionGrid>
      )}

      <PanelSidebarSearch
        inputRef={searchInputRef}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Search notes..."
        theme={theme}
        collapsed={isCollapsed}
      />

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {accessTabsInSidebar && openTabs.length > 0 && !isSearching ? (
          <div className="mb-2 border-b pb-2" style={{ borderColor: theme.border }}>
            {isCollapsed ? null : (
              <div
                className="px-2.5 pb-1.5 pt-1 text-[11px] font-medium uppercase tracking-[0.5px]"
                style={{ color: theme.textMuted }}
              >
                Open Tabs
              </div>
            )}
            {[...openTabs].reverse().map((tab) => (
              <div
                key={tab.id}
                className="group mb-0.5 flex items-center rounded-md"
                style={{ background: activeNoteId === tab.id ? theme.sidebarItemActive : 'transparent' }}
              >
                <button
                  type="button"
                  onClick={() => onSelectTab(tab.id)}
                  className="min-w-0 flex-1 truncate px-2.5 py-2 text-left text-[13px]"
                  style={{ color: theme.text }}
                  title={tab.title || 'Untitled'}
                >
                  {isCollapsed ? tab.title.slice(0, 1) || 'U' : tab.title || 'Untitled'}
                </button>
                {isCollapsed ? null : (
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation()
                      onCloseTab(tab.id)
                    }}
                    aria-label={`Close ${tab.title || 'Untitled'}`}
                    className="mr-1 flex size-6 items-center justify-center rounded opacity-0 transition-opacity focus:opacity-100 group-hover:opacity-70"
                  >
                    <X size={12} color={theme.iconColorMuted} />
                  </button>
                )}
              </div>
            ))}
          </div>
        ) : null}

        {isSearching ? filteredNotes.map((note) => renderNote(note)) : (
          <>
            {rootFolders.map((folder) => renderFolder(folder))}
            {rootNotes.map((note) => renderNote(note))}
          </>
        )}
        {filteredNotes.length === 0 ? (
          <p className="px-2.5 py-4 text-center text-xs" style={{ color: theme.textMuted }}>
            No notes found
          </p>
        ) : null}
      </div>

      {selectMode && selectedIds.size > 0 && !isCollapsed ? (
        <div className="flex items-center gap-2 border-t p-2" style={{ borderColor: theme.border }}>
          <span className="min-w-0 flex-1 px-1 text-xs" style={{ color: theme.textMuted }}>
            {selectedIds.size} selected
          </span>
          <button
            type="button"
            onClick={deleteSelected}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs"
            style={{ background: theme.surfaceBg, color: theme.text }}
          >
            <Trash2 size={13} />
            Delete
          </button>
        </div>
      ) : null}
    </div>
  )
}
