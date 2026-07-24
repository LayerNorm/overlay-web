import { useState, useEffect, useCallback, useMemo } from 'react'
import { Bot, Trash2, CheckSquare, X, Plus } from 'lucide-react'
import type { Theme } from '../utils/theme'
import type { ChatMeta } from '../components/chat'
import { SidebarListItem, SidebarItemAction } from '../components/ui/SidebarListItem'
import {
  loadChatsMeta,
  listChatsMeta,
  deleteChat,
  setLastOpenedChatId,
  getLastOpenedChatId,
  CHATS_CHANGED_EVENT
} from '../utils/chatStorage'

interface AgentsListPageProps {
  theme: Theme
  onNewAgent?: () => void
}

const PENDING_CHAT_ID_KEY = 'overlay-pending-chat-id'

function getDateLabel(timestamp: number): string {
  const date = new Date(timestamp)
  const today = new Date()
  const yesterday = new Date(today)
  yesterday.setDate(yesterday.getDate() - 1)

  if (date.toDateString() === today.toDateString()) return 'Today'
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday'
  return date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
}

export function AgentsListPage({ theme, onNewAgent }: AgentsListPageProps): React.ReactElement {
  const [allChats, setAllChats] = useState<ChatMeta[]>(() => loadChatsMeta())
  const [activeChatId, setActiveChatId] = useState<string | null>(() => getLastOpenedChatId())
  const [isSelectMode, setIsSelectMode] = useState(false)
  const [selectedChatIds, setSelectedChatIds] = useState<Set<string>>(new Set())

  const chats = useMemo(() => allChats.filter((c) => c.isAgent === true), [allChats])

  const refreshChats = useCallback(() => {
    setAllChats(loadChatsMeta())
    setActiveChatId(getLastOpenedChatId())
    void listChatsMeta().then(setAllChats).catch((error) => {
      console.error('[AgentsListPage] Failed to refresh chats:', error)
    })
  }, [])

  useEffect(() => { refreshChats() }, [refreshChats])

  useEffect(() => {
    const handler = () => {
      setActiveChatId(getLastOpenedChatId())
      setAllChats(loadChatsMeta())
    }
    window.addEventListener('storage', handler)
    window.addEventListener(CHATS_CHANGED_EVENT, handler)
    return () => {
      window.removeEventListener('storage', handler)
      window.removeEventListener(CHATS_CHANGED_EVENT, handler)
    }
  }, [])

  const handleOpenChat = useCallback(async (id: string) => {
    localStorage.setItem(PENDING_CHAT_ID_KEY, id)
    localStorage.setItem('overlay-agent-mode-enabled', 'true')
    setLastOpenedChatId(id)
    setActiveChatId(id)
    const { isVisible } = await window.bridge.isPanelVisible('chat')
    if (!isVisible) await window.bridge.togglePanelWindow('chat', true)
  }, [])

  const handleDeleteChat = useCallback(
    (id: string, e: React.MouseEvent) => {
      e.stopPropagation()
      void deleteChat(id)
      refreshChats()
    },
    [refreshChats]
  )

  const exitSelectMode = useCallback(() => {
    setIsSelectMode(false)
    setSelectedChatIds(new Set())
  }, [])

  const handleBatchDelete = useCallback(() => {
    for (const id of selectedChatIds) void deleteChat(id)
    exitSelectMode()
    refreshChats()
  }, [selectedChatIds, exitSelectMode, refreshChats])

  const toggleChatSelection = useCallback((chatId: string) => {
    setSelectedChatIds((prev) => {
      const next = new Set(prev)
      if (next.has(chatId)) next.delete(chatId)
      else next.add(chatId)
      return next
    })
  }, [])

  const groups = useMemo(() => {
    const sorted = [...chats].sort((a, b) => b.updatedAt - a.updatedAt)
    const byLabel: Record<string, ChatMeta[]> = {}
    for (const chat of sorted) {
      const label = getDateLabel(chat.updatedAt)
      ;(byLabel[label] ||= []).push(chat)
    }
    return byLabel
  }, [chats])

  const groupLabels = useMemo(() => Object.keys(groups), [groups])

  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* New agent button */}
      <div style={{ padding: '10px 8px 6px', flexShrink: 0 }}>
        <button
          onClick={onNewAgent}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            width: '100%',
            padding: '8px 12px',
            background: theme.text,
            color: theme.background,
            border: 'none',
            borderRadius: '8px',
            cursor: 'pointer',
            fontSize: '13px',
            fontWeight: 500,
            fontFamily: 'system-ui, -apple-system, sans-serif',
            transition: 'opacity 0.15s ease',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.opacity = '0.8' }}
          onMouseLeave={(e) => { e.currentTarget.style.opacity = '1' }}
        >
          <Plus size={14} />
          New agent
        </button>
      </div>

      {/* Selection mode bar */}
      {isSelectMode && selectedChatIds.size > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 8px', flexShrink: 0 }}>
          <span style={{ fontSize: '11px', color: theme.textSecondary }}>{selectedChatIds.size} selected</span>
          <div style={{ display: 'flex', gap: '4px' }}>
            <button
              onClick={handleBatchDelete}
              style={{
                display: 'flex', alignItems: 'center', gap: '3px',
                padding: '3px 8px', background: 'transparent',
                border: '1px solid rgba(239,68,68,0.35)', borderRadius: '5px',
                color: 'rgb(239,68,68)', fontSize: '11px', cursor: 'pointer',
                fontFamily: 'system-ui, -apple-system, sans-serif',
              }}
            >
              <Trash2 size={11} /> Delete
            </button>
            <button
              onClick={exitSelectMode}
              style={{
                display: 'flex', alignItems: 'center',
                padding: '3px 6px', background: 'transparent',
                border: `1px solid ${theme.border}`, borderRadius: '5px',
                color: theme.textSecondary, fontSize: '11px', cursor: 'pointer',
                fontFamily: 'system-ui, -apple-system, sans-serif',
              }}
            >
              <X size={11} />
            </button>
          </div>
        </div>
      )}

      {!isSelectMode && chats.length > 0 && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '0 8px 2px', flexShrink: 0 }}>
          <button
            onClick={() => setIsSelectMode(true)}
            title="Select agents"
            style={{
              background: 'transparent', border: 'none', padding: '2px 4px',
              cursor: 'pointer', borderRadius: '4px',
              color: theme.textSecondary, fontSize: '11px',
              fontFamily: 'system-ui, -apple-system, sans-serif',
              opacity: 0.6,
            }}
            onMouseEnter={(e) => { e.currentTarget.style.opacity = '1' }}
            onMouseLeave={(e) => { e.currentTarget.style.opacity = '0.6' }}
          >
            <CheckSquare size={12} />
          </button>
        </div>
      )}

      {/* Agent list */}
      <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', padding: '0 8px 8px' }}>
        {chats.length === 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: '10px', color: theme.textSecondary }}>
            <Bot size={28} strokeWidth={1} style={{ opacity: 0.35 }} />
            <span style={{ fontSize: '12px', opacity: 0.7 }}>No agents yet</span>
          </div>
        ) : (
          groupLabels.map((dateLabel, groupIdx) => {
            const items = groups[dateLabel]
            if (!items || items.length === 0) return null
            return (
              <div key={dateLabel}>
                {groupIdx > 0 && (
                  <div style={{ height: '1px', background: theme.border, margin: '6px 0' }} />
                )}
                <div style={{ fontSize: '10px', color: theme.textSecondary, padding: '4px 10px 2px', opacity: 0.6, letterSpacing: '0.3px' }}>
                  {dateLabel}
                </div>
                {items.map((chat) => {
                  const isActive = activeChatId === chat.id
                  const isBatchSelected = selectedChatIds.has(chat.id)

                  return (
                    <SidebarListItem
                      key={chat.id}
                      icon={Bot}
                      label={chat.title}
                      isActive={isActive}
                      isSelectMode={isSelectMode}
                      isBatchSelected={isBatchSelected}
                      onBatchToggle={() => toggleChatSelection(chat.id)}
                      onClick={() => handleOpenChat(chat.id)}
                      theme={theme}
                      actions={
                        <SidebarItemAction
                          onClick={(e) => handleDeleteChat(chat.id, e)}
                          title="Delete agent"
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
