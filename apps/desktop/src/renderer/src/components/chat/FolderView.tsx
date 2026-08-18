import { useState, useEffect, useCallback } from 'react'
import { Settings, Check, X } from 'lucide-react'
import type { ChatMeta } from './types'
import {
  loadChatFolders,
  updateChatFolder,
  loadChatFolderMap,
  type Folder
} from '../../utils/folderStorage'
import { loadChatsMeta, listChatsMeta, loadChat, getChat } from '../../utils/chatStorage'
import type { PanelTheme } from '../../hooks/usePanelTheme'
import { FolderDocuments } from './FolderDocuments'

interface FolderViewProps {
  folderId: string
  onChatSelect: (chatId: string) => void
  theme: PanelTheme
}

export function FolderView({
  folderId,
  onChatSelect,
  theme,
}: FolderViewProps): React.ReactElement<any> | null {
  const [folder, setFolder] = useState<Folder | null>(null)
  const [chats, setChats] = useState<ChatMeta[]>([])
  const [instructions, setInstructions] = useState('')
  const [isEditingInstructions, setIsEditingInstructions] = useState(false)
  const [isDocumentsExpanded, setIsDocumentsExpanded] = useState(false)

  const loadFolderData = useCallback((): void => {
    const folders = loadChatFolders()
    const f = folders.find((folder) => folder.id === folderId)
    if (f) {
      setFolder(f)
      setInstructions(f.instructions || '')
    }

    const allChats = loadChatsMeta()
    const folderMap = loadChatFolderMap()
    const folderChats = allChats
      .filter((c) => folderMap[c.id] === folderId)
      .sort((a, b) => b.updatedAt - a.updatedAt)
    setChats(folderChats)
    void listChatsMeta().then((remoteChats) => {
      const nextFolderChats = remoteChats
        .filter((c) => folderMap[c.id] === folderId)
        .sort((a, b) => b.updatedAt - a.updatedAt)
      setChats(nextFolderChats)
    }).catch((error) => console.error('[FolderView] Failed to refresh chats:', error))
  }, [folderId])

  useEffect(() => {
    loadFolderData()
  }, [loadFolderData])

  const getFirstMessagePreview = (chatId: string): string => {
    const chat = loadChat(chatId)
    if (!chat) void getChat(chatId)
    if (!chat || chat.messages.length === 0) return ''
    const firstUserMsg = chat.messages.find((m) => m.role === 'user')
    if (!firstUserMsg) return ''
    const content = firstUserMsg.content
    return content.length > 80 ? content.slice(0, 80) + '...' : content
  }

  const formatDate = (timestamp: number): string => {
    const date = new Date(timestamp)
    const now = new Date()
    const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24))
    if (diffDays === 0) return 'Today'
    if (diffDays === 1) return 'Yesterday'
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  }

  const saveInstructions = (): void => {
    if (folder) {
      updateChatFolder(folder.id, { instructions })
      setFolder({ ...folder, instructions })
      setIsEditingInstructions(false)
    }
  }

  if (!folder) return null

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        // @ts-expect-error - WebKit vendor prefix for Electron
        WebkitAppRegion: 'no-drag'
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '20px 20px 20px'
        }}
      >
        {/* Folder name - left aligned */}
        <h1
          style={{
            fontSize: 18,
            fontWeight: 600,
            color: theme.text,
            margin: 0,
            fontFamily: 'system-ui, -apple-system, sans-serif'
          }}
        >
          {folder.name}
        </h1>

        {/* Project settings - right */}
        <button
          onClick={() => setIsEditingInstructions(!isEditingInstructions)}
          title="Project settings"
          style={{
            width: 40,
            height: 40,
            borderRadius: 8,
            background: isEditingInstructions ? theme.surfaceBgHover : 'transparent',
            border: 'none',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            color: theme.textSecondary,
            transition: 'all 0.15s ease'
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = theme.surfaceBgHover
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = isEditingInstructions
              ? theme.surfaceBgHover
              : 'transparent'
          }}
        >
          <Settings size={18} />
        </button>
      </div>

      {/* Project Instructions (collapsible) - above chat input */}
      {isEditingInstructions && (
        <div style={{ padding: '0 52px' }}>
          <div
            style={{
              background: theme.surfaceBg,
              border: `1px solid ${theme.border}`,
              borderRadius: 16,
              padding: '12px 16px'
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: 8
              }}
            >
              <div
                style={{
                  fontSize: 12,
                  color: theme.textSecondary,
                  fontFamily: 'system-ui, -apple-system, sans-serif'
                }}
              >
                Project Instructions
              </div>
              <div style={{ display: 'flex', gap: 4 }}>
                <button
                  onClick={saveInstructions}
                  style={{
                    padding: 6,
                    background: 'transparent',
                    border: 'none',
                    borderRadius: 6,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: '#10b981',
                    transition: 'all 0.15s ease'
                  }}
                  title="Save"
                >
                  <Check size={16} />
                </button>
                <button
                  onClick={() => {
                    setInstructions(folder.instructions || '')
                    setIsEditingInstructions(false)
                  }}
                  style={{
                    padding: 6,
                    background: 'transparent',
                    border: 'none',
                    borderRadius: 6,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: '#ef4444',
                    transition: 'all 0.15s ease'
                  }}
                  title="Cancel"
                >
                  <X size={16} />
                </button>
              </div>
            </div>
            <textarea
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              placeholder="Add instructions that will apply to all chats in this folder..."
              style={{
                width: '100%',
                minHeight: 60,
                background: 'transparent',
                border: 'none',
                outline: 'none',
                resize: 'vertical',
                fontSize: 13,
                color: theme.text,
                fontFamily: 'system-ui, -apple-system, sans-serif'
              }}
            />
          </div>
          {/* Folder Documents */}
          <FolderDocuments
            folderId={folderId}
            theme={theme}
            isExpanded={isDocumentsExpanded}
            onToggle={() => setIsDocumentsExpanded(!isDocumentsExpanded)}
          />
        </div>
      )}

      {/* Chat List */}
      <div style={{ flex: 1, padding: '0 20px 8px', minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        <div
          style={{
            background: theme.surfaceBg,
            border: `1px solid ${theme.border}`,
            borderRadius: 16,
            overflow: 'hidden',
            flex: 1,
            minHeight: 0,
            overflowY: 'auto'
          }}
        >
          {chats.map((chat, index) => {
            const preview = getFirstMessagePreview(chat.id)
            return (
              <div
                key={chat.id}
                onClick={() => onChatSelect(chat.id)}
                style={{
                  padding: '12px 16px',
                  borderBottom: index < chats.length - 1 ? `1px solid ${theme.border}` : 'none',
                  cursor: 'pointer',
                  transition: 'background 0.1s'
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = theme.surfaceBgHover)}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
              >
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'flex-start',
                    marginBottom: 4
                  }}
                >
                  <div
                    style={{
                      fontSize: 14,
                      fontWeight: 500,
                      color: theme.text,
                      fontFamily: 'system-ui, -apple-system, sans-serif'
                    }}
                  >
                    {chat.title}
                  </div>
                  <div
                    style={{
                      fontSize: 12,
                      color: theme.textMuted,
                      fontFamily: 'system-ui, -apple-system, sans-serif',
                      flexShrink: 0,
                      marginLeft: 12
                    }}
                  >
                    {formatDate(chat.updatedAt)}
                  </div>
                </div>
                {preview && (
                  <div
                    style={{
                      fontSize: 13,
                      color: theme.textSecondary,
                      fontFamily: 'system-ui, -apple-system, sans-serif',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap'
                    }}
                  >
                    {preview}
                  </div>
                )}
              </div>
            )
          })}
          {chats.length === 0 && (
            <div
              style={{
                padding: '40px 20px',
                textAlign: 'center',
                color: theme.textMuted,
                fontSize: 14,
                fontFamily: 'system-ui, -apple-system, sans-serif'
              }}
            >
              No chats in this folder yet
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
