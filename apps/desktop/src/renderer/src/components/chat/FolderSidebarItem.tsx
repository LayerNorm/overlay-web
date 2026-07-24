import { useState } from 'react'
import { ChevronDown, ChevronRight, Folder as FolderIcon, FileText, Plus } from 'lucide-react'
import { ChatSidebarItem } from './ChatSidebarItem'
import type { ChatMeta } from './types'
import type { Folder } from '../../utils/folderStorage'

interface FolderSidebarItemProps {
  folder: Folder
  chats: ChatMeta[]
  activeId: string | null
  allFolders: Array<{ id: string; name: string }>
  onFolderClick: () => void
  onChatSelect: (id: string) => void
  onNewChatInFolder: () => void
  onDeleteChat: (id: string) => void
  onOpenChatInNewWindow?: (id: string) => void
  onMoveChatToFolder?: (chatId: string, folderId: string | null) => void
}

export function FolderSidebarItem({
  folder,
  chats,
  activeId,
  allFolders,
  onFolderClick,
  onChatSelect,
  onNewChatInFolder,
  onDeleteChat,
  onOpenChatInNewWindow,
  onMoveChatToFolder
}: FolderSidebarItemProps): React.ReactElement {
  const [isExpanded, setIsExpanded] = useState(folder.isExpanded)

  const folderChats = chats.filter((c) => c.id) // All chats passed are already filtered

  return (
    <div style={{ fontFamily: 'system-ui, -apple-system, sans-serif' }}>
      {/* Folder header */}
      <div
        className="group flex items-center gap-1 px-2 py-1.5 rounded-lg"
        style={{ backgroundColor: 'transparent' }}
        onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.05)')}
        onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
      >
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="p-0.5 rounded transition-colors"
          style={{ backgroundColor: 'transparent' }}
          onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.1)')}
          onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
        >
          {isExpanded ? (
            <ChevronDown className="w-3 h-3" style={{ color: '#6b7280' }} />
          ) : (
            <ChevronRight className="w-3 h-3" style={{ color: '#6b7280' }} />
          )}
        </button>

        <button onClick={onFolderClick} className="flex items-center gap-2 flex-1 text-left">
          <FolderIcon className="w-4 h-4" style={{ color: '#eab308' }} />
          <span className="text-sm truncate" style={{ color: '#e5e7eb' }}>
            {folder.name}
          </span>
          <span className="text-xs" style={{ color: '#6b7280' }}>
            ({folderChats.length})
          </span>
        </button>

        <button
          onClick={(e) => {
            e.stopPropagation()
            onNewChatInFolder()
          }}
          className="p-1 opacity-0 group-hover:opacity-100 rounded transition-all"
          style={{ backgroundColor: 'transparent' }}
          onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.1)')}
          onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
          title="New chat in folder"
        >
          <Plus className="w-3 h-3" style={{ color: '#6b7280' }} />
        </button>
      </div>

      {/* Expanded content */}
      {isExpanded && (
        <div className="ml-4 mt-1 space-y-0.5">
          {/* Project instructions indicator */}
          {folder.instructions && (
            <div className="flex items-center gap-2 px-2 py-1 text-xs" style={{ color: '#6b7280' }}>
              <FileText className="w-3 h-3" />
              <span className="italic">Has project instructions</span>
            </div>
          )}

          {/* Chats in folder */}
          {folderChats.map((chat) => (
            <ChatSidebarItem
              key={chat.id}
              chat={chat}
              isActive={chat.id === activeId}
              onSelect={() => onChatSelect(chat.id)}
              onDelete={() => onDeleteChat(chat.id)}
              onOpenInNewWindow={
                onOpenChatInNewWindow ? () => onOpenChatInNewWindow(chat.id) : undefined
              }
              onMoveToFolder={
                onMoveChatToFolder ? (folderId) => onMoveChatToFolder(chat.id, folderId) : undefined
              }
              folders={allFolders.filter((f) => f.id !== folder.id)}
            />
          ))}

          {folderChats.length === 0 && (
            <div className="px-2 py-1 text-xs italic" style={{ color: '#6b7280' }}>
              No chats in folder
            </div>
          )}
        </div>
      )}
    </div>
  )
}
