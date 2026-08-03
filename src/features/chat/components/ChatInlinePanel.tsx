'use client'

import { useState, useCallback, useEffect, type MouseEvent } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { MessageSquare, Check, Hash, Pencil, Trash2, UsersRound } from 'lucide-react'
import { SidebarListSkeleton } from '@overlay/ui/feedback'
import { useAsyncSessions } from '@/components/providers/async-sessions-store'
import {
  CHAT_CREATED_EVENT,
  CHAT_DELETED_EVENT,
  CHAT_MODIFIED_EVENT,
  CHAT_TITLE_UPDATED_EVENT,
  dispatchChatDeleted,
  dispatchChatCreated,
  dispatchChatTitleUpdated,
  sanitizeChatTitle,
  type ChatCreatedDetail,
  type ChatDeletedDetail,
  type ChatTitleUpdatedDetail,
} from '@/shared/chat/chat-title'
import { NEW_CHANNEL_EVENT, NEW_DIRECT_MESSAGE_EVENT } from '@/shared/chat/collaboration-events'
import {
  fetchChatListResult,
  fetchNextChatListPage,
  clearChatListCache,
  getCachedChatList,
  getCachedChatListPageInfo,
  removeCachedChat,
  setActiveChatListView,
  upsertCachedChat,
} from '@/shared/chat/chat-list-cache'
import { overlayAppClient } from '@/shared/app/overlay-app-client'
import { SidebarResourceList } from '@overlay/ui/primitives'
import { useAuth } from '@/contexts/AuthContext'
import { NewDirectMessageDialog } from './NewDirectMessageDialog'
import { NewChannelDialog } from './NewChannelDialog'
import { isSameChatSurface } from '@/features/workspaces/lib/workspace-routing'

const panelItemClass =
  'group flex h-7 items-center gap-2 rounded-md px-2.5 py-0 text-xs text-[var(--muted)] transition-colors hover:bg-[var(--surface-subtle)] hover:text-[var(--foreground)]'
const inlineConfirmDeleteButtonClass =
  'ml-1 inline-flex h-5 shrink-0 items-center rounded-full bg-red-500/15 px-2 text-[11px] font-medium leading-none text-red-500 transition-colors hover:bg-red-500/25'

type Conversation = {
  _id: string
  title: string
  lastModified: number
  conversationType?: 'personal' | 'dm' | 'channel'
}

export function ChatInlinePanel({
  refreshKey,
  searchQuery = '',
  onNavigate,
  baseHref = '/app/chat',
  workspaceId,
  seededChats,
}: {
  refreshKey: number
  searchQuery?: string
  onNavigate?: () => void
  baseHref?: string
  workspaceId?: string | null
  seededChats?: Conversation[]
}) {
  const router = useRouter()
  const pathname = usePathname() ?? ''
  const searchParams = useSearchParams()
  const { sessions, getUnread } = useAsyncSessions()
  const { user, isLoading: authLoading } = useAuth()
  const isPublicShowcase = seededChats !== undefined
  const [chats, setChats] = useState<Conversation[]>(() => seededChats ?? [])
  const [loading, setLoading] = useState(!isPublicShowcase)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(() => getCachedChatListPageInfo().hasMore)
  const [editingChatId, setEditingChatId] = useState<string | null>(null)
  const [editingTitle, setEditingTitle] = useState('')
  const [deletingChatIds, setDeletingChatIds] = useState<string[]>([])
  const [pendingDeleteChatId, setPendingDeleteChatId] = useState<string | null>(null)
  const [newDirectMessageOpen, setNewDirectMessageOpen] = useState(false)
  const [newChannelOpen, setNewChannelOpen] = useState(false)
  const [collaborationUnread, setCollaborationUnread] = useState<Record<string, number>>({})
  const activeId = searchParams?.get('id') ?? null
  const chatView = (() => {
    const value = searchParams?.get('view')
    if (value === 'dms' || value === 'channels' || value === 'unread' || value === 'all') return value
    return 'personal'
  })()
  setActiveChatListView(chatView)

  useEffect(() => {
    const openDialog = () => {
      if (chatView === 'dms' && workspaceId) setNewDirectMessageOpen(true)
    }
    const openChannelDialog = () => {
      if (chatView === 'channels' && workspaceId) setNewChannelOpen(true)
    }
    window.addEventListener(NEW_DIRECT_MESSAGE_EVENT, openDialog)
    window.addEventListener(NEW_CHANNEL_EVENT, openChannelDialog)
    return () => {
      window.removeEventListener(NEW_DIRECT_MESSAGE_EVENT, openDialog)
      window.removeEventListener(NEW_CHANNEL_EVENT, openChannelDialog)
    }
  }, [chatView, workspaceId])

  useEffect(() => {
    if (!workspaceId || isPublicShowcase || !user) {
      setCollaborationUnread({})
      return
    }
    let cancelled = false
    const loadUnread = async () => {
      try {
        const { notifications } = await overlayAppClient.conversations.notifications({
          unreadOnly: true,
          limit: 100,
        })
        if (cancelled) return
        const counts: Record<string, number> = {}
        for (const notification of notifications) {
          if (!notification.conversationId) continue
          counts[notification.conversationId] = (counts[notification.conversationId] ?? 0) + 1
        }
        setCollaborationUnread(counts)
      } catch {
        // Realtime badges are best effort; the conversation remains accessible.
      }
    }
    void loadUnread()
    const timer = window.setInterval(() => void loadUnread(), 15_000)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [isPublicShowcase, user, workspaceId])

  const loadChats = useCallback(async (signal?: { cancelled: boolean }) => {
    if (seededChats) {
      setChats(seededChats)
      setHasMore(false)
      setLoading(false)
      return
    }
    if (authLoading) return
    if (!user) {
      clearChatListCache()
      setChats([])
      setHasMore(false)
      setLoading(false)
      return
    }
    // While the user is authenticated, an empty/failed response is almost always
    // transient on first paint (the Convex token may not be minted yet, so the
    // BFF briefly returns 401). Keep the loading skeleton and retry with backoff
    // instead of flashing "No chats yet". We only ever commit to the empty state
    // on a genuinely successful response with zero chats.
    const MAX_ATTEMPTS = 8
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      if (signal?.cancelled) return
      // The cache is display-only here. It may have been populated by a guest
      // server render before the client recovered the authenticated session.
      const outcome = await fetchChatListResult({ force: true })
      if (signal?.cancelled) return
      if (outcome.status === 'success') {
        setChats(outcome.chats)
        setHasMore(getCachedChatListPageInfo().hasMore)
        setLoading(false)
        return
      }
      await new Promise((resolve) => setTimeout(resolve, Math.min(300 * 2 ** attempt, 3000)))
    }
    // Exhausted retries; stop the skeleton so the UI doesn't hang indefinitely.
    if (!signal?.cancelled) setLoading(false)
  }, [authLoading, seededChats, user])

  async function loadMoreChats() {
    if (!user) return
    setLoadingMore(true)
    try {
      setChats(await fetchNextChatListPage())
      setHasMore(getCachedChatListPageInfo().hasMore)
    } finally {
      setLoadingMore(false)
    }
  }

  useEffect(() => {
    if (seededChats) {
      setChats(seededChats)
      setHasMore(false)
      setLoading(false)
      return
    }
    if (authLoading) {
      setLoading(true)
      return
    }
    if (!user) {
      clearChatListCache()
      setChats([])
      setHasMore(false)
      setLoading(false)
      return
    }
    const cached = getCachedChatList()
    if (cached?.length) {
      setChats(cached)
      setHasMore(getCachedChatListPageInfo().hasMore)
      setLoading(false)
    } else {
      setChats([])
      setLoading(true)
    }
    const signal = { cancelled: false }
    const timeoutId = window.setTimeout(() => {
      if (!getCachedChatList()?.length) setLoading(true)
      void loadChats(signal)
    }, 0)
    return () => {
      signal.cancelled = true
      window.clearTimeout(timeoutId)
    }
  }, [authLoading, chatView, loadChats, refreshKey, seededChats, user, workspaceId])

  useEffect(() => {
    if (isPublicShowcase) return
    if (!user) return

    function handleChatUpserted(event: Event) {
      const { detail } = event as CustomEvent<ChatCreatedDetail>
      const nextChat = detail?.chat
      if (!nextChat?._id) return
      upsertCachedChat(nextChat)
      setLoading(false)
      setChats((prev) => {
        const existingIndex = prev.findIndex((chat) => chat._id === nextChat._id)
        if (existingIndex === -1) return [nextChat, ...prev]
        const existing = prev[existingIndex]
        const merged = {
          ...existing,
          ...nextChat,
          title: nextChat.title || existing.title,
        }
        const withoutExisting = prev.filter((chat) => chat._id !== nextChat._id)
        return [merged, ...withoutExisting]
      })
    }

    function handleChatTitleUpdated(event: Event) {
      const { detail } = event as CustomEvent<ChatTitleUpdatedDetail>
      if (!detail?.chatId || !detail.title) return
      upsertCachedChat({
        _id: detail.chatId,
        title: detail.title,
        lastModified: Date.now(),
      })
      setChats((prev) => {
        const existing = prev.find((chat) => chat._id === detail.chatId)
        if (!existing) return prev
        const updated = { ...existing, title: detail.title, lastModified: Date.now() }
        return [updated, ...prev.filter((chat) => chat._id !== detail.chatId)]
      })
    }

    function handleChatDeleted(event: Event) {
      const { detail } = event as CustomEvent<ChatDeletedDetail>
      if (!detail?.chatId) return
      const deletedChatId = detail.chatId
      removeCachedChat(deletedChatId)
      setDeletingChatIds((prev) => (
        prev.includes(deletedChatId) ? prev : [...prev, deletedChatId]
      ))
      window.setTimeout(() => {
        setChats((prev) => prev.filter((chat) => chat._id !== deletedChatId))
        setDeletingChatIds((prev) => prev.filter((id) => id !== deletedChatId))
      }, 180)
    }
    window.addEventListener(CHAT_CREATED_EVENT, handleChatUpserted)
    window.addEventListener(CHAT_MODIFIED_EVENT, handleChatUpserted)
    window.addEventListener(CHAT_TITLE_UPDATED_EVENT, handleChatTitleUpdated)
    window.addEventListener(CHAT_DELETED_EVENT, handleChatDeleted)
    return () => {
      window.removeEventListener(CHAT_CREATED_EVENT, handleChatUpserted)
      window.removeEventListener(CHAT_MODIFIED_EVENT, handleChatUpserted)
      window.removeEventListener(CHAT_TITLE_UPDATED_EVENT, handleChatTitleUpdated)
      window.removeEventListener(CHAT_DELETED_EVENT, handleChatDeleted)
    }
  }, [isPublicShowcase, user])

  function beginRename(chat: Conversation, event: MouseEvent<HTMLButtonElement>) {
    event.stopPropagation()
    setPendingDeleteChatId(null)
    setEditingChatId(chat._id)
    setEditingTitle(chat.title)
  }

  function cancelRename() {
    setEditingChatId(null)
    setEditingTitle('')
  }

  async function saveRename(chatId: string) {
    const previousTitle = chats.find((chat) => chat._id === chatId)?.title ?? 'New Chat'
    const nextTitle = sanitizeChatTitle(editingTitle, previousTitle)
    cancelRename()
    if (nextTitle === previousTitle) return

    setChats((prev) => prev.map((chat) => (
      chat._id === chatId ? { ...chat, title: nextTitle } : chat
    )))
    dispatchChatTitleUpdated({ chatId, title: nextTitle })

    try {
      const response = await overlayAppClient.conversations.updateResponse({ conversationId: chatId, title: nextTitle })
      if (!response.ok) throw new Error('Failed to rename chat')
    } catch {
      setChats((prev) => prev.map((chat) => (
        chat._id === chatId ? { ...chat, title: previousTitle } : chat
      )))
      dispatchChatTitleUpdated({ chatId, title: previousTitle })
    }
  }

  function requestDeleteChat(chat: Conversation, event: MouseEvent) {
    event.stopPropagation()
    setEditingChatId(null)
    setPendingDeleteChatId(chat._id)
  }

  async function confirmDeleteChatAction(chatId: string, event: MouseEvent) {
    event.stopPropagation()
    setPendingDeleteChatId(null)
    dispatchChatDeleted({ chatId })
    await overlayAppClient.conversations.deleteResponse({ conversationId: chatId })
    if (activeId === chatId) {
      router.push(`${baseHref}?${new URLSearchParams({ view: chatView }).toString()}`)
    }
  }

  const viewChats = chatView === 'personal'
    ? chats.filter((chat) => (chat.conversationType ?? 'personal') === 'personal')
    : chatView === 'dms'
      ? chats.filter((chat) => chat.conversationType === 'dm')
      : chatView === 'channels'
        ? chats.filter((chat) => chat.conversationType === 'channel')
        : chatView === 'unread'
          ? chats.filter((chat) => Math.max(getUnread(chat._id), collaborationUnread[chat._id] ?? 0) > 0)
          : chats
  const filteredChats = searchQuery.trim()
    ? viewChats.filter((c) => c.title.toLowerCase().includes(searchQuery.toLowerCase()))
    : viewChats
  const emptyLabel = {
    personal: 'No personal chats yet',
    dms: 'No direct messages yet',
    channels: 'No channels yet',
    unread: 'You are all caught up',
    all: 'No chats yet',
    activity: 'You are all caught up',
  }[chatView]

  return (
    <>
    <SidebarResourceList>
      {loading ? (
        <SidebarListSkeleton rows={6} />
      ) : filteredChats.length === 0 ? (
        <p className="px-2.5 py-2 text-xs text-[var(--muted-light)]">
          {viewChats.length === 0 ? emptyLabel : 'No results'}
        </p>
      ) : (
        <>
          {filteredChats.map((chat) => {
            const isStreaming = sessions[chat._id]?.status === 'streaming'
            const unread = Math.max(getUnread(chat._id), collaborationUnread[chat._id] ?? 0)
            const active = activeId === chat._id
            const isEditing = editingChatId === chat._id
            const isDeleting = deletingChatIds.includes(chat._id)
            const isConfirmingDelete = pendingDeleteChatId === chat._id
            return (
              <div
                key={chat._id}
                onMouseLeave={() => {
                  if (isConfirmingDelete) setPendingDeleteChatId(null)
                }}
                onClick={() => {
                  if (isDeleting) return
                  if (isEditing) return
                  const href = `${baseHref}?${new URLSearchParams({
                    ...(isPublicShowcase ? { showcase: '1' } : {}),
                    view: chatView,
                    id: chat._id,
                  }).toString()}`
                  // Soft-navigate on the same chat surface so Next does not
                  // remount the app shell (and WorkspaceProvider) on every switch.
                  if (isSameChatSurface(pathname, baseHref)) {
                    window.history.pushState(null, '', href)
                    window.dispatchEvent(new CustomEvent('overlay:chat-route-selected', {
                      detail: { chatId: chat._id },
                    }))
                  } else {
                    router.push(href)
                  }
                  onNavigate?.()
                }}
                className={`${panelItemClass} cursor-pointer overflow-hidden transition-all duration-200 ${
                  isDeleting ? 'max-h-0 -translate-y-1 opacity-0' : 'max-h-7 opacity-100'
                } ${active ? 'bg-[var(--surface-subtle)] text-[var(--foreground)]' : ''}`}
              >
                {chat.conversationType === 'channel' ? (
                  <Hash size={12} className="shrink-0" />
                ) : chat.conversationType === 'dm' ? (
                  <UsersRound size={12} className="shrink-0" />
                ) : (
                  <MessageSquare size={12} className="shrink-0" />
                )}
                {!isPublicShowcase && isEditing ? (
                  <input
                    autoFocus
                    value={editingTitle}
                    onChange={(event) => setEditingTitle(event.target.value)}
                    onClick={(event) => event.stopPropagation()}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault()
                        void saveRename(chat._id)
                      } else if (event.key === 'Escape') {
                        event.preventDefault()
                        cancelRename()
                      }
                    }}
                    onBlur={() => void saveRename(chat._id)}
                    className="min-w-0 flex-1 rounded-md border border-[var(--border)] bg-[var(--surface-elevated)] px-2 py-1 text-[11px] text-[var(--foreground)] outline-none"
                  />
                ) : (
                  <span className="min-w-0 flex-1 truncate">{chat.title}</span>
                )}
                {isStreaming && !unread ? (
                  <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-[var(--muted)]" />
                ) : null}
                {unread > 0 ? (
                  <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-[var(--foreground)] text-[9px] font-medium text-[var(--background)]">
                    {unread > 9 ? '9+' : unread}
                  </span>
                ) : null}
                {isPublicShowcase ? null : isEditing ? (
                  <button
                    type="button"
                    onMouseDown={(event) => {
                      event.preventDefault()
                      event.stopPropagation()
                      void saveRename(chat._id)
                    }}
                    className="ml-1 shrink-0 rounded p-0.5 text-[var(--foreground)] hover:bg-[var(--border)]"
                    aria-label="Save chat name"
                  >
                    <Check size={11} />
                  </button>
                ) : (
                  <>
                    {isConfirmingDelete ? (
                      <button
                        type="button"
                        onClick={(event) => void confirmDeleteChatAction(chat._id, event)}
                        className={inlineConfirmDeleteButtonClass}
                        aria-label="Confirm delete chat"
                      >
                        Confirm
                      </button>
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={(event) => beginRename(chat, event)}
                          className="ml-1 shrink-0 rounded p-0.5 opacity-0 transition-opacity hover:bg-[var(--border)] group-hover:opacity-100"
                          aria-label="Rename chat"
                        >
                          <Pencil size={11} />
                        </button>
                        <button
                          type="button"
                          onClick={(event) => requestDeleteChat(chat, event)}
                          className="ml-1 shrink-0 rounded p-0.5 opacity-0 transition-opacity hover:bg-[var(--border)] group-hover:opacity-100"
                          aria-label="Delete chat"
                        >
                          <Trash2 size={11} />
                        </button>
                      </>
                    )}
                  </>
                )}
              </div>
            )
          })}
          {hasMore ? (
            <button
              type="button"
              disabled={loadingMore}
              onClick={() => void loadMoreChats()}
              className="h-7 w-full rounded-md px-2.5 text-left text-xs text-[var(--muted-light)] transition-colors hover:bg-[var(--surface-subtle)] hover:text-[var(--foreground)] disabled:cursor-wait disabled:opacity-60"
            >
              {loadingMore ? 'Loading...' : 'Load more'}
            </button>
          ) : null}
        </>
      )}
    </SidebarResourceList>
    {workspaceId ? (
      <NewDirectMessageDialog
        open={newDirectMessageOpen}
        workspaceId={workspaceId}
        onOpenChange={setNewDirectMessageOpen}
        onCreated={({ id, title }) => {
          dispatchChatCreated({
            chat: {
              _id: id,
              title,
              lastModified: Date.now(),
              conversationType: 'dm',
            },
          })
          router.push(`${baseHref}?${new URLSearchParams({ view: 'dms', id }).toString()}`)
          onNavigate?.()
        }}
      />
    ) : null}
    {workspaceId ? (
      <NewChannelDialog
        open={newChannelOpen}
        workspaceId={workspaceId}
        showcase={isPublicShowcase}
        onOpenChange={setNewChannelOpen}
        onCreated={({ id, title }) => {
          dispatchChatCreated({ chat: { _id: id, title, lastModified: Date.now(), conversationType: 'channel' } })
          router.push(`${baseHref}?${new URLSearchParams({ view: 'channels', id }).toString()}`)
          onNavigate?.()
        }}
      />
    ) : null}
    </>
  )
}
