import { useState, useEffect, useCallback, useMemo } from 'react'
import { Archive, Bell, Hash, Mail, MessageSquare, Trash2, X, ExternalLink } from 'lucide-react'
import type { Theme } from '../utils/theme'
import type { ChatMeta } from '../components/chat'
import { useChatContext } from '../contexts/ChatContext'
import { SidebarListItem, SidebarItemAction } from '../components/ui/SidebarListItem'
import { PanelSubnav } from '../components/ui/PanelSubnav'
import type { ChatListView } from '../services/chat-list-cache'
import {
  fetchNotifications,
  markNotificationsRead,
  type DesktopNotification
} from '../services/activity-service'

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

function ActivityList({
  theme,
  notifications,
  isLoading,
  error,
  searchQuery,
  onRetry,
  onOpen
}: {
  theme: Theme
  notifications: DesktopNotification[]
  isLoading: boolean
  error: string | null
  searchQuery: string
  onRetry: () => void
  onOpen: (notification: DesktopNotification) => void
}): React.ReactElement<any> {
  const query = searchQuery.trim().toLowerCase()
  const filtered = query
    ? notifications.filter(
        (notification) =>
          notification.title.toLowerCase().includes(query) ||
          (notification.body ?? '').toLowerCase().includes(query)
      )
    : notifications

  const empty = (
    icon: React.ReactNode,
    message: string,
    detail?: string,
    retry?: boolean
  ): React.ReactElement<any> => (
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
      {icon}
      <span style={{ fontSize: '12px', opacity: 0.85 }}>{message}</span>
      {detail && (
        <span
          style={{
            fontSize: '10px',
            lineHeight: '14px',
            opacity: 0.55,
            maxWidth: '240px',
            wordBreak: 'break-word'
          }}
        >
          {detail}
        </span>
      )}
      {retry && (
        <button
          onClick={onRetry}
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
      )}
    </div>
  )

  if (isLoading) {
    return empty(
      <Bell size={28} strokeWidth={1} style={{ opacity: 0.35 }} />,
      'Loading activity...'
    )
  }
  if (error) {
    return empty(
      <Bell size={28} strokeWidth={1} style={{ opacity: 0.35 }} />,
      'Could not load activity',
      error,
      true
    )
  }
  if (filtered.length === 0) {
    return empty(
      <Bell size={28} strokeWidth={1} style={{ opacity: 0.35 }} />,
      query ? 'No results' : 'No activity yet'
    )
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1px' }}>
      {filtered.map((notification) => (
        <button
          key={notification.id}
          type="button"
          onClick={() => onOpen(notification)}
          title={notification.title}
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: '8px',
            width: '100%',
            padding: '8px 10px',
            boxSizing: 'border-box',
            border: 'none',
            borderRadius: '6px',
            background: 'transparent',
            cursor: notification.conversationId ? 'pointer' : 'default',
            textAlign: 'left',
            fontFamily: 'system-ui, -apple-system, sans-serif',
            transition: 'background 0.1s ease'
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = theme.buttonHover
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'transparent'
          }}
        >
          <span
            style={{
              width: '7px',
              height: '7px',
              borderRadius: '9999px',
              marginTop: '5px',
              flexShrink: 0,
              background: notification.readAt ? 'transparent' : theme.text,
              border: notification.readAt ? `1px solid ${theme.border}` : 'none'
            }}
          />
          <span style={{ minWidth: 0, flex: 1 }}>
            <span
              style={{
                display: 'block',
                fontSize: '12px',
                color: theme.text,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap'
              }}
            >
              {notification.title}
            </span>
            {notification.body && (
              <span
                style={{
                  display: 'block',
                  fontSize: '11px',
                  color: theme.textSecondary,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  marginTop: '1px'
                }}
              >
                {notification.body}
              </span>
            )}
            <span style={{ display: 'block', fontSize: '10px', color: theme.textSecondary, opacity: 0.6, marginTop: '1px' }}>
              {getDateLabel(notification.createdAt)}
            </span>
          </span>
        </button>
      ))}
    </div>
  )
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

const CHAT_SUBNAV_ITEMS = [
  { id: 'personal', label: 'Personal', icon: MessageSquare },
  { id: 'dms', label: 'Direct Messages', icon: Mail },
  { id: 'channels', label: 'Channels', icon: Hash },
  { id: 'activity', label: 'Activity', icon: Bell },
  { id: 'archived', label: 'Archived', icon: Archive },
] as const

type ChatSubnavId = (typeof CHAT_SUBNAV_ITEMS)[number]['id']

function isChatListViewId(value: string): value is ChatListView {
  return value === 'personal' || value === 'dms' || value === 'channels' || value === 'archived'
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
}: ChatsListPageProps): React.ReactElement<any> {
  const chatContext = useChatContext()
  const [activeChatId, setActiveChatId] = useState<string | null>(() =>
    chatContext.getLastOpenedChatId()
  )
  const [selectedChatIds, setSelectedChatIds] = useState<Set<string>>(new Set())
  const [activityView, setActivityView] = useState(false)
  const [notifications, setNotifications] = useState<DesktopNotification[]>([])
  const [activityLoading, setActivityLoading] = useState(false)
  const [activityError, setActivityError] = useState<string | null>(null)

  // Use conversations from Convex via ChatContext
  const chats = useMemo(() => chatContext.conversations || [], [chatContext.conversations])
  const chatView = chatContext.chatView
  const isLoading = chatContext.isLoading
  const loadError = chatContext.error

  const activeSubnavId: ChatSubnavId = activityView
    ? 'activity'
    : chatView === 'all'
      ? 'personal'
      : chatView

  const selectSubnav = useCallback(
    (id: ChatSubnavId) => {
      if (id === 'activity') {
        setActivityView(true)
        return
      }
      setActivityView(false)
      if (isChatListViewId(id)) chatContext.setChatView(id)
    },
    [chatContext]
  )

  useEffect(() => {
    if (!activityView) return
    let cancelled = false
    setActivityLoading(true)
    setActivityError(null)
    void fetchNotifications()
      .then((items) => {
        if (cancelled) return
        setNotifications(items)
        setActivityLoading(false)
        // Match web: opening Activity marks everything read.
        if (items.some((item) => !item.readAt)) {
          void markNotificationsRead()
            .then(() => {
              if (!cancelled) {
                const now = Date.now()
                setNotifications((prev) =>
                  prev.map((item) => (item.readAt ? item : { ...item, readAt: now }))
                )
              }
            })
            .catch(() => undefined)
        }
      })
      .catch((error) => {
        if (cancelled) return
        setActivityError(error instanceof Error ? error.message : String(error))
        setActivityLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [activityView])

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

  const handleOpenNotification = useCallback(
    async (notification: DesktopNotification) => {
      if (notification.conversationId) {
        const id = notification.conversationId
        void markNotificationsRead([notification.id]).catch(() => undefined)
        setNotifications((prev) =>
          prev.map((item) =>
            item.id === notification.id && !item.readAt ? { ...item, readAt: Date.now() } : item
          )
        )
        if (onSelectChat) {
          chatContext.setLastOpenedChatId(id)
          setActiveChatId(id)
          onSelectChat(id)
          return
        }
        localStorage.setItem(PENDING_CHAT_ID_KEY, id)
        chatContext.setLastOpenedChatId(id)
        setActiveChatId(id)
        const { isVisible } = await window.bridge.isPanelVisible('chat')
        if (!isVisible) await window.bridge.togglePanelWindow('chat', true)
      } else {
        void markNotificationsRead([notification.id]).catch(() => undefined)
        setNotifications((prev) =>
          prev.map((item) =>
            item.id === notification.id && !item.readAt ? { ...item, readAt: Date.now() } : item
          )
        )
      }
    },
    [onSelectChat, chatContext]
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

      <PanelSubnav
        theme={theme}
        activeId={activeSubnavId}
        onSelect={(id) => selectSubnav(id as ChatSubnavId)}
        items={CHAT_SUBNAV_ITEMS.map((item) =>
          item.id === 'activity'
            ? {
                ...item,
                badgeCount: notifications.filter((notification) => !notification.readAt).length
              }
            : item
        )}
      />

      {isSelectMode && selectedChatIds.size > 0 && !activityView && (
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
        {activityView ? (
          <ActivityList
            theme={theme}
            notifications={notifications}
            isLoading={activityLoading}
            error={activityError}
            searchQuery={searchQuery}
            onRetry={() => {
              setActivityError(null)
              setActivityLoading(true)
              void fetchNotifications()
                .then((items) => {
                  setNotifications(items)
                  setActivityLoading(false)
                })
                .catch((error) => {
                  setActivityError(error instanceof Error ? error.message : String(error))
                  setActivityLoading(false)
                })
            }}
            onOpen={handleOpenNotification}
          />
        ) : isLoading ? (
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
                  const rowIcon = chatView === 'dms' ? Mail : chatView === 'channels' ? Hash : MessageSquare

                  return (
                    <SidebarListItem
                      key={chat.id}
                      icon={rowIcon}
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
