'use client'

import { useState, useCallback, useEffect, useEffectEvent, useRef, type Dispatch, type MouseEvent, type SetStateAction } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Archive, Bot, Check, Hash, MessageSquare, Pencil, Slack, UserRound, UsersRound } from 'lucide-react'
import { SidebarListSkeleton } from '@overlay/ui/feedback'
import { useAsyncSessions } from '@/components/providers/async-sessions-store'
import {
  CHAT_ARCHIVED_EVENT,
  CHAT_CREATED_EVENT,
  CHAT_DELETED_EVENT,
  CHAT_MODIFIED_EVENT,
  CHAT_TITLE_UPDATED_EVENT,
  dispatchChatArchived,
  dispatchChatModified,
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
  type CachedConversation,
} from '@/shared/chat/chat-list-cache'
import { clearLastChatForView, rememberLastChatForView } from '@/shared/chat/last-chat-by-view'
import { overlayAppClient } from '@/shared/app/overlay-app-client'
import { announceArchived } from '@/shared/app/archive-toast'
import { SidebarResourceList, SidebarResourceRow } from '@overlay/ui/primitives'
import { useAuth, type AuthUser } from '@/contexts/AuthContext'
import { NewDirectMessageDialog } from './NewDirectMessageDialog'
import { NewChannelDialog } from './NewChannelDialog'
import { buildWorkspaceHref, isSameChatSurface } from '@/shared/workspaces/routing'
import { agentThreadHref } from '@/components/layout/sidebar-nav'
import { useWorkspaceChanged } from '@/hooks/use-workspace-changed'
import { useCollaborationRealtime } from './collaboration/CollaborationRealtimeProvider'
import { ConversationScopeActionDialog } from './collaboration/ConversationScopeActionDialog'
import { useWorkspace } from '@/contexts/WorkspaceContext'
import type { WorkspaceNotification } from '@overlay/workspace-contracts'


type Conversation = {
  _id: string
  title: string
  lastModified: number
  conversationType?: 'personal' | 'dm' | 'channel'
  otherParticipantTypes?: Array<'human' | 'agent'>
  externalPlatform?: string
}

type ChatView = 'personal' | 'dms' | 'channels' | 'all'

function DirectMessageIcon({
  participantTypes,
  size,
  className,
}: {
  participantTypes?: Array<'human' | 'agent'>
  size: number
  className?: string
}) {
  if (!participantTypes) return <UsersRound size={size} className={className} />
  if (participantTypes.length === 1 && participantTypes[0] === 'agent') return <Bot size={size} className={className} />
  if (participantTypes.length <= 1) return <UserRound size={size} className={className} />
  return <UsersRound size={size} className={className} />
}

function ChatConversationIcon({
  chat,
  size,
  className,
}: {
  chat: Conversation
  size: number
  className?: string
}) {
  if (chat.externalPlatform === 'slack') return <Slack size={size} className={className} />
  if (chat.conversationType === 'channel') return <Hash size={size} className={className} />
  if (chat.conversationType === 'dm') {
    return <DirectMessageIcon participantTypes={chat.otherParticipantTypes} size={size} className={className} />
  }
  return <MessageSquare size={size} className={className} />
}

function useBrowserRouteVersion() {
  const [, setBrowserRouteVersion] = useState(0)
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
}

function useNewConversationDialogs(chatView: ChatView, workspaceId: string | null | undefined) {
  const [newDirectMessageOpen, setNewDirectMessageOpen] = useState(false)
  const [newChannelOpen, setNewChannelOpen] = useState(false)
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
  return { newDirectMessageOpen, setNewDirectMessageOpen, newChannelOpen, setNewChannelOpen }
}

function useCollaborationUnread({
  workspaceId,
  isPublicShowcase,
  user,
  collaborationNotifications,
}: {
  workspaceId: string | null | undefined
  isPublicShowcase: boolean
  user: AuthUser | null
  collaborationNotifications: WorkspaceNotification[]
}) {
  const [collaborationUnread, setCollaborationUnread] = useState<Record<string, number>>({})
  useEffect(() => {
    if (!workspaceId || isPublicShowcase || !user) {
      queueMicrotask(() => setCollaborationUnread({}))
      return
    }
    const counts: Record<string, number> = {}
    for (const notification of collaborationNotifications) {
      if (notification.readAt) continue
      if (!notification.conversationId) continue
      counts[notification.conversationId] = (counts[notification.conversationId] ?? 0) + 1
    }
    queueMicrotask(() => setCollaborationUnread(counts))
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
  return collaborationUnread
}

function useChatListData({
  authLoading,
  chatView,
  refreshKey,
  seededChats,
  user,
  workspaceId,
  conversationListVersion,
}: {
  authLoading: boolean
  chatView: ChatView
  refreshKey: number
  seededChats: Conversation[] | undefined
  user: AuthUser | null
  workspaceId: string | null | undefined
  conversationListVersion: number | null
}) {
  const isPublicShowcase = seededChats !== undefined
  const [chats, setChats] = useState<Conversation[]>(() => seededChats ?? [])
  const [loading, setLoading] = useState(!isPublicShowcase)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(() => getCachedChatListPageInfo().hasMore)
  const lastConversationListVersionRef = useRef<number | null>(null)

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
    const signal = { cancelled: false }
    let timeoutId: number | undefined
    queueMicrotask(() => {
      if (signal.cancelled) return
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
      timeoutId = window.setTimeout(() => {
        if (!getCachedChatList()?.length) setLoading(true)
        void loadChats(signal)
      }, 0)
    })
    return () => {
      signal.cancelled = true
      if (timeoutId !== undefined) window.clearTimeout(timeoutId)
    }
  }, [authLoading, chatView, loadChats, refreshKey, seededChats, user, workspaceId])

  useWorkspaceChanged(useCallback(() => { void loadChats() }, [loadChats]))

  useEffect(() => {
    lastConversationListVersionRef.current = null
  }, [workspaceId])

  // Delta reconcile is guarded by lastConversationListVersionRef — a stale run
  // only upserts already-fresh rows.
  // react-doctor-disable-next-line react-doctor/no-set-state-after-await-in-effect
  useEffect(() => {
    if (conversationListVersion === null) return
    const previous = lastConversationListVersionRef.current
    lastConversationListVersionRef.current = conversationListVersion
    if (previous === null || previous === conversationListVersion) return
    // Versioned reconciliation: fetch only the delta (conversations updated
    // since the last known version) and upsert individual rows instead of
    // reloading the full list.  Fall back to full reload on error.
    const reconcileDelta = async () => {
      try {
        // Use updatedSince to fetch only changed conversations.
        // The _creationTime of the event is approximately when the change
        // happened, so we subtract a small buffer to avoid missing events
        // that were committed in the same millisecond.
        const since = Math.max(0, previous - 1000)
        const response = await overlayAppClient.conversations.getResponse({
          updatedSince: since,
          limit: 100,
        }, { credentials: 'same-origin', cache: 'no-store' })
        if (!response.ok) {
          void loadChats()
          return
        }
        const data = await response.json() as { data?: Array<Record<string, unknown>>; conversations?: Array<Record<string, unknown>> }
        const changed = data.data ?? data.conversations ?? []
        if (changed.length === 0) return
        // Upsert each changed conversation into the cache and state.
        for (const conv of changed) {
          if (!conv._id) continue
          if (conv.deletedAt) {
            removeCachedChat(conv._id as string)
          } else {
            upsertCachedChat(conv as CachedConversation)
          }
        }
        // Refresh state from cache to reflect the upserts.
        const cached = getCachedChatList()
        if (cached) setChats(cached)
      } catch {
        // Fall back to full reload if delta reconciliation fails.
        void loadChats()
      }
    }
    void reconcileDelta()
  }, [conversationListVersion, loadChats])

  return { chats, setChats, loading, setLoading, hasMore, loadingMore, loadChats, loadMoreChats }
}

function useChatListEvents({
  activeId,
  baseHref,
  chatView,
  isPublicShowcase,
  openChat,
  pathname,
  router,
  user,
  workspaceId,
  setChats,
  setLoading,
}: {
  activeId: string | null
  baseHref: string
  chatView: ChatView
  isPublicShowcase: boolean
  openChat: (chat: Conversation) => void
  pathname: string
  router: ReturnType<typeof useRouter>
  user: AuthUser | null
  workspaceId: string | null | undefined
  setChats: Dispatch<SetStateAction<Conversation[]>>
  setLoading: Dispatch<SetStateAction<boolean>>
}) {
  const [deletingChatIds, setDeletingChatIds] = useState<string[]>([])

  const removeActiveChat = useCallback((chatId: string) => {
    removeCachedChat(chatId)
    setDeletingChatIds((prev) => (
      prev.includes(chatId) ? prev : [...prev, chatId]
    ))
    window.setTimeout(() => {
      setChats((prev) => prev.filter((chat) => chat._id !== chatId))
      setDeletingChatIds((prev) => prev.filter((id) => id !== chatId))
    }, 180)
  }, [setChats])

  const handleChatUpserted = useEffectEvent((event: Event) => {
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
    })

    const handleChatTitleUpdated = useEffectEvent((event: Event) => {
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
    })

    const handleChatDeleted = useEffectEvent((event: Event) => {
      const { detail } = event as CustomEvent<ChatDeletedDetail>
      if (!detail?.chatId) return
      removeActiveChat(detail.chatId)
    })

    const handleChatArchived = useEffectEvent((event: Event) => {
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
    })

  useEffect(() => {
    if (isPublicShowcase) return
    if (!user) return
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
  }, [activeId, baseHref, chatView, isPublicShowcase, openChat, pathname, router, setChats, setLoading, user, workspaceId])

  return deletingChatIds
}

function useChatRename({
  chats,
  setChats,
}: {
  chats: Conversation[]
  setChats: Dispatch<SetStateAction<Conversation[]>>
}) {
  const [editingChatId, setEditingChatId] = useState<string | null>(null)
  const [editingTitle, setEditingTitle] = useState('')

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

  return {
    editingChatId,
    editingTitle,
    setEditingChatId,
    setEditingTitle,
    beginRename,
    cancelRename,
    saveRename,
  }
}

function useChatArchive({
  loadChats,
  setEditingChatId,
}: {
  loadChats: (signal?: { cancelled: boolean }) => Promise<void>
  setEditingChatId: Dispatch<SetStateAction<string | null>>
}) {
  const [pendingArchiveChat, setPendingArchiveChat] = useState<Conversation | null>(null)
  const [archiveBusy, setArchiveBusy] = useState(false)
  const [archiveError, setArchiveError] = useState<string | null>(null)

  function requestArchive(chat: Conversation, event: MouseEvent<HTMLButtonElement>) {
    event.stopPropagation()
    setEditingChatId(null)
    // A one-to-one DM has nobody else to keep it for — archive directly
    // instead of asking about scope. Channels and group DMs still ask.
    const soloDm = chat.conversationType === 'dm' && (chat.otherParticipantTypes?.length ?? 0) <= 1
    if ((chat.conversationType === 'dm' || chat.conversationType === 'channel') && !soloDm) {
      setArchiveError(null)
      setPendingArchiveChat(chat)
      return
    }
    void archiveChat(chat, 'self')
  }

  async function archiveChat(chat: Conversation, scope: 'self' | 'everyone') {
    setArchiveBusy(true)
    setArchiveError(null)
    try {
      await overlayAppClient.conversations.updateParticipantState(chat._id, {
        archived: true,
        archiveScope: scope,
      })
      dispatchChatArchived({
        chat: { ...chat, archivedAt: Date.now() },
      })
      announceArchived({
        name: chat.title?.trim() || 'Untitled conversation',
        undo: async () => {
          await overlayAppClient.conversations.updateParticipantState(chat._id, { archived: false, archiveScope: scope })
        },
        onUndone: () => dispatchChatModified({ chat: { ...chat, lastModified: Date.now() } }),
      })
      setPendingArchiveChat(null)
    } catch (error) {
      setArchiveError(error instanceof Error ? error.message : 'Conversation could not be archived')
      void loadChats()
    } finally {
      setArchiveBusy(false)
    }
  }

  const closeArchiveDialog = () => setPendingArchiveChat(null)

  return { pendingArchiveChat, archiveBusy, archiveError, requestArchive, archiveChat, closeArchiveDialog }
}

function ChatListRow({
  chat,
  active,
  isEditing,
  isDeleting,
  isStreaming,
  unread,
  editingTitle,
  isPublicShowcase,
  onOpenChat,
  onBeginRename,
  onRequestArchive,
  onEditingTitleChange,
  onSaveRename,
  onCancelRename,
}: {
  chat: Conversation
  active: boolean
  isEditing: boolean
  isDeleting: boolean
  isStreaming: boolean
  unread: number
  editingTitle: string
  isPublicShowcase: boolean
  onOpenChat: (chat: Conversation) => void
  onBeginRename: (chat: Conversation, event: MouseEvent<HTMLButtonElement>) => void
  onRequestArchive: (chat: Conversation, event: MouseEvent<HTMLButtonElement>) => void
  onEditingTitleChange: (value: string) => void
  onSaveRename: (chatId: string) => void
  onCancelRename: () => void
}) {
  return (
    <SidebarResourceRow
      active={active}
      onClick={() => {
        if (isDeleting || isEditing) return
        onOpenChat(chat)
      }}
      className={`cursor-pointer overflow-hidden transition-all duration-200 ${
        isDeleting ? 'max-h-0 -translate-y-1 opacity-0' : 'max-h-7 opacity-100'
      }`}
    >
      <ChatConversationIcon chat={chat} size={12} className="shrink-0" />
      {!isPublicShowcase && isEditing ? (
        <input
          aria-label="Conversation title"
          ref={(el) => { el?.focus() }}
          value={editingTitle}
          onChange={(event) => onEditingTitleChange(event.target.value)}
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              onSaveRename(chat._id)
            } else if (event.key === 'Escape') {
              event.preventDefault()
              onCancelRename()
            }
          }}
          onBlur={() => onSaveRename(chat._id)}
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
            onSaveRename(chat._id)
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
              onClick={(event) => onBeginRename(chat, event)}
              className="ml-1 shrink-0 rounded p-0.5 opacity-0 transition-opacity hover:bg-[var(--border)] group-hover:opacity-100"
              aria-label="Rename chat"
            >
              <Pencil size={11} />
            </button>
          )}
          <button
            type="button"
            onClick={(event) => onRequestArchive(chat, event)}
            className="ml-1 shrink-0 rounded p-0.5 opacity-0 transition-opacity hover:bg-[var(--border)] group-hover:opacity-100"
            aria-label="Archive chat"
          >
            <Archive size={11} />
          </button>
        </>
      )}
    </SidebarResourceRow>
  )
}

function ChatListBody({
  loading,
  chatView,
  chats,
  searchQuery,
  activeId,
  editingChatId,
  deletingChatIds,
  sessions,
  getUnread,
  collaborationUnread,
  editingTitle,
  isPublicShowcase,
  hasMore,
  loadingMore,
  loadMoreChats,
  openChat,
  beginRename,
  requestArchive,
  setEditingTitle,
  saveRename,
  cancelRename,
}: {
  loading: boolean
  chatView: ChatView
  chats: Conversation[]
  searchQuery: string
  activeId: string | null
  editingChatId: string | null
  deletingChatIds: string[]
  sessions: ReturnType<typeof useAsyncSessions>['sessions']
  getUnread: ReturnType<typeof useAsyncSessions>['getUnread']
  collaborationUnread: ReturnType<typeof useCollaborationUnread>
  editingTitle: string
  isPublicShowcase: boolean
  hasMore: boolean
  loadingMore: boolean
  loadMoreChats: () => Promise<void> | void
  openChat: (chat: Conversation) => void
  beginRename: ReturnType<typeof useChatRename>['beginRename']
  requestArchive: ReturnType<typeof useChatArchive>['requestArchive']
  setEditingTitle: (title: string) => void
  saveRename: ReturnType<typeof useChatRename>['saveRename']
  cancelRename: ReturnType<typeof useChatRename>['cancelRename']
}) {
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
  const deletingChatIdSet = new Set(deletingChatIds)
  if (loading) {
    return (
      <SidebarResourceList>
        <SidebarListSkeleton rows={6} />
      </SidebarResourceList>
    )
  }
  if (filteredChats.length === 0) {
    return (
      <SidebarResourceList>
        <p className="px-2.5 py-2 text-xs text-[var(--muted-light)]">
          {viewChats.length === 0 ? emptyLabel : 'No results'}
        </p>
      </SidebarResourceList>
    )
  }
  return (
    <SidebarResourceList>
      <>
          {filteredChats.map((chat) => (
            <ChatListRow
              key={chat._id}
              chat={chat}
              active={activeId === chat._id}
              isEditing={editingChatId === chat._id}
              isDeleting={deletingChatIdSet.has(chat._id)}
              isStreaming={sessions[chat._id]?.status === 'streaming'}
              unread={Math.max(getUnread(chat._id), collaborationUnread[chat._id] ?? 0)}
              editingTitle={editingTitle}
              isPublicShowcase={isPublicShowcase}
              onOpenChat={openChat}
              onBeginRename={beginRename}
              onRequestArchive={requestArchive}
              onEditingTitleChange={setEditingTitle}
              onSaveRename={(chatId) => void saveRename(chatId)}
              onCancelRename={cancelRename}
            />
          ))}
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
    </SidebarResourceList>
  )
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
  const { activeWorkspace } = useWorkspace()
  const pathname = usePathname() ?? ''
  const searchParams = useSearchParams()
  const { sessions, getUnread } = useAsyncSessions()
  const { user, isLoading: authLoading } = useAuth()
  const {
    conversationListVersion,
    notifications: collaborationNotifications,
  } = useCollaborationRealtime()
  const isPublicShowcase = seededChats !== undefined
  useBrowserRouteVersion()
  const searchActiveId = searchParams?.get('id') ?? null
  const browserActiveId = typeof window === 'undefined'
    ? null
    : new URLSearchParams(window.location.search).get('id')
  const activeId = browserActiveId ?? searchActiveId
  const chatView: ChatView = (() => {
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

  const {
    newDirectMessageOpen,
    setNewDirectMessageOpen,
    newChannelOpen,
    setNewChannelOpen,
  } = useNewConversationDialogs(chatView, workspaceId)
  const collaborationUnread = useCollaborationUnread({
    workspaceId,
    isPublicShowcase,
    user,
    collaborationNotifications,
  })
  const {
    chats,
    setChats,
    loading,
    setLoading,
    hasMore,
    loadingMore,
    loadChats,
    loadMoreChats,
  } = useChatListData({
    authLoading,
    chatView,
    refreshKey,
    seededChats,
    user,
    workspaceId,
    conversationListVersion,
  })
  const deletingChatIds = useChatListEvents({
    activeId,
    baseHref,
    chatView,
    isPublicShowcase,
    openChat,
    pathname,
    router,
    user,
    workspaceId,
    setChats,
    setLoading,
  })
  const {
    editingChatId,
    editingTitle,
    setEditingChatId,
    setEditingTitle,
    beginRename,
    cancelRename,
    saveRename,
  } = useChatRename({ chats, setChats })
  const {
    pendingArchiveChat,
    closeArchiveDialog,
    archiveBusy,
    archiveError,
    requestArchive,
    archiveChat,
  } = useChatArchive({ loadChats, setEditingChatId })

  return (
    <>
    <ChatListBody
      loading={loading}
      chatView={chatView}
      chats={chats}
      searchQuery={searchQuery}
      activeId={activeId}
      editingChatId={editingChatId}
      deletingChatIds={deletingChatIds}
      sessions={sessions}
      getUnread={getUnread}
      collaborationUnread={collaborationUnread}
      editingTitle={editingTitle}
      isPublicShowcase={isPublicShowcase}
      hasMore={hasMore}
      loadingMore={loadingMore}
      loadMoreChats={loadMoreChats}
      openChat={openChat}
      beginRename={beginRename}
      requestArchive={requestArchive}
      setEditingTitle={setEditingTitle}
      saveRename={saveRename}
      cancelRename={cancelRename}
    />
    <ChatListDialogs
      workspaceId={workspaceId}
      baseHref={baseHref}
      isPublicShowcase={isPublicShowcase}
      router={router}
      onNavigate={onNavigate}
      newDirectMessageOpen={newDirectMessageOpen}
      setNewDirectMessageOpen={setNewDirectMessageOpen}
      newChannelOpen={newChannelOpen}
      setNewChannelOpen={setNewChannelOpen}
      pendingArchiveChat={pendingArchiveChat}
      canApplyToEveryone={activeWorkspace?.role === 'owner'}
      archiveBusy={archiveBusy}
      archiveError={archiveError}
      closeArchiveDialog={closeArchiveDialog}
      archiveChat={archiveChat}
    />
    </>
  )
}

function ChatListDialogs({
  workspaceId,
  baseHref,
  isPublicShowcase,
  router,
  onNavigate,
  newDirectMessageOpen,
  setNewDirectMessageOpen,
  newChannelOpen,
  setNewChannelOpen,
  pendingArchiveChat,
  canApplyToEveryone,
  archiveBusy,
  archiveError,
  closeArchiveDialog,
  archiveChat,
}: {
  workspaceId?: string | null
  baseHref: string
  isPublicShowcase: boolean
  router: ReturnType<typeof useRouter>
  onNavigate?: () => void
  newDirectMessageOpen: boolean
  setNewDirectMessageOpen: (open: boolean) => void
  newChannelOpen: boolean
  setNewChannelOpen: (open: boolean) => void
  pendingArchiveChat: Conversation | null
  canApplyToEveryone: boolean
  archiveBusy: boolean
  archiveError: string | null
  closeArchiveDialog: () => void
  archiveChat: ReturnType<typeof useChatArchive>['archiveChat']
}) {
  return (
    <>
      {workspaceId ? (
        <NewDirectMessageDialog
          open={newDirectMessageOpen}
          workspaceId={workspaceId}
          onOpenChange={setNewDirectMessageOpen}
          onCreated={({ id, title, agentId }) => {
            // Agent DMs are threads under the agent — they open on the agents
            // surface and never appear in the chat list.
            const href = agentId
              ? agentThreadHref(buildWorkspaceHref(workspaceId, '/app/agents'), agentId, id)
              : `${baseHref}?${new URLSearchParams({ view: 'dms', id, draft: '1', title }).toString()}`
            router.push(href)
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
            router.push(`${baseHref}?${new URLSearchParams({ view: 'channels', id, draft: '1', title }).toString()}`)
            onNavigate?.()
          }}
        />
      ) : null}
      <ConversationScopeActionDialog
        open={Boolean(pendingArchiveChat)}
        action="archive"
        conversationTitle={pendingArchiveChat?.title ?? 'conversation'}
        canApplyToEveryone={canApplyToEveryone}
        busy={archiveBusy}
        error={archiveError}
        onOpenChange={(open) => {
          if (!open && !archiveBusy) closeArchiveDialog()
        }}
        onSelect={(scope) => {
          if (pendingArchiveChat) void archiveChat(pendingArchiveChat, scope)
        }}
      />
    </>
  )
}
