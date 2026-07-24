import { useState, useRef, useEffect, useCallback } from 'react'
import {
  X,
  Trash2,
  ExternalLink,
  SquarePen,
  FolderPlus,
  FolderOpen,
  Folder as FolderIcon,
  CheckSquare,
  Square,
  FolderInput,
  ChevronRight,
  ChevronDown
} from 'lucide-react'
import { ItemContextMenu, ContextMenuPosition } from '../ui/ItemContextMenu'
import {
  PanelSidebarActionButton,
  PanelSidebarActionGrid,
  PanelSidebarSearch,
} from '../panel/PanelSidebarControls'
import type { ChatMeta } from './types'
import { PanelTheme } from '../../hooks/usePanelTheme'
import {
  Folder as FolderType,
  loadChatFolders,
  createChatFolder,
  updateChatFolder,
  deleteChatFolder,
  loadChatFolderMap,
  moveChatToFolder,
  toggleChatFolderExpanded,
  moveChatFolderToFolder
} from '../../utils/folderStorage'

interface ChatSidebarProps {
  chats: ChatMeta[]
  currentChatId: string | null
  isClosing?: boolean
  onClose: () => void
  onLoadChat: (id: string) => void
  onDeleteChat: (id: string, e: React.MouseEvent) => void
  onOpenInNewWindow: (id: string, e: React.MouseEvent) => void
  onOpenInNewTab: (id: string) => void
  onRenameChat: (id: string, newTitle: string) => void
  openItemIds: string[]
  theme: PanelTheme
  onNewInCurrentTab: () => void
  onNewInNewTab: () => void
  onNewInNewWindow: () => void
  selectedFolderId?: string | null
  onSelectFolder?: (folderId: string | null) => void
  accessTabsInSidebar?: boolean
  openTabs?: Array<{ id: string; title: string }>
  onSelectTab?: (tabId: string) => void
  onCloseTab?: (tabId: string) => void
  isCollapsed?: boolean
}

interface FolderRowProps {
  folder: FolderType
  depth: number
  theme: PanelTheme
  isSelected: boolean
  isDragOver: boolean
  onToggle: () => void
  onSelect: () => void
  onRename: (newName: string) => void
  onDelete: () => void
  onOpenInCurrentTab: () => void
  onOpenInNewTab: () => void
  onOpenInNewWindow: () => void
  onDragOver: (e: React.DragEvent) => void
  onDrop: (e: React.DragEvent) => void
  onDragLeave: () => void
  onDragStart: (e: React.DragEvent) => void
  children?: React.ReactNode
}

function FolderRow({
  folder,
  depth,
  theme,
  isSelected,
  isDragOver,
  onToggle,
  onSelect,
  onRename,
  onDelete,
  onOpenInCurrentTab,
  onOpenInNewTab,
  onOpenInNewWindow,
  onDragOver,
  onDrop,
  onDragLeave,
  onDragStart,
  children
}: FolderRowProps): React.ReactElement {
  const [isEditing, setIsEditing] = useState(false)
  const [editValue, setEditValue] = useState(folder.name)
  const [isHovered, setIsHovered] = useState(false)
  const [contextMenu, setContextMenu] = useState<ContextMenuPosition | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const handleStartEdit = (e?: React.MouseEvent): void => {
    if (e) e.stopPropagation()
    setEditValue(folder.name)
    setIsEditing(true)
    setTimeout(() => {
      inputRef.current?.focus()
      inputRef.current?.select()
    }, 10)
  }

  const handleContextMenu = (e: React.MouseEvent): void => {
    e.preventDefault()
    e.stopPropagation()
    setContextMenu({ x: e.clientX, y: e.clientY })
  }

  const handleSaveEdit = (): void => {
    const trimmed = editValue.trim()
    if (trimmed && trimmed !== folder.name) {
      onRename(trimmed)
    }
    setIsEditing(false)
  }

  const handleClick = (): void => {
    onToggle()
    onSelect()
  }

  return (
    <>
      <div style={{ position: 'relative' }}>
        <div
          draggable={!isEditing}
          onDragStart={onDragStart}
          onClick={handleClick}
          onContextMenu={handleContextMenu}
          onMouseEnter={() => setIsHovered(true)}
          onMouseLeave={() => setIsHovered(false)}
          onDragOver={(e) => {
            e.preventDefault()
            e.stopPropagation()
            onDragOver(e)
          }}
          onDrop={(e) => {
            e.preventDefault()
            e.stopPropagation()
            onDrop(e)
          }}
          onDragLeave={onDragLeave}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '4px 8px',
            paddingLeft: 8 + depth * 12,
            borderRadius: 6,
            cursor: 'default',
            userSelect: 'none',
            background: isDragOver
              ? theme.sidebarItemActive
              : isSelected
                ? theme.sidebarItemHover
                : isHovered
                  ? theme.sidebarItemHover
                  : 'transparent',
            transition: 'background 0.1s ease',
            marginBottom: 1
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 3,
              flexShrink: 0
            }}
          >
            {folder.isExpanded ? (
              <ChevronDown size={10} color={theme.textMuted} />
            ) : (
              <ChevronRight size={10} color={theme.textMuted} />
            )}
            {folder.isExpanded ? (
              <FolderOpen size={12} color={theme.textMuted} />
            ) : (
              <FolderIcon size={12} color={theme.textMuted} />
            )}
          </div>

          {isEditing ? (
            <input
              ref={inputRef}
              type="text"
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSaveEdit()
                if (e.key === 'Escape') setIsEditing(false)
              }}
              onBlur={handleSaveEdit}
              onClick={(e) => e.stopPropagation()}
              style={{
                flex: 1,
                background: theme.surfaceBg,
                border: `1px solid ${theme.border}`,
                borderRadius: 4,
                padding: '2px 6px',
                fontSize: 12,
                color: theme.text,
                outline: 'none',
                fontFamily: 'system-ui, -apple-system, sans-serif'
              }}
            />
          ) : (
            <span
              onDoubleClick={handleStartEdit}
              style={{
                flex: 1,
                fontSize: 12,
                color: theme.text,
                fontFamily: 'system-ui, -apple-system, sans-serif',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis'
              }}
            >
              {folder.name}
            </span>
          )}

          <button
            onClick={(e) => {
              e.stopPropagation()
              onDelete()
            }}
            style={{
              background: 'transparent',
              border: 'none',
              padding: 3,
              cursor: 'default',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: 3,
              opacity: isHovered && !isEditing ? 0.6 : 0,
              visibility: isHovered && !isEditing ? 'visible' : 'hidden'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.opacity = '1'
              e.currentTarget.style.background = 'rgba(255, 100, 100, 0.2)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.opacity = '0.6'
              e.currentTarget.style.background = 'transparent'
            }}
            onMouseDown={(e) => {
              e.currentTarget.style.background = 'rgba(255, 100, 100, 0.3)'
            }}
            onMouseUp={(e) => {
              e.currentTarget.style.background = 'rgba(255, 100, 100, 0.2)'
            }}
          >
            <Trash2 size={11} color="rgba(255,100,100,0.8)" />
          </button>
        </div>

        {folder.isExpanded && children && (
          <div style={{ position: 'relative' }}>
            {/* Indentation guideline */}
            <div
              style={{
                position: 'absolute',
                left: 16 + depth * 12,
                top: 0,
                bottom: 0,
                width: 1,
                background: theme.border,
                opacity: 0.5
              }}
            />
            {children}
          </div>
        )}
      </div>

      {contextMenu && (
        <ItemContextMenu
          position={contextMenu}
          theme={theme}
          onRename={() => handleStartEdit()}
          onOpenInCurrentTab={onOpenInCurrentTab}
          onOpenInNewTab={onOpenInNewTab}
          onOpenInNewWindow={onOpenInNewWindow}
          onDelete={onDelete}
          onClose={() => setContextMenu(null)}
        />
      )}
    </>
  )
}

interface ChatRowProps {
  chat: ChatMeta
  depth: number
  theme: PanelTheme
  isSelected: boolean
  isCurrent: boolean
  isOpenInWindow: boolean
  onLoad: () => void
  onDelete: (e: React.MouseEvent) => void
  onOpenInNewWindow: (e: React.MouseEvent) => void
  onOpenInNewTab: () => void
  onRename: (newTitle: string) => void
  onDragStart: (e: React.DragEvent) => void
}

function ChatRow({
  chat,
  depth,
  theme,
  isSelected,
  isCurrent,
  isOpenInWindow,
  onLoad,
  onDelete,
  onOpenInNewWindow,
  onOpenInNewTab,
  onRename,
  onDragStart
}: ChatRowProps): React.ReactElement {
  const [isHovered, setIsHovered] = useState(false)
  const [isEditing, setIsEditing] = useState(false)
  const [editValue, setEditValue] = useState(chat.title)
  const [contextMenu, setContextMenu] = useState<ContextMenuPosition | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const handleStartEdit = (): void => {
    setEditValue(chat.title)
    setIsEditing(true)
    setTimeout(() => {
      inputRef.current?.focus()
      inputRef.current?.select()
    }, 10)
  }

  const handleSaveEdit = (): void => {
    const trimmed = editValue.trim()
    if (trimmed && trimmed !== chat.title) {
      onRename(trimmed)
    }
    setIsEditing(false)
  }

  const handleContextMenu = (e: React.MouseEvent): void => {
    e.preventDefault()
    e.stopPropagation()
    setContextMenu({ x: e.clientX, y: e.clientY })
  }

  return (
    <>
      <div
        draggable={!isEditing}
        onDragStart={onDragStart}
        onClick={() => !isEditing && onLoad()}
        onDoubleClick={(e) => {
          e.stopPropagation()
          handleStartEdit()
        }}
        onContextMenu={handleContextMenu}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '4px 8px',
          paddingLeft: 16 + depth * 12,
          borderRadius: 6,
          cursor: 'default',
          userSelect: 'none',
          background: isSelected
            ? theme.sidebarItemActive
            : isCurrent
              ? theme.sidebarItemHover
              : isHovered
                ? theme.sidebarItemHover
                : 'transparent',
          transition: 'background 0.1s ease',
          marginBottom: 1
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          {isEditing ? (
            <input
              ref={inputRef}
              type="text"
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSaveEdit()
                if (e.key === 'Escape') setIsEditing(false)
              }}
              onBlur={handleSaveEdit}
              onClick={(e) => e.stopPropagation()}
              style={{
                width: '100%',
                background: theme.surfaceBg,
                border: `1px solid ${theme.border}`,
                borderRadius: 4,
                padding: '2px 6px',
                fontSize: 13,
                color: theme.text,
                outline: 'none',
                fontFamily: 'system-ui, -apple-system, sans-serif'
              }}
            />
          ) : (
            <div
              style={{
                fontSize: 12,
                color: theme.text,
                fontFamily: 'system-ui, -apple-system, sans-serif',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis'
              }}
            >
              {chat.title}
            </div>
          )}
        </div>

        {!isOpenInWindow && (
          <div
            onClick={(e) => {
              e.stopPropagation()
              onOpenInNewWindow(e)
            }}
            style={{
              padding: 4,
              borderRadius: 4,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              opacity: isHovered && !isEditing ? 0.6 : 0,
              visibility: isHovered && !isEditing ? 'visible' : 'hidden',
              cursor: 'default'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.opacity = '1'
              e.currentTarget.style.background = theme.surfaceBgHover
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.opacity = '0.6'
              e.currentTarget.style.background = 'transparent'
            }}
            onMouseDown={(e) => {
              e.currentTarget.style.background = theme.surfaceBgHover
              e.currentTarget.style.opacity = '0.8'
            }}
            onMouseUp={(e) => {
              e.currentTarget.style.background = theme.surfaceBgHover
              e.currentTarget.style.opacity = '1'
            }}
          >
            <ExternalLink size={12} color={theme.iconColorMuted} />
          </div>
        )}
        <div
          onClick={onDelete}
          style={{
            padding: 4,
            borderRadius: 4,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            opacity: isHovered && !isEditing ? 0.6 : 0,
            visibility: isHovered && !isEditing ? 'visible' : 'hidden',
            cursor: 'default'
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.opacity = '1'
            e.currentTarget.style.background = 'rgba(255, 100, 100, 0.2)'
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.opacity = '0.6'
            e.currentTarget.style.background = 'transparent'
          }}
          onMouseDown={(e) => {
            e.currentTarget.style.background = 'rgba(255, 100, 100, 0.3)'
          }}
          onMouseUp={(e) => {
            e.currentTarget.style.background = 'rgba(255, 100, 100, 0.2)'
          }}
        >
          <Trash2 size={12} color="rgba(255,100,100,0.7)" />
        </div>
      </div>

      {contextMenu && (
        <ItemContextMenu
          position={contextMenu}
          theme={theme}
          onRename={handleStartEdit}
          onOpenInCurrentTab={onLoad}
          onOpenInNewTab={onOpenInNewTab}
          onOpenInNewWindow={() => {
            const fakeEvent = { stopPropagation: () => {} } as React.MouseEvent
            onOpenInNewWindow(fakeEvent)
          }}
          onDelete={() => {
            const fakeEvent = { stopPropagation: () => {} } as React.MouseEvent
            onDelete(fakeEvent)
          }}
          onClose={() => setContextMenu(null)}
        />
      )}
    </>
  )
}

export function ChatSidebar({
  chats,
  currentChatId,
  onClose,
  onLoadChat,
  onDeleteChat,
  onOpenInNewWindow,
  onOpenInNewTab,
  onRenameChat,
  openItemIds,
  theme,
  onNewInCurrentTab,
  onNewInNewWindow,
  selectedFolderId,
  onSelectFolder,
  accessTabsInSidebar,
  openTabs,
  onSelectTab,
  onCloseTab,
  isCollapsed
}: ChatSidebarProps): React.ReactElement {
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [folders, setFolders] = useState<FolderType[]>([])
  const [folderMap, setFolderMap] = useState<Record<string, string>>({})
  const [dragOverFolderId, setDragOverFolderId] = useState<string | null>(null)
  const [draggingChatId, setDraggingChatId] = useState<string | null>(null)
  const [draggingFolderId, setDraggingFolderId] = useState<string | null>(null)
  const [isSelectMode, setIsSelectMode] = useState(false)
  const [selectedChatIds, setSelectedChatIds] = useState<Set<string>>(new Set())
  const [showMoveMenu, setShowMoveMenu] = useState(false)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const canSelectChats = chats.length > 0

  const toggleChatSelection = useCallback((chatId: string) => {
    setSelectedChatIds((prev) => {
      const next = new Set(prev)
      if (next.has(chatId)) {
        next.delete(chatId)
      } else {
        next.add(chatId)
      }
      return next
    })
  }, [])

  const exitSelectMode = useCallback(() => {
    setIsSelectMode(false)
    setSelectedChatIds(new Set())
    setShowMoveMenu(false)
  }, [])

  const handleBatchDelete = useCallback(() => {
    for (const id of selectedChatIds) {
      const fakeEvent = { stopPropagation: () => {} } as React.MouseEvent
      onDeleteChat(id, fakeEvent)
    }
    exitSelectMode()
  }, [selectedChatIds, exitSelectMode, onDeleteChat])

  const refreshFolders = useCallback(() => {
    setFolders(loadChatFolders())
    setFolderMap(loadChatFolderMap())
  }, [])

  const handleBatchMove = useCallback(
    (folderId: string | null) => {
      for (const id of selectedChatIds) {
        moveChatToFolder(id, folderId)
      }
      exitSelectMode()
      refreshFolders()
    },
    [selectedChatIds, exitSelectMode, refreshFolders]
  )

  useEffect(() => {
    refreshFolders()
  }, [refreshFolders])

  const filteredChats = chats.filter((chat) =>
    chat.title.toLowerCase().includes(searchQuery.toLowerCase())
  )

  useEffect(() => {
    setSelectedIndex(0)
  }, [searchQuery])

  const handleSearchKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSelectedIndex((prev) => (prev < filteredChats.length - 1 ? prev + 1 : 0))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSelectedIndex((prev) => (prev > 0 ? prev - 1 : filteredChats.length - 1))
      } else if (e.key === 'Enter') {
        e.preventDefault()
        if (filteredChats[selectedIndex]) {
          onLoadChat(filteredChats[selectedIndex].id)
          setSearchQuery('')
        }
      } else if (e.key === 'Escape') {
        if (searchQuery) {
          setSearchQuery('')
        } else {
          onClose()
        }
      }
    },
    [filteredChats, selectedIndex, onLoadChat, onClose, searchQuery]
  )

  const handleCreateFolder = (): void => {
    createChatFolder('New Folder', selectedFolderId)
    refreshFolders()
  }

  const handleToggleFolder = (folderId: string): void => {
    toggleChatFolderExpanded(folderId)
    refreshFolders()
  }

  const handleRenameFolder = (folderId: string, newName: string): void => {
    updateChatFolder(folderId, { name: newName })
    refreshFolders()
  }

  const handleDeleteFolder = (folderId: string): void => {
    deleteChatFolder(folderId)
    refreshFolders()
    if (selectedFolderId === folderId) {
      onSelectFolder?.(null)
    }
  }

  const handleDragStart = (e: React.DragEvent, chatId: string): void => {
    setDraggingChatId(chatId)
    setDraggingFolderId(null)
    e.dataTransfer.setData('text/plain', chatId)
    e.dataTransfer.setData('dragType', 'chat')
    e.dataTransfer.effectAllowed = 'move'
  }

  const handleFolderDragStart = (e: React.DragEvent, folderId: string): void => {
    setDraggingFolderId(folderId)
    setDraggingChatId(null)
    e.dataTransfer.setData('text/plain', folderId)
    e.dataTransfer.setData('dragType', 'folder')
    e.dataTransfer.effectAllowed = 'move'
  }

  const handleDragOver = (_e: React.DragEvent, folderId: string): void => {
    // Don't allow dropping a folder onto itself
    if (draggingFolderId !== folderId) {
      setDragOverFolderId(folderId)
    }
  }

  const handleDrop = (_e: React.DragEvent, folderId: string): void => {
    if (draggingChatId) {
      moveChatToFolder(draggingChatId, folderId)
      refreshFolders()
    } else if (draggingFolderId && draggingFolderId !== folderId) {
      moveChatFolderToFolder(draggingFolderId, folderId)
      refreshFolders()
    }
    setDragOverFolderId(null)
    setDraggingChatId(null)
    setDraggingFolderId(null)
  }

  const handleDragLeave = (): void => {
    setDragOverFolderId(null)
  }

  const handleRootDrop = (e: React.DragEvent): void => {
    e.preventDefault()
    if (draggingChatId) {
      moveChatToFolder(draggingChatId, null)
      refreshFolders()
    } else if (draggingFolderId) {
      moveChatFolderToFolder(draggingFolderId, null)
      refreshFolders()
    }
    setDraggingChatId(null)
    setDraggingFolderId(null)
  }

  const renderFolder = (folder: FolderType, depth: number): React.ReactNode => {
    const childFolders = folders.filter((f) => f.parentId === folder.id)
    const folderChats = filteredChats.filter((c) => folderMap[c.id] === folder.id)

    return (
      <FolderRow
        key={folder.id}
        folder={folder}
        depth={depth}
        theme={theme}
        isSelected={selectedFolderId === folder.id}
        isDragOver={dragOverFolderId === folder.id}
        onToggle={() => handleToggleFolder(folder.id)}
        onSelect={() => onSelectFolder?.(folder.id)}
        onRename={(name) => handleRenameFolder(folder.id, name)}
        onDelete={() => handleDeleteFolder(folder.id)}
        onOpenInCurrentTab={() => {
          handleToggleFolder(folder.id)
          onSelectFolder?.(folder.id)
        }}
        onOpenInNewTab={() => onSelectFolder?.(folder.id)}
        onOpenInNewWindow={() => onSelectFolder?.(folder.id)}
        onDragOver={(e) => handleDragOver(e, folder.id)}
        onDrop={(e) => handleDrop(e, folder.id)}
        onDragLeave={handleDragLeave}
        onDragStart={(e) => handleFolderDragStart(e, folder.id)}
      >
        {childFolders.map((child) => renderFolder(child, depth + 1))}
        {folderChats.map((chat, idx) => (
          <ChatRow
            key={chat.id}
            chat={chat}
            depth={depth + 1}
            theme={theme}
            isSelected={idx === selectedIndex && searchQuery !== ''}
            isCurrent={currentChatId === chat.id}
            isOpenInWindow={openItemIds.includes(chat.id)}
            onLoad={() => {
              onLoadChat(chat.id)
              setSearchQuery('')
            }}
            onDelete={(e) => onDeleteChat(chat.id, e)}
            onOpenInNewWindow={(e) => onOpenInNewWindow(chat.id, e)}
            onOpenInNewTab={() => onOpenInNewTab(chat.id)}
            onRename={(newTitle) => onRenameChat(chat.id, newTitle)}
            onDragStart={(e) => handleDragStart(e, chat.id)}
          />
        ))}
      </FolderRow>
    )
  }

  const rootFolders = folders.filter((f) => f.parentId === null)
  const rootChats = filteredChats.filter((c) => !folderMap[c.id])

  // Helper to get folder path for a chat (for search results)
  const getFolderPath = (chatId: string): string | null => {
    const folderId = folderMap[chatId]
    if (!folderId) return null
    const pathParts: string[] = []
    let currentId: string | null = folderId
    while (currentId) {
      const folder = folders.find((f) => f.id === currentId)
      if (folder) {
        pathParts.unshift(folder.name)
        currentId = folder.parentId
      } else {
        break
      }
    }
    return pathParts.length > 0 ? pathParts.join(' / ') : null
  }

  // When searching, show all matching chats in a flat list with folder path
  const isSearching = searchQuery.trim() !== ''

  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        background: 'transparent',
        display: 'flex',
        flexDirection: 'column'
      }}
    >
      {!isCollapsed && (
        <PanelSidebarActionGrid>
            <PanelSidebarActionButton
              onClick={() => {
                onNewInCurrentTab()
                onClose()
              }}
              title="New chat in current tab"
              theme={theme}
            >
              <SquarePen size={14} color={theme.iconColorMuted} />
            </PanelSidebarActionButton>
            <PanelSidebarActionButton
              onClick={handleCreateFolder}
              title="New folder"
              theme={theme}
            >
              <FolderPlus size={14} color={theme.iconColorMuted} />
            </PanelSidebarActionButton>
            <PanelSidebarActionButton
              onClick={() => {
                onNewInNewWindow()
                onClose()
              }}
              title="New chat in new window"
              theme={theme}
            >
              <ExternalLink size={14} color={theme.iconColorMuted} />
            </PanelSidebarActionButton>
            <PanelSidebarActionButton
              onClick={() => {
                if (!canSelectChats) return
                if (isSelectMode) {
                  exitSelectMode()
                } else {
                  setIsSelectMode(true)
                }
              }}
              disabled={!canSelectChats}
              title={isSelectMode ? 'Cancel selection' : 'Select chats'}
              theme={theme}
              active={isSelectMode}
            >
              <CheckSquare size={14} color={isSelectMode ? theme.text : theme.iconColorMuted} />
            </PanelSidebarActionButton>
        </PanelSidebarActionGrid>
      )}

      {/* Search Bar */}
      <PanelSidebarSearch
        inputRef={searchInputRef}
        value={searchQuery}
        onChange={(event) => setSearchQuery(event.target.value)}
        onKeyDown={handleSearchKeyDown}
        placeholder="Search chats..."
        theme={theme}
        collapsed={isCollapsed}
      />

      {/* Content */}
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '8px'
        }}
        onDragOver={(e) => {
          e.preventDefault()
          setDragOverFolderId(null)
        }}
        onDrop={handleRootDrop}
      >
        {/* Open Chats section - shown when accessTabsInSidebar is enabled AND not searching */}
        {accessTabsInSidebar && openTabs && openTabs.length > 0 && !isSearching && (
          <div
            style={{ paddingBottom: 8, marginBottom: 8, borderBottom: `1px solid ${theme.border}` }}
          >
            <div
              style={{
                fontSize: 11,
                fontWeight: 500,
                color: theme.textMuted,
                fontFamily: 'system-ui, -apple-system, sans-serif',
                textTransform: 'uppercase',
                letterSpacing: '0.5px',
                padding: '4px 10px 6px 10px'
              }}
            >
              Open Tabs
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {[...openTabs].reverse().map((tab) => (
                <div
                  key={tab.id}
                  className="open-tab-row"
                  onClick={() => onSelectTab?.(tab.id)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '8px 10px',
                    borderRadius: 6,
                    background: currentChatId === tab.id ? theme.sidebarItemActive : 'transparent',
                    cursor: 'pointer',
                    width: '100%',
                    textAlign: 'left',
                    transition: 'background 0.1s ease'
                  }}
                  onMouseEnter={(e) => {
                    if (currentChatId !== tab.id) {
                      e.currentTarget.style.background = theme.sidebarItemHover
                    }
                    const closeBtn = e.currentTarget.querySelector('.close-tab-btn') as HTMLElement
                    if (closeBtn) closeBtn.style.opacity = '0.6'
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background =
                      currentChatId === tab.id ? theme.sidebarItemActive : 'transparent'
                    const closeBtn = e.currentTarget.querySelector('.close-tab-btn') as HTMLElement
                    if (closeBtn) closeBtn.style.opacity = '0'
                  }}
                >
                  <span
                    style={{
                      flex: 1,
                      fontSize: 13,
                      color: theme.text,
                      fontFamily: 'system-ui, -apple-system, sans-serif',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis'
                    }}
                  >
                    {tab.title || 'New Chat'}
                  </span>
                  <button
                    className="close-tab-btn"
                    onClick={(e) => {
                      e.stopPropagation()
                      onCloseTab?.(tab.id)
                    }}
                    style={{
                      width: 20,
                      height: 20,
                      borderRadius: 4,
                      border: 'none',
                      background: 'transparent',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      cursor: 'pointer',
                      flexShrink: 0,
                      opacity: 0,
                      transition: 'opacity 0.1s ease, background 0.1s ease'
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.opacity = '1'
                      e.currentTarget.style.background = theme.surfaceBgActive
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.opacity = '0.6'
                      e.currentTarget.style.background = 'transparent'
                    }}
                    title="Close tab"
                  >
                    <X size={12} color={theme.iconColorMuted} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {filteredChats.length === 0 && folders.length === 0 ? (
          <div
            style={{
              padding: '20px 12px',
              textAlign: 'center',
              color: theme.textMuted,
              fontSize: 13,
              fontFamily: 'system-ui, -apple-system, sans-serif'
            }}
          >
            {searchQuery ? 'No matching chats' : 'No chat history yet'}
          </div>
        ) : isSearching ? (
          /* When searching, show flat list of all matching chats with folder path */
          <>
            {filteredChats.map((chat, idx) => {
              const folderPath = getFolderPath(chat.id)
              return (
                <div key={chat.id}>
                  <ChatRow
                    chat={chat}
                    depth={0}
                    theme={theme}
                    isSelected={idx === selectedIndex}
                    isCurrent={currentChatId === chat.id}
                    isOpenInWindow={openItemIds.includes(chat.id)}
                    onLoad={() => {
                      onLoadChat(chat.id)
                      setSearchQuery('')
                    }}
                    onDelete={(e) => onDeleteChat(chat.id, e)}
                    onOpenInNewWindow={(e) => onOpenInNewWindow(chat.id, e)}
                    onOpenInNewTab={() => onOpenInNewTab(chat.id)}
                    onRename={(newTitle) => onRenameChat(chat.id, newTitle)}
                    onDragStart={(e) => handleDragStart(e, chat.id)}
                  />
                  {folderPath && (
                    <div
                      style={{
                        fontSize: 11,
                        color: theme.textMuted,
                        fontFamily: 'system-ui, -apple-system, sans-serif',
                        paddingLeft: 32,
                        marginTop: -4,
                        marginBottom: 4,
                        opacity: 0.7
                      }}
                    >
                      in {folderPath}
                    </div>
                  )}
                </div>
              )
            })}
          </>
        ) : (
          <>
            {/* Previous Chats header - shown when accessTabsInSidebar is enabled and there are open tabs */}
            {accessTabsInSidebar &&
              openTabs &&
              openTabs.length > 0 &&
              (filteredChats.length > 0 || folders.length > 0) && (
                <div
                  style={{
                    fontSize: 11,
                    fontWeight: 500,
                    color: theme.textMuted,
                    fontFamily: 'system-ui, -apple-system, sans-serif',
                    textTransform: 'uppercase',
                    letterSpacing: '0.5px',
                    padding: '4px 10px 6px 10px'
                  }}
                >
                  Previous Chats
                </div>
              )}
            {rootFolders.map((folder) => renderFolder(folder, 0))}
            {rootChats.map((chat, idx) =>
              isSelectMode ? (
                <div
                  key={chat.id}
                  onClick={() => toggleChatSelection(chat.id)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '8px 10px',
                    paddingLeft: 20,
                    borderRadius: 6,
                    cursor: 'default',
                    userSelect: 'none',
                    background: selectedChatIds.has(chat.id)
                      ? theme.sidebarItemActive
                      : 'transparent',
                    marginBottom: 2
                  }}
                  onMouseEnter={(e) => {
                    if (!selectedChatIds.has(chat.id))
                      e.currentTarget.style.background = theme.sidebarItemHover
                  }}
                  onMouseLeave={(e) => {
                    if (!selectedChatIds.has(chat.id))
                      e.currentTarget.style.background = 'transparent'
                  }}
                >
                  <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center' }}>
                    {selectedChatIds.has(chat.id) ? (
                      <CheckSquare size={14} color={theme.text} />
                    ) : (
                      <Square size={14} color={theme.textMuted} />
                    )}
                  </div>
                  <span
                    style={{
                      flex: 1,
                      fontSize: 13,
                      color: theme.text,
                      fontFamily: 'system-ui, -apple-system, sans-serif',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis'
                    }}
                  >
                    {chat.title}
                  </span>
                </div>
              ) : (
                <ChatRow
                  key={chat.id}
                  chat={chat}
                  depth={0}
                  theme={theme}
                  isSelected={idx === selectedIndex && searchQuery !== ''}
                  isCurrent={currentChatId === chat.id}
                  isOpenInWindow={openItemIds.includes(chat.id)}
                  onLoad={() => {
                    onLoadChat(chat.id)
                    setSearchQuery('')
                  }}
                  onDelete={(e) => onDeleteChat(chat.id, e)}
                  onOpenInNewWindow={(e) => onOpenInNewWindow(chat.id, e)}
                  onOpenInNewTab={() => onOpenInNewTab(chat.id)}
                  onRename={(newTitle) => onRenameChat(chat.id, newTitle)}
                  onDragStart={(e) => handleDragStart(e, chat.id)}
                />
              )
            )}
          </>
        )}
      </div>

      {/* Selection action bar */}
      {isSelectMode && selectedChatIds.size > 0 && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '4px 8px',
            borderTop: `1px solid ${theme.border}`,
            flexShrink: 0,
            position: 'relative'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <button
              onClick={() => {
                if (selectedChatIds.size === chats.length) {
                  setSelectedChatIds(new Set())
                } else {
                  setSelectedChatIds(new Set(chats.map((c) => c.id)))
                }
              }}
              title={selectedChatIds.size === chats.length ? 'Deselect all' : 'Select all'}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: 'transparent',
                border: 'none',
                padding: 1,
                cursor: 'default',
                borderRadius: 3
              }}
            >
              {selectedChatIds.size === chats.length ? (
                <CheckSquare size={12} color={theme.text} />
              ) : (
                <Square size={12} color={theme.textMuted} />
              )}
            </button>
            <span
              style={{
                fontSize: 11,
                color: theme.textMuted,
                fontFamily: 'system-ui, -apple-system, sans-serif',
                whiteSpace: 'nowrap'
              }}
            >
              {selectedChatIds.size} sel.
            </span>
          </div>
          <div style={{ display: 'flex', gap: 2 }}>
            <button
              onClick={() => setShowMoveMenu((v) => !v)}
              title="Move to folder"
              style={{
                height: 26,
                padding: '0 8px',
                borderRadius: 5,
                border: `1px solid ${theme.border}`,
                background: theme.surfaceBg,
                color: theme.text,
                fontSize: 11,
                cursor: 'default',
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                fontFamily: 'system-ui, -apple-system, sans-serif'
              }}
            >
              <FolderInput size={11} /> Move
            </button>
            <button
              onClick={handleBatchDelete}
              title="Delete selected"
              style={{
                height: 26,
                padding: '0 8px',
                borderRadius: 5,
                border: '1px solid rgba(255,100,100,0.3)',
                background: 'transparent',
                color: 'rgba(255,100,100,0.9)',
                fontSize: 11,
                cursor: 'default',
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                fontFamily: 'system-ui, -apple-system, sans-serif'
              }}
            >
              <Trash2 size={11} />
            </button>
            <button
              onClick={exitSelectMode}
              title="Cancel"
              style={{
                height: 26,
                padding: '0 8px',
                borderRadius: 5,
                border: `1px solid ${theme.border}`,
                background: 'transparent',
                color: theme.textMuted,
                fontSize: 11,
                cursor: 'default',
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                fontFamily: 'system-ui, -apple-system, sans-serif'
              }}
            >
              <X size={11} />
            </button>
          </div>
          {showMoveMenu && (
            <div
              style={{
                position: 'absolute',
                bottom: '100%',
                right: 8,
                background: theme.surfaceBg,
                border: `1px solid ${theme.border}`,
                borderRadius: 6,
                padding: 4,
                zIndex: 100,
                minWidth: 140,
                boxShadow: '0 2px 8px rgba(0,0,0,0.2)'
              }}
            >
              <button
                onClick={() => handleBatchMove(null)}
                style={{
                  display: 'block',
                  width: '100%',
                  padding: '6px 10px',
                  background: 'transparent',
                  border: 'none',
                  color: theme.textMuted,
                  fontSize: 11,
                  cursor: 'default',
                  borderRadius: 4,
                  textAlign: 'left',
                  fontFamily: 'system-ui, -apple-system, sans-serif',
                  fontStyle: 'italic'
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = theme.surfaceBgHover
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'transparent'
                }}
              >
                No folder (root)
              </button>
              {folders.map((f) => (
                <button
                  key={f.id}
                  onClick={() => handleBatchMove(f.id)}
                  style={{
                    display: 'block',
                    width: '100%',
                    padding: '6px 10px',
                    background: 'transparent',
                    border: 'none',
                    color: theme.text,
                    fontSize: 11,
                    cursor: 'default',
                    borderRadius: 4,
                    textAlign: 'left',
                    fontFamily: 'system-ui, -apple-system, sans-serif'
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = theme.surfaceBgHover
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'transparent'
                  }}
                >
                  {f.name}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

    </div>
  )
}
