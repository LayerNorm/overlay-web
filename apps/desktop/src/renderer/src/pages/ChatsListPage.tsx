import { useState, useEffect, useCallback, useMemo } from 'react'
import { MessageSquare, Trash2, X, ExternalLink } from 'lucide-react'
import type { Theme } from '../utils/theme'
import type { ChatMeta } from '../components/chat'
import { useChatContext } from '../contexts/ChatContext'
import { SidebarListItem, SidebarItemAction } from '../components/ui/SidebarListItem'

interface ChatsListPageProps {
  theme: Theme
  onSelectChat?: (id: string) => void
  selectedChatId?: string | null
  isSearchOpen: boolean
  searchQuery: string
  onSearchQueryChange: (value: string) => void
  isSelectMode: boolean
  onSelectModeChange: (value: boolean) => void
}

const PENDING_CHAT_ID_KEY = 'overlay-pending-chat-id'
const CHATS_CHANGED_EVENT = 'overlay:chats-changed'

function getDateLabel(timestamp: number): string {
  const date = new Date(timestamp)
  const today = new Date()
  const yesterday = new Date(today)
  yesterday.setDate(yesterday.getDate() - 1)

  if (date.toDateString() === today.toDateString()) return 'Today'
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday'
  return date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
}

export function ChatsListPage({
  theme,
  onSelectChat,
  selectedChatId,
  isSearchOpen,
  searchQuery,
  onSearchQueryChange,
  isSelectMode,
  onSelectModeChange
}: ChatsListPageProps): React.ReactElement {
  const chatContext = useChatContext()
  const [activeChatId, setActiveChatId] = useState<string | null>(() =>
    chatContext.getLastOpenedChatId()
  )
  const [selectedChatIds, setSelectedChatIds] = useState<Set<string>>(new Set())

  // Use conversations from Convex via ChatContext
  const chats = useMemo(() => chatContext.conversations || [], [chatContext.conversations])
  const isLoading = chatContext.isLoading
  const loadError = chatContext.error

  useEffect(() => {
    const handler = (): void => {
      setActiveChatId(chatContext.getLastOpenedChatId())
    }
    window.addEventListener('storage', handler)
    window.addEventListener(CHATS_CHANGED_EVENT, handler)
    return () => {
      window.removeEventListener('storage', handler)
      window.removeEventListener(CHATS_CHANGED_EVENT, handler)
    }
  }, [chatContext])

  useEffect(() => {
    if (!isSelectMode) setSelectedChatIds(new Set())
  }, [isSelectMode])

  // Update active chat when selectedChatId changes
  useEffect(() => {
    if (selectedChatId) {
      setActiveChatId(selectedChatId)
    }
  }, [selectedChatId])

  const handleOpenChat = useCallback(
    async (id: string, isAgent?: boolean) => {
      if (isSelectMode) {
        setSelectedChatIds((prev) => {
          const next = new Set(prev)
          if (next.has(id)) next.delete(id)
          else next.add(id)
          return next
        })
        return
      }

      if (onSelectChat) {
        if (isAgent) localStorage.setItem('overlay-agent-mode-enabled', 'true')
        chatContext.setLastOpenedChatId(id)
        setActiveChatId(id)
        onSelectChat(id)
        return
      }
      if (isAgent) localStorage.setItem('overlay-agent-mode-enabled', 'true')
      localStorage.setItem(PENDING_CHAT_ID_KEY, id)
      chatContext.setLastOpenedChatId(id)
      setActiveChatId(id)
      const { isVisible } = await window.bridge.isPanelVisible('chat')
      if (!isVisible) await window.bridge.togglePanelWindow('chat', true)
    },
    [isSelectMode, onSelectChat, chatContext]
  )

  const handleOpenInPanel = useCallback(
    async (id: string, e: React.MouseEvent) => {
      e.stopPropagation()
      localStorage.setItem(PENDING_CHAT_ID_KEY, id)
      chatContext.setLastOpenedChatId(id)
      setActiveChatId(id)
      const { isVisible } = await window.bridge.isPanelVisible('chat')
      if (!isVisible) await window.bridge.togglePanelWindow('chat', true)
    },
    [chatContext]
  )

  const handleDeleteChat = useCallback(
    (id: string, e: React.MouseEvent) => {
      e.stopPropagation()
      void chatContext.deleteChat(id)
    },
    [chatContext]
  )

  const toggleChatSelection = useCallback((chatId: string) => {
    setSelectedChatIds((prev) => {
      const next = new Set(prev)
      if (next.has(chatId)) next.delete(chatId)
      else next.add(chatId)
      return next
    })
  }, [])

  const exitSelectMode = useCallback(() => {
    onSelectModeChange(false)
    setSelectedChatIds(new Set())
  }, [onSelectModeChange])

  const handleBatchDelete = useCallback(async () => {
    for (const id of selectedChatIds) await chatContext.deleteChat(id)
    exitSelectMode()
  }, [selectedChatIds, exitSelectMode, chatContext])

  const allDisplayChats = useMemo(() => {
    if (!searchQuery.trim()) return chats
    const q = searchQuery.toLowerCase()
    return chats.filter((c) => c.title.toLowerCase().includes(q))
  }, [chats, searchQuery])

  const groups = useMemo(() => {
    const sorted = [...allDisplayChats].sort((a, b) => b.updatedAt - a.updatedAt)
    const byLabel: Record<string, ChatMeta[]> = {}
    for (const chat of sorted) {
      const label = getDateLabel(chat.updatedAt)
      ;(byLabel[label] ||= []).push(chat)
    }
    return byLabel
  }, [allDisplayChats])

  const groupLabels = useMemo(() => Object.keys(groups), [groups])

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
            placeholder="Search chats..."
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

      {isSelectMode && selectedChatIds.size > 0 && (
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
            {selectedChatIds.size} selected
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

      <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', padding: '0 8px 4px' }}>
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
            <MessageSquare size={28} strokeWidth={1} style={{ opacity: 0.35 }} />
            <span style={{ fontSize: '12px', opacity: 0.7 }}>Loading chats...</span>
          </div>
        ) : loadError ? (
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
            <MessageSquare size={28} strokeWidth={1} style={{ opacity: 0.35 }} />
            <span style={{ fontSize: '12px', opacity: 0.85 }}>Could not load chats</span>
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
              onClick={() => void chatContext.listChatsMeta()}
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
        ) : allDisplayChats.length === 0 ? (
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
            <MessageSquare size={28} strokeWidth={1} style={{ opacity: 0.35 }} />
            <span style={{ fontSize: '12px', opacity: 0.7 }}>
              {searchQuery ? 'No results' : 'No chats yet'}
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
                {items.map((chat) => {
                  const isActive = activeChatId === chat.id || selectedChatId === chat.id
                  const isBatchSelected = selectedChatIds.has(chat.id)

                  return (
                    <SidebarListItem
                      key={chat.id}
                      icon={MessageSquare}
                      label={chat.title}
                      isActive={isActive}
                      isSelectMode={isSelectMode}
                      isBatchSelected={isBatchSelected}
                      onBatchToggle={() => toggleChatSelection(chat.id)}
                      onClick={() => void handleOpenChat(chat.id, chat.isAgent)}
                      theme={theme}
                      actions={
                        <>
                          {onSelectChat && (
                            <SidebarItemAction
                              onClick={(e) => void handleOpenInPanel(chat.id, e)}
                              title="Open in panel"
                              icon={ExternalLink}
                              color={theme.textSecondary}
                            />
                          )}
                          <SidebarItemAction
                            onClick={(e) => handleDeleteChat(chat.id, e)}
                            title="Delete chat"
                            icon={Trash2}
                            color={theme.textSecondary}
                          />
                        </>
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
