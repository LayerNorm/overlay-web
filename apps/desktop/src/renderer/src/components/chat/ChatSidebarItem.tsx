import { useState, useEffect } from 'react'
import {
  ChevronDown,
  ChevronRight,
  MoreHorizontal,
  Trash2,
  ExternalLink,
  FolderInput
} from 'lucide-react'
import type { ChatMeta } from './types'

interface StoredMemory {
  id: string
  content: string
  type: string
  importance: number
}

interface ChatSidebarItemProps {
  chat: ChatMeta
  isActive: boolean
  onSelect: () => void
  onDelete: () => void
  onOpenInNewWindow?: () => void
  onMoveToFolder?: (folderId: string | null) => void
  folders?: Array<{ id: string; name: string }>
}

export function ChatSidebarItem({
  chat,
  isActive,
  onSelect,
  onDelete,
  onOpenInNewWindow,
  onMoveToFolder,
  folders = []
}: ChatSidebarItemProps): React.ReactElement<any> {
  const [isExpanded, setIsExpanded] = useState(false)
  const [memories, setMemories] = useState<StoredMemory[]>([])
  const [showMenu, setShowMenu] = useState(false)
  const [showFolderMenu, setShowFolderMenu] = useState(false)

  useEffect(() => {
    if (isExpanded) {
      loadMemories()
    }
  }, [isExpanded, chat.id])

  const loadMemories = async (): Promise<void> => {
    try {
      const chatMemories = await window.bridge.memory.getByChat(chat.id)
      setMemories(chatMemories)
    } catch {
      setMemories([])
    }
  }

  return (
    <div className="group" style={{ fontFamily: 'system-ui, -apple-system, sans-serif' }}>
      <div
        className="flex items-center gap-1 px-2 py-1.5 rounded-lg cursor-pointer"
        style={{
          backgroundColor: isActive ? 'rgba(255, 255, 255, 0.1)' : 'transparent'
        }}
        onMouseEnter={(e) => {
          if (!isActive) e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.05)'
        }}
        onMouseLeave={(e) => {
          if (!isActive) e.currentTarget.style.backgroundColor = 'transparent'
        }}
      >
        {/* Expand toggle */}
        <button
          onClick={(e) => {
            e.stopPropagation()
            setIsExpanded(!isExpanded)
          }}
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

        {/* Chat title */}
        <button
          onClick={onSelect}
          className="flex-1 text-left text-sm truncate"
          style={{ color: '#e5e7eb' }}
        >
          {chat.title}
        </button>

        {/* Memory indicator */}
        {memories.length > 0 && !isExpanded && (
          <span
            style={{
              fontSize: 10,
              color: '#9ca3af',
              background: 'rgba(128, 128, 128, 0.2)',
              padding: '1px 5px',
              borderRadius: 4,
              fontWeight: 600,
              fontFamily: 'system-ui, -apple-system, sans-serif'
            }}
          >
            {memories.length}
          </span>
        )}

        {/* More menu */}
        <div className="relative">
          <button
            onClick={(e) => {
              e.stopPropagation()
              setShowMenu(!showMenu)
              setShowFolderMenu(false)
            }}
            className="p-1 opacity-0 group-hover:opacity-100 rounded transition-all"
            style={{ backgroundColor: 'transparent' }}
            onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.1)')}
            onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
          >
            <MoreHorizontal className="w-3 h-3" style={{ color: '#6b7280' }} />
          </button>

          {showMenu && (
            <div
              className="absolute right-0 top-6 w-44 py-1 rounded-lg shadow-xl z-50"
              style={{ backgroundColor: '#2a2a2a' }}
            >
              {onOpenInNewWindow && (
                <button
                  onClick={() => {
                    onOpenInNewWindow()
                    setShowMenu(false)
                  }}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-sm transition-colors"
                  style={{ color: '#e5e7eb' }}
                  onMouseEnter={(e) =>
                    (e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.1)')
                  }
                  onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                >
                  <ExternalLink className="w-3 h-3" />
                  Open in new window
                </button>
              )}
              {onMoveToFolder && folders.length > 0 && (
                <div className="relative">
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      setShowFolderMenu(!showFolderMenu)
                    }}
                    className="w-full flex items-center gap-2 px-3 py-1.5 text-sm transition-colors"
                    style={{ color: '#e5e7eb' }}
                    onMouseEnter={(e) =>
                      (e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.1)')
                    }
                    onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                  >
                    <FolderInput className="w-3 h-3" />
                    Move to folder
                    <ChevronRight className="w-3 h-3 ml-auto" />
                  </button>
                  {showFolderMenu && (
                    <div
                      className="absolute left-full top-0 w-40 py-1 rounded-lg shadow-xl ml-1"
                      style={{ backgroundColor: '#2a2a2a' }}
                    >
                      <button
                        onClick={() => {
                          onMoveToFolder(null)
                          setShowMenu(false)
                          setShowFolderMenu(false)
                        }}
                        className="w-full px-3 py-1.5 text-sm text-left transition-colors"
                        style={{ color: '#9ca3af' }}
                        onMouseEnter={(e) =>
                          (e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.1)')
                        }
                        onMouseLeave={(e) =>
                          (e.currentTarget.style.backgroundColor = 'transparent')
                        }
                      >
                        No folder
                      </button>
                      {folders.map((folder) => (
                        <button
                          key={folder.id}
                          onClick={() => {
                            onMoveToFolder(folder.id)
                            setShowMenu(false)
                            setShowFolderMenu(false)
                          }}
                          className="w-full px-3 py-1.5 text-sm text-left transition-colors truncate"
                          style={{ color: '#e5e7eb' }}
                          onMouseEnter={(e) =>
                            (e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.1)')
                          }
                          onMouseLeave={(e) =>
                            (e.currentTarget.style.backgroundColor = 'transparent')
                          }
                        >
                          {folder.name}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
              <button
                onClick={() => {
                  onDelete()
                  setShowMenu(false)
                }}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-sm transition-colors"
                style={{ color: '#f87171' }}
                onMouseEnter={(e) =>
                  (e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.1)')
                }
                onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
              >
                <Trash2 className="w-3 h-3" />
                Delete
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Expanded memories */}
      {isExpanded && (
        <div
          style={{ marginLeft: 24, marginTop: 4, display: 'flex', flexDirection: 'column', gap: 4 }}
        >
          {memories.length > 0 ? (
            memories.slice(0, 5).map((m) => {
              const typeColors: Record<string, string> = {
                preference: '#60A5FA',
                fact: '#34D399',
                project: '#A78BFA',
                decision: '#FBBF24'
              }
              const typeLabels: Record<string, string> = {
                preference: 'Preference',
                fact: 'Fact',
                project: 'Project',
                decision: 'Decision'
              }
              return (
                <div
                  key={m.id}
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 8,
                    padding: '6px 8px',
                    background: 'rgba(255, 255, 255, 0.03)',
                    borderRadius: 6,
                    borderLeft: `3px solid ${typeColors[m.type] || '#6b7280'}`
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                      <span
                        style={{
                          fontSize: 9,
                          fontWeight: 600,
                          textTransform: 'uppercase',
                          letterSpacing: '0.5px',
                          color: typeColors[m.type] || '#6b7280',
                          fontFamily: 'system-ui, -apple-system, sans-serif'
                        }}
                      >
                        {typeLabels[m.type] || m.type}
                      </span>
                    </div>
                    <p
                      style={{
                        margin: 0,
                        fontSize: 11,
                        lineHeight: 1.4,
                        color: '#9ca3af',
                        wordBreak: 'break-word',
                        fontFamily: 'system-ui, -apple-system, sans-serif',
                        display: '-webkit-box',
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: 'vertical',
                        overflow: 'hidden'
                      }}
                    >
                      {m.content}
                    </p>
                  </div>
                </div>
              )
            })
          ) : (
            <div
              style={{
                padding: '4px 8px',
                fontSize: 11,
                fontStyle: 'italic',
                color: '#6b7280',
                fontFamily: 'system-ui, -apple-system, sans-serif'
              }}
            >
              No memories yet
            </div>
          )}
          {memories.length > 5 && (
            <div
              style={{
                padding: '2px 8px',
                fontSize: 11,
                color: '#6b7280',
                fontFamily: 'system-ui, -apple-system, sans-serif'
              }}
            >
              +{memories.length - 5} more
            </div>
          )}
        </div>
      )}
    </div>
  )
}
