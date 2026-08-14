'use client'

import { useState, useCallback, useEffect, useRef, type MouseEvent } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Archive, MessageSquare, Check, Hash, Pencil, UsersRound } from 'lucide-react'
import { SidebarListSkeleton } from '@overlay/ui/feedback'
import { useAsyncSessions } from '@/components/providers/async-sessions-store'
import {
  CHAT_ARCHIVED_EVENT,
  CHAT_CREATED_EVENT,
  CHAT_DELETED_EVENT,
  CHAT_MODIFIED_EVENT,
  CHAT_TITLE_UPDATED_EVENT,
  dispatchChatArchived,
  dispatchChatCreated,
  dispatchChatTitleUpdated,
  sanitizeChatTitle,
  type ChatArchivedDetail,
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
import { clearLastChatForView, rememberLastChatForView } from '@/shared/chat/last-chat-by-view'
import { overlayAppClient } from '@/shared/app/overlay-app-client'
import { SidebarResourceList, SidebarResourceRow } from '@overlay/ui/primitives'
import { useAuth } from '@/contexts/AuthContext'
import { NewDirectMessageDialog } from './NewDirectMessageDialog'
import { NewChannelDialog } from './NewChannelDialog'
import { isSameChatSurface } from '@/features/workspaces/lib/workspace-routing'
import { useWorkspaceChanged } from '@/features/workspaces/lib/use-workspace-changed'
import { useOverlayCapabilities } from '@/components/providers/CapabilitiesProvider'
import { useCollaborationRealtime } from './collaboration/CollaborationRealtimeProvider'


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
  const { appDataCapabilities } = useOverlayCapabilities()
  const {
    conversationListVersion,
    notifications: collaborationNotifications,
  } = useCollaborationRealtime()
  const isPublicShowcase = seededChats !== undefined
  const [chats, setChats] = useState<Conversation[]>(() => seededChats ?? [])
  const [loading, setLoading] = useState(!isPublicShowcase)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(() => getCachedChatListPageInfo().hasMore)
  const [editingChatId, setEditingChatId] = useState<string | null>(null)
  const [editingTitle, setEditingTitle] = useState('')
  const [deletingChatIds, setDeletingChatIds] = useState<string[]>([])
  const [newDirectMessageOpen, setNewDirectMessageOpen] = useState(false)
  const [newChannelOpen, setNewChannelOpen] = useState(false)
  const [collaborationUnread, setCollaborationUnread] = useState<Record<string, number>>({})
  const lastConversationListVersionRef = useRef<number | null>(null)
  const [browserRouteVersion, setBrowserRouteVersion] = useState(0)
  useEffect(() => {
    function bumpBrowserRoute() {
      setBrowserRouteVersion((value) => value + 1)
    }
    window.addEventListener('overlay:chat-route-selected', bumpBrowserRoute)
    window.addEventListener('popstate', bumpBrowserRoute)
    return () => {
      window.removeEventListener('overlay:chat-route-selected', bumpBrowserRoute)
      window.removeEventListener('popstate', bumpBrowserRoute)
    }
  }, [])
  void browserRouteVersion
  const searchActiveId = searchParams?.get('id') ?? null
  const browserActiveId = typeof window === 'undefined'
    ? null
    : new URLSearchParams(window.location.search).get('id')
  const activeId = browserActiveId ?? searchActiveId
  const chatView = (() => {
    const value = searchParams?.get('view')
    if (value === 'dms' || value === 'channels' || value === 'all') return value
    return 'personal'
  })()
  setActiveChatListView(chatView)

  const openChat = useCallback((chat: Conversation) => {
    const targetView = chat.conversationType === 'channel'
      ? 'channels'
      : chat.conversationType === 'dm'
        ? 'dms'
        : chatView === 'all'
          ? 'personal'
          : chatView
    rememberLastChatForView(workspaceId, targetView, chat._id)
    const href = `${baseHref}?${new URLSearchParams({
      ...(isPublicShowcase ? { showcase: '1' } : {}),
      view: targetView,
      id: chat._id,
    }).toString()}`
    // Soft-navigate on the same chat surface so Next does not remount the app
    // shell (and WorkspaceProvider) on every switch.
    if (isSameChatSurface(pathname, baseHref)) {
      window.history.pushState(null, '', href)
      window.dispatchEvent(new CustomEvent('overlay:chat-route-selected', {
        detail: { chatId: chat._id, view: targetView },
      }))
    } else {
      router.push(href)
    }
    onNavigate?.()
  }, [baseHref, chatView, isPublicShowcase, onNavigate, pathname, router, workspaceId])

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
    const counts: Record<string, number> = {}
    for (const notification of collaborationNotifications) {
      if (notification.readAt) continue
      if (!notification.conversationId) continue
      counts[notification.conversationId] = (counts[notification.conversationId] ?? 0) + 1
    }
    setCollaborationUnread(counts)
    function handleCollaborationRead(event: Event) {
      const conversationId = (event as CustomEvent<{ conversationId?: string }>).detail?.conversationId
      if (!conversationId) return
      setCollaborationUnread((current) => {
        if (!(conversationId in current)) return current
        const next = { ...current }
        delete next[conversationId]
        return next
      })
    }
    window.addEventListener('overlay:collaboration-read', handleCollaborationRead)
    return () => {
      window.removeEventListener('overlay:collaboration-read', handleCollaborationRead)
    }
  }, [collaborationNotifications, isPublicShowcase, user, workspaceId])

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
      // The server gives us an exact Retry-After window. The shared list cache
      // suppresses requests during that window, so do not turn one 429 into an
      // eight-attempt retry loop. Existing cached chats remain usable.
      if (outcome.status === 'rate-limited') {
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

  useWorkspaceChanged(useCallback(() => { void loadChats() }, [loadChats]))

  useEffect(() => {
    lastConversationListVersionRef.current = null
  }, [workspaceId])

  useEffect(() => {
    if (appDataCapabilities.provider !== 'convex' || conversationListVersion === null) return
    const previous = lastConversationListVersionRef.current
    lastConversationListVersionRef.current = conversationListVersion
    if (previous === null || previous === conversationListVersion) return
    void loadChats()
  }, [appDataCapabilities.provider, conversationListVersion, loadChats])

  useEffect(() => {
    if (
      appDataCapabilities.provider !== 'postgres'
      || !workspaceId
      || isPublicShowcase
      || !user
    ) return
    const controller = new AbortController()
    let cancelled = false
    const run = async () => {
      try {
        let { cursor } = await overlayAppClient.conversations.events(undefined, {
          signal: controller.signal,
        })
        while (!cancelled) {
          const result = await overlayAppClient.conversations.events(cursor, {
            signal: controller.signal,
          })
          if (cancelled) return
          cursor = result.cursor
          if (result.events.some((event) => (
            event.type === 'conversation.created'
            || event.type === 'conversation.updated'
            || event.type === 'conversation.deleted'
          ))) {
            await loadChats({ cancelled })
          }
        }
      } catch {
        // Navigation and workspace switches abort the long poll. The next
        // mounted panel starts with a fresh durable cursor and full list load.
      }
    }
    void run()
    return () => {
      cancelled = true
      controller.abort()
    }
  }, [appDataCapabilities.provider, isPublicShowcase, loadChats, user, workspaceId])

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

    function removeActiveChat(chatId: string) {
      removeCachedChat(chatId)
      setDeletingChatIds((prev) => (
        prev.includes(chatId) ? prev : [...prev, chatId]
      ))
      window.setTimeout(() => {
        setChats((prev) => prev.filter((chat) => chat._id !== chatId))
        setDeletingChatIds((prev) => prev.filter((id) => id !== chatId))
      }, 180)
    }

    function handleChatDeleted(event: Event) {
      const { detail } = event as CustomEvent<ChatDeletedDetail>
      if (!detail?.chatId) return
      removeActiveChat(detail.chatId)
    }

    function handleChatArchived(event: Event) {
      const { detail } = event as CustomEvent<ChatArchivedDetail>
      const archivedChatId = detail?.chat?._id
      if (!archivedChatId) return
      removeActiveChat(archivedChatId)
      clearLastChatForView(workspaceId, chatView, archivedChatId)
      if (activeId !== archivedChatId) return
      const nextChat = (getCachedChatList() ?? []).find((candidate) => {
        if (candidate._id === archivedChatId) return false
        if (chatView === 'personal') return (candidate.conversationType ?? 'personal') === 'personal'
        if (chatView === 'dms') return candidate.conversationType === 'dm'
        if (chatView === 'channels') return candidate.conversationType === 'channel'
        return true
      })
      if (nextChat) {
        openChat(nextChat)
        return
      }
      const emptyHref = `${baseHref}?${new URLSearchParams({ view: chatView }).toString()}`
      if (isSameChatSurface(pathname, baseHref)) {
        window.history.pushState(null, '', emptyHref)
        window.dispatchEvent(new CustomEvent('overlay:chat-route-selected', {
          detail: { chatId: null, view: chatView },
        }))
      } else {
        router.push(emptyHref)
      }
    }
    window.addEventListener(CHAT_CREATED_EVENT, handleChatUpserted)
    window.addEventListener(CHAT_MODIFIED_EVENT, handleChatUpserted)
    window.addEventListener(CHAT_TITLE_UPDATED_EVENT, handleChatTitleUpdated)
    window.addEventListener(CHAT_DELETED_EVENT, handleChatDeleted)
    window.addEventListener(CHAT_ARCHIVED_EVENT, handleChatArchived)
    return () => {
      window.removeEventListener(CHAT_CREATED_EVENT, handleChatUpserted)
      window.removeEventListener(CHAT_MODIFIED_EVENT, handleChatUpserted)
      window.removeEventListener(CHAT_TITLE_UPDATED_EVENT, handleChatTitleUpdated)
      window.removeEventListener(CHAT_DELETED_EVENT, handleChatDeleted)
      window.removeEventListener(CHAT_ARCHIVED_EVENT, handleChatArchived)
    }
  }, [activeId, baseHref, chatView, isPublicShowcase, openChat, pathname, router, user, workspaceId])

  function beginRename(chat: Conversation, event: MouseEvent<HTMLButtonElement>) {
    event.stopPropagation()
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

  async function archiveChat(chat: Conversation, event: MouseEvent<HTMLButtonElement>) {
    event.stopPropagation()
    setEditingChatId(null)
    dispatchChatArchived({
      chat: { ...chat, archivedAt: Date.now() },
    })
    try {
      await overlayAppClient.conversations.updateParticipantState(chat._id, { archived: true })
    } catch {
      void loadChats()
    }
  }

  const viewChats = chatView === 'personal'
    ? chats.filter((chat) => (chat.conversationType ?? 'personal') === 'personal')
    : chatView === 'dms'
      ? chats.filter((chat) => chat.conversationType === 'dm')
      : chatView === 'channels'
        ? chats.filter((chat) => chat.conversationType === 'channel')
        : chats
  const filteredChats = searchQuery.trim()
    ? viewChats.filter((c) => c.title.toLowerCase().includes(searchQuery.toLowerCase()))
    : viewChats
  const emptyLabel = {
    personal: 'No personal chats yet',
    dms: 'No direct messages yet',
    channels: 'No channels yet',
    all: 'No chats yet',
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
            return (
              <SidebarResourceRow
                key={chat._id}
                active={active}
                onClick={() => {
                  if (isDeleting || isEditing) return
                  openChat(chat)
                }}
                className={`cursor-pointer overflow-hidden transition-all duration-200 ${
                  isDeleting ? 'max-h-0 -translate-y-1 opacity-0' : 'max-h-7 opacity-100'
                }`}
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
                  <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-[var(--surface-muted)] text-[9px] font-medium text-[var(--foreground)]">
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
                    {chat.conversationType === 'dm' || chat.conversationType === 'channel' ? null : (
                      <button
                        type="button"
                        onClick={(event) => beginRename(chat, event)}
                        className="ml-1 shrink-0 rounded p-0.5 opacity-0 transition-opacity hover:bg-[var(--border)] group-hover:opacity-100"
                        aria-label="Rename chat"
                      >
                        <Pencil size={11} />
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={(event) => void archiveChat(chat, event)}
                      className="ml-1 shrink-0 rounded p-0.5 opacity-0 transition-opacity hover:bg-[var(--border)] group-hover:opacity-100"
                      aria-label="Archive chat"
                    >
                      <Archive size={11} />
                    </button>
                  </>
                )}
              </SidebarResourceRow>
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
          rememberLastChatForView(workspaceId, 'dms', id)
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
          rememberLastChatForView(workspaceId, 'channels', id)
          router.push(`${baseHref}?${new URLSearchParams({ view: 'channels', id }).toString()}`)
          onNavigate?.()
        }}
      />
    ) : null}
    </>
  )
}
