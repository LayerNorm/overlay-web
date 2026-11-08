'use client'

import { useState, useCallback, useEffect, useEffectEvent, useMemo, type Dispatch, type MouseEvent, type SetStateAction } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useConvexAuth, useQuery } from 'convex/react'
import { api } from '../../../../convex/_generated/api'
import { useWorkspaceHref } from '@/hooks/use-workspace-href'
import { usePanelScope } from '@/hooks/use-panel-scope'
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
  mergeChatTitle,
  sanitizeChatTitle,
  type ChatArchivedDetail,
  type ChatCreatedDetail,
  type ChatDeletedDetail,
  type ChatTitleUpdatedDetail,
} from '@/shared/chat/chat-title'
import { NEW_CHANNEL_EVENT, NEW_DIRECT_MESSAGE_EVENT } from '@/shared/chat/collaboration-events'
import { clearLastChatForView, rememberLastChatForView } from '@/shared/chat/last-chat-by-view'
import { overlayAppClient } from '@/shared/app/overlay-app-client'
import { announceArchived } from '@/shared/app/archive-toast'
import {
  Button,
  Input,
  SidebarMenuAction,
  SidebarMenuBadge,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  toast,
} from '@overlay/ui/primitives'
import { cn } from '@overlay/ui'
import { useAuth, type AuthUser } from '@/contexts/AuthContext'
import { NewDirectMessageDialog } from './NewDirectMessageDialog'
import { NewChannelDialog } from './NewChannelDialog'
import {
  isSameChatSurface,
  legacyWorkspaceScopeForRoute,
  mergeHrefSearchParams,
  normalizeChatViewForScope,
  readWorkspacePathScope,
} from '@/shared/workspaces/routing'
import { agentThreadHref } from '@/components/layout/sidebar-nav'
import { useCollaborationRealtime } from './collaboration/CollaborationRealtimeProvider'
import { ConversationScopeActionDialog } from './collaboration/ConversationScopeActionDialog'
import { useWorkspace } from '@/contexts/WorkspaceContext'
import { usePersonalChat, type PersonalChatSummary } from '@/components/providers/PersonalChatProvider'
import { excludeNativePersonalChats, isNativePersonalChatCandidate } from '@/shared/chat/native-personal-chat'
import type { WorkspaceNotification } from '@overlay/workspace-contracts'

type Conversation = {
  _id: string
  title: string
  lastModified: number
  conversationType?: 'personal' | 'dm' | 'channel'
  scope?: 'personal' | 'workspace'
  workspaceId?: string
  archivedAt?: number
  unread?: boolean
  lastMessageId?: string
  otherParticipantTypes?: Array<'human' | 'agent'>
  externalPlatform?: string
}

/** `workspace-chats` lists the AI chats filed under Workspace; `personal` lists the rest. */
export type ChatView = 'personal' | 'workspace-chats' | 'dms' | 'channels' | 'all'

function isAiChatInView(chat: Pick<Conversation, 'conversationType' | 'scope'>, view: 'personal' | 'workspace-chats'): boolean {
  if ((chat.conversationType ?? 'personal') !== 'personal') return false
  return (chat.scope ?? 'personal') === (view === 'workspace-chats' ? 'workspace' : 'personal')
}

export function sectionChatView(view: string): ChatView | undefined {
  return view === 'personal' || view === 'workspace-chats' || view === 'dms' || view === 'channels' ? view : undefined
}

function chatInView(chat: Pick<Conversation, 'conversationType' | 'scope'>, view: ChatView): boolean {
  if (view === 'personal' || view === 'workspace-chats') return isAiChatInView(chat, view)
  if (view === 'dms') return chat.conversationType === 'dm'
  if (view === 'channels') return chat.conversationType === 'channel'
  return true
}

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

  user,
  collaborationNotifications,
}: {
  workspaceId: string | null | undefined

  user: AuthUser | null
  collaborationNotifications: WorkspaceNotification[]
}) {
  // Derived from live notifications: marking a room read updates them, so badges follow.
  return useMemo(() => {
    const counts: Record<string, number> = {}
    if (!workspaceId || !user) return counts
    for (const notification of collaborationNotifications) {
      if (notification.readAt || !notification.conversationId) continue
      counts[notification.conversationId] = (counts[notification.conversationId] ?? 0) + 1
    }
    return counts
  }, [collaborationNotifications, user, workspaceId])
}

const ROOM_KIND = { dms: 'dm', channels: 'channel', all: 'all' } as const
const ROOM_PAGE = 50
const NO_ROOMS: Conversation[] = []

/**
 * The channel and DM list for the sidebar, live from `collaboration/roomList:list`: new messages, renames, new rooms,
 * joins, leaves and archives in any tab arrive without fetching, retrying or version-triggered refetches. Local
 * optimistic edits (a delete animation, an archive) apply to `chats` and the next live snapshot replaces them.
 */
/** The live room list for one workspace and view, a page at a time; earlier rows stay on screen while more load. */
function useRoomListPage({ enabled, workspaceId, kind }: {
  enabled: boolean
  workspaceId: string | null | undefined
  kind: 'dm' | 'channel' | 'all' | null
}) {
  // The page grows with "Load more" and starts over when the workspace or view changes.
  const pageKey = `${workspaceId ?? ''}:${kind ?? ''}`
  const [page, setPage] = useState({ key: pageKey, limit: ROOM_PAGE })
  const limit = page.key === pageKey ? page.limit : ROOM_PAGE
  const result = useQuery(api.collaboration.roomList.list, enabled ? { workspaceId: workspaceId!, kind: kind!, limit } : 'skip') as
    { rooms: Conversation[]; hasMore: boolean } | null | undefined
  // While a bigger page loads, the rows already on screen for this workspace and view stay.
  const [lastPage, setLastPage] = useState<{ key: string; rooms: Conversation[]; hasMore: boolean } | null>(null)
  // A denied read (null) shows no rooms; the shared empty array keeps this from re-syncing on every render.
  const current = enabled && result !== undefined ? { key: pageKey, rooms: result?.rooms ?? NO_ROOMS, hasMore: Boolean(result?.hasMore) } : null
  if (current && (lastPage?.key !== pageKey || lastPage.rooms !== current.rooms)) setLastPage(current)
  const visible = current ?? (enabled && lastPage?.key === pageKey ? lastPage : null)
  const loadingMore = enabled && result === undefined && visible !== null
  const loadMoreChats = useCallback(() => {
    setPage({ key: pageKey, limit: limit + ROOM_PAGE })
  }, [limit, pageKey])
  return { visible, loadingMore, loadMoreChats }
}

function useChatListData({
  authLoading,
  chatView,
  nativePersonalView,
  user,
  workspaceId,
}: {
  authLoading: boolean
  chatView: ChatView
  nativePersonalView: boolean
  user: AuthUser | null
  workspaceId: string | null | undefined
}) {
  const { isAuthenticated, isLoading } = useConvexAuth()
  const kind = chatView === 'dms' || chatView === 'channels' || chatView === 'all' ? ROOM_KIND[chatView] : null
  const enabled = Boolean(!nativePersonalView && kind && workspaceId && user && !authLoading && isAuthenticated && !isLoading)
  const { visible, loadingMore, loadMoreChats } = useRoomListPage({ enabled, workspaceId, kind })
  const [chats, setChats] = useState<Conversation[]>(() => [])
  const [loading, setLoading] = useState(true)
  const [syncedFrom, setSyncedFrom] = useState<{ rooms: Conversation[] | null; enabled: boolean } | null>(null)
  const visibleRooms = visible?.rooms ?? null
  if (!syncedFrom || syncedFrom.rooms !== visibleRooms || syncedFrom.enabled !== enabled) {
    setSyncedFrom({ rooms: visibleRooms, enabled })
    setChats(visibleRooms ?? [])
    setLoading(enabled ? visible === null : !nativePersonalView && authLoading)
  }
  return { chats, setChats, loading, setLoading, hasMore: Boolean(visible?.hasMore), loadingMore, loadMoreChats }
}

function useChatListEvents({
  currentChats,
  activeId,
  baseHref,
  chatView,
  nativePersonalIds,
  nativePersonalView,
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
  nativePersonalIds: ReadonlySet<string>
  nativePersonalView: boolean
  openChat: (chat: Conversation) => void
  pathname: string
  router: ReturnType<typeof useRouter>
  user: AuthUser | null
  workspaceId: string | null | undefined
  setChats: Dispatch<SetStateAction<Conversation[]>>
  setLoading: Dispatch<SetStateAction<boolean>>
  /** The rooms list as shown, for picking the next room after the open one is archived. */
  currentChats: readonly Conversation[]
}) {
  const [deletingChatIds, setDeletingChatIds] = useState<string[]>([])

  const removeActiveChat = useCallback((chatId: string) => {
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
      if (nativePersonalView || isNativePersonalChatCandidate(nextChat, workspaceId)) return
      setLoading(false)
      setChats((prev) => {
        const existingIndex = prev.findIndex((chat) => chat._id === nextChat._id)
        if (existingIndex === -1) return [nextChat, ...prev]
        const existing = prev[existingIndex]
        const merged = {
          ...existing,
          ...nextChat,
          title: mergeChatTitle(existing.title, nextChat.title),
        }
        const withoutExisting = prev.filter((chat) => chat._id !== nextChat._id)
        return [merged, ...withoutExisting]
      })
    })

    const handleChatTitleUpdated = useEffectEvent((event: Event) => {
      const { detail } = event as CustomEvent<ChatTitleUpdatedDetail>
      if (!detail?.chatId || !detail.title) return
      if (nativePersonalView || nativePersonalIds.has(detail.chatId)) return
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
      if (nativePersonalView || isNativePersonalChatCandidate(detail.chat, workspaceId)) return
      removeActiveChat(archivedChatId)
      clearLastChatForView(workspaceId, chatView, archivedChatId)
      if (activeId !== archivedChatId) return
      if (!chatInView(detail.chat, chatView)) return
      const nextChat = currentChats.find((candidate) => {
        if (candidate._id === archivedChatId) return false
        if (chatView === 'personal' || chatView === 'workspace-chats') return isAiChatInView(candidate, chatView)
        if (chatView === 'dms') return candidate.conversationType === 'dm'
        if (chatView === 'channels') return candidate.conversationType === 'channel'
        return true
      })
      if (nextChat) {
        openChat(nextChat)
        return
      }
      const emptyHref = mergeHrefSearchParams(baseHref, new URLSearchParams({ view: chatView }))
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
  }, [
    activeId,
    baseHref,
    chatView,
    nativePersonalIds,
    nativePersonalView,
    openChat,
    pathname,
    router,
    setChats,
    setLoading,
    user,
    workspaceId,
  ])

  return deletingChatIds
}

function useChatRename({
  chats,
  getNativeSummary,
  renameNative,
  setChats,
}: {
  chats: Conversation[]
  getNativeSummary: (chatId: string) => PersonalChatSummary | undefined
  renameNative: (chatId: string, title: string) => Promise<void>
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

    const nativeSummary = getNativeSummary(chatId)
    if (nativeSummary) {
      try {
        await renameNative(nativeSummary._id, nextTitle)
      } catch {
        toast.error('Could not rename chat.')
      }
      return
    }

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
  activeChatId,
  getNativeSummary,
  navigateAwayFromArchivedChat,
  setNativeArchived,
  setEditingChatId,
}: {
  activeChatId: string | null
  getNativeSummary: (chatId: string) => PersonalChatSummary | undefined
  navigateAwayFromArchivedChat: (chatId: string) => void
  setNativeArchived: (summary: PersonalChatSummary, archived: boolean) => Promise<void>
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
    const nativeSummary = scope === 'self' ? getNativeSummary(chat._id) : undefined
    if (nativeSummary) {
      if (activeChatId === chat._id) navigateAwayFromArchivedChat(chat._id)
      const pendingArchive = setNativeArchived(nativeSummary, true)
      announceArchived({
        name: chat.title?.trim() || 'Untitled conversation',
        undo: () => setNativeArchived(nativeSummary, false),
      })
      setPendingArchiveChat(null)
      try {
        await pendingArchive
      } catch {
        toast.error('Conversation could not be archived.')
      } finally {
        setArchiveBusy(false)
      }
      return
    }
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

  onOpenChat: (chat: Conversation) => void
  onBeginRename: (chat: Conversation, event: MouseEvent<HTMLButtonElement>) => void
  onRequestArchive: (chat: Conversation, event: MouseEvent<HTMLButtonElement>) => void
  onEditingTitleChange: (value: string) => void
  onSaveRename: (chatId: string) => void
  onCancelRename: () => void
}) {
  const canRename = chat.conversationType !== 'dm' && chat.conversationType !== 'channel'
  const hoverAction = 'top-1.5 md:opacity-0 group-hover/menu-sub-item:opacity-100 group-focus-within/menu-sub-item:opacity-100'
  return (
    <SidebarMenuSubItem
      className={cn(
        'overflow-hidden transition-all duration-200',
        isDeleting ? 'max-h-0 -translate-y-1 opacity-0' : 'max-h-8 opacity-100',
      )}
    >
      {isEditing ? (
        <div className="flex h-7 min-w-0 items-center gap-2 px-2 text-xs text-(--muted)">
          <ChatConversationIcon chat={chat} size={12} className="shrink-0" />
          <Input
            aria-label="Conversation title"
            ref={(el) => { el?.focus() }}
            value={editingTitle}
            onChange={(event) => onEditingTitleChange(event.target.value)}
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
            className="h-auto min-w-0 flex-1 rounded-md border border-(--border) bg-(--surface-elevated) px-2 py-1 text-[11px] text-(--foreground) outline-hidden"
          />
          <Button
            variant="ghost"
            size="icon"
            type="button"
            onMouseDown={(event) => {
              event.preventDefault()
              event.stopPropagation()
              onSaveRename(chat._id)
            }}
            className="h-auto w-auto shrink-0 rounded-sm p-0.5 text-(--foreground) hover:bg-(--border)"
            aria-label="Save chat name"
          >
            <Check size={11} />
          </Button>
        </div>
      ) : (
        <>
          <SidebarMenuSubButton
            isActive={active}
            aria-current={active ? 'page' : undefined}
            onClick={() => { if (!isDeleting) onOpenChat(chat) }}
            className={cn('h-8 gap-2.5 text-sm', canRename ? 'pr-14' : 'pr-8')}
          >
            <ChatConversationIcon chat={chat} size={12} className="shrink-0" />
            <span className="flex-1 truncate">{chat.title}</span>
            {isStreaming && !unread ? (
              <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-(--muted)" />
            ) : null}
          </SidebarMenuSubButton>
          {unread > 0 ? (
            <SidebarMenuBadge className="top-1.5 group-hover/menu-sub-item:hidden group-focus-within/menu-sub-item:hidden">
              {unread > 9 ? '9+' : unread}
            </SidebarMenuBadge>
          ) : null}
          {(
            <>
              {canRename ? (
                <SidebarMenuAction
                  aria-label="Rename chat"
                  className={cn('right-7', hoverAction)}
                  onClick={(event) => onBeginRename(chat, event)}
                >
                  <Pencil aria-hidden />
                </SidebarMenuAction>
              ) : null}
              <SidebarMenuAction
                aria-label="Archive chat"
                className={cn('right-1', hoverAction)}
                onClick={(event) => onRequestArchive(chat, event)}
              >
                <Archive aria-hidden />
              </SidebarMenuAction>
            </>
          )}
        </>
      )}
    </SidebarMenuSubItem>
  )
}

function ChatListBody({
  loading,
  personalUnavailable,
  chatView,
  chats,
  searchQuery,
  activeId,
  editingChatId,
  deletingChatIds,
  sessions,
  getUnread,
  collaborationUnread,
  nativePersonalIds,
  editingTitle,

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
  personalUnavailable: boolean
  chatView: ChatView
  chats: Conversation[]
  searchQuery: string
  activeId: string | null
  editingChatId: string | null
  deletingChatIds: string[]
  sessions: ReturnType<typeof useAsyncSessions>['sessions']
  getUnread: ReturnType<typeof useAsyncSessions>['getUnread']
  collaborationUnread: ReturnType<typeof useCollaborationUnread>
  nativePersonalIds: ReadonlySet<string>
  editingTitle: string

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
  const viewChats = chatView === 'personal' || chatView === 'workspace-chats'
    ? chats.filter((chat) => isAiChatInView(chat, chatView))
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
    'workspace-chats': 'No workspace chats yet',
    dms: 'No direct messages yet',
    channels: 'No channels yet',
    all: 'No chats yet',
  }[chatView]
  const deletingChatIdSet = new Set(deletingChatIds)
  const listClassName = 'ml-0 border-l-0 pl-0'
  if (loading) {
    return (
      <SidebarMenuSub className={listClassName}>
        <SidebarListSkeleton rows={6} />
      </SidebarMenuSub>
    )
  }
  if (filteredChats.length === 0) {
    return (
      <SidebarMenuSub className={listClassName}>
        <SidebarMenuSubItem>
          <p className="px-2 py-1.5 text-xs text-(--muted-light)">
            {personalUnavailable
              ? 'Personal chats are unavailable'
              : viewChats.length === 0 ? emptyLabel : 'No results'}
          </p>
        </SidebarMenuSubItem>
        {hasMore ? (
          <SidebarMenuSubItem>
            <Button
              variant="ghost"
              type="button"
              disabled={loadingMore}
              onClick={() => void loadMoreChats()}
              className="h-7 w-full justify-start rounded-md px-2.5 text-left text-xs font-normal text-(--muted-light) transition-colors hover:bg-(--surface-subtle) hover:text-(--foreground) disabled:cursor-wait disabled:opacity-60"
            >
              {loadingMore ? 'Loading...' : 'Load more'}
            </Button>
          </SidebarMenuSubItem>
        ) : null}
      </SidebarMenuSub>
    )
  }
  return (
    <SidebarMenuSub className={listClassName}>
      <>
          {personalUnavailable ? (
            <SidebarMenuSubItem>
              <p role="alert" className="px-2 py-1.5 text-xs text-(--muted-light)">
                Personal chats are unavailable
              </p>
            </SidebarMenuSubItem>
          ) : null}
          {filteredChats.map((chat) => (
            <ChatListRow
              key={chat._id}
              chat={chat}
              active={activeId === chat._id}
              isEditing={editingChatId === chat._id}
              isDeleting={deletingChatIdSet.has(chat._id)}
              isStreaming={sessions[chat._id]?.status === 'streaming'}
              unread={nativePersonalIds.has(chat._id)
                ? (chat.unread ? 1 : 0)
                : Math.max(getUnread(chat._id), collaborationUnread[chat._id] ?? 0)}
              editingTitle={editingTitle}

              onOpenChat={openChat}
              onBeginRename={beginRename}
              onRequestArchive={requestArchive}
              onEditingTitleChange={setEditingTitle}
              onSaveRename={(chatId) => void saveRename(chatId)}
              onCancelRename={cancelRename}
            />
          ))}
          {hasMore ? (
            <SidebarMenuSubItem>
            <Button
              variant="ghost"
              type="button"
              disabled={loadingMore}
              onClick={() => void loadMoreChats()}
              className="h-7 w-full justify-start rounded-md px-2.5 text-left text-xs font-normal text-(--muted-light) transition-colors hover:bg-(--surface-subtle) hover:text-(--foreground) disabled:cursor-wait disabled:opacity-60"
            >
              {loadingMore ? 'Loading...' : 'Load more'}
            </Button>
            </SidebarMenuSubItem>
          ) : null}
        </>
    </SidebarMenuSub>
  )
}

function useChatPanelRoute({
  baseHref,
  workspaceId,
  sectionView,
}: {
  baseHref: string
  workspaceId?: string | null
  sectionView?: ChatView
}) {
  const buildWorkspaceHref = useWorkspaceHref()
  const pathname = usePathname() ?? ''
  const searchParams = useSearchParams()
  const rememberedScope = usePanelScope()
  useBrowserRouteVersion()
  const searchActiveId = searchParams?.get('id') ?? null
  const browserActiveId = typeof window === 'undefined'
    ? null
    : new URLSearchParams(window.location.search).get('id')
  const activeId = browserActiveId ?? searchActiveId
  const requestedView = searchParams?.get('view') ?? null
  const legacyScope = legacyWorkspaceScopeForRoute(
    'chat',
    new URLSearchParams(searchParams?.toString() ?? ''),
  )
  const routeScope = readWorkspacePathScope(pathname) ?? legacyScope ?? rememberedScope
  const chatView: ChatView = sectionView ?? (
    requestedView === 'all' && !readWorkspacePathScope(pathname) && !legacyScope
      ? 'all'
      : normalizeChatViewForScope(routeScope, requestedView)
  )
  const viewScope = chatView === 'dms' || chatView === 'channels' || chatView === 'workspace-chats'
    ? 'workspace'
    : 'personal'
  const scopedBaseHref = buildWorkspaceHref(workspaceId ?? null, baseHref, viewScope)
  return { activeId, buildWorkspaceHref, chatView, pathname, scopedBaseHref }
}

export function ChatInlinePanel({
  searchQuery = '',
  onNavigate,
  baseHref = '/app/chat',
  workspaceId,
  view: sectionView,
}: {
  searchQuery?: string
  onNavigate?: () => void
  baseHref?: string
  workspaceId?: string | null
  /** Pins the list to one view (a sidebar section) instead of following the route. */
  view?: ChatView
}) {
  const router = useRouter()
  const { activeWorkspace } = useWorkspace()
  const { sessions, getUnread } = useAsyncSessions()
  const { user, isLoading: authLoading } = useAuth()
  const { notifications: collaborationNotifications } = useCollaborationRealtime()
  const nativePersonal = usePersonalChat()
  const nativePersonalOwner = Boolean(user) || authLoading
  const { activeId, buildWorkspaceHref, chatView, pathname, scopedBaseHref } = useChatPanelRoute({
    baseHref, workspaceId, sectionView,
  })

  // Same-surface switches update history directly and tell the conversation
  // router to re-read the URL; `router.push` alone leaves the pane rendering
  // the previous room until Next commits its own history update.
  const navigateChatHref = useCallback((href: string, detail: { chatId: string | null; view: string }) => {
    if (isSameChatSurface(pathname, baseHref)) {
      window.history.pushState(null, '', href)
      window.dispatchEvent(new CustomEvent('overlay:chat-route-selected', { detail }))
    } else {
      router.push(href)
    }
  }, [baseHref, pathname, router])

  const openChat = useCallback((chat: Conversation) => {
    const targetView = chat.conversationType === 'channel'
      ? 'channels'
      : chat.conversationType === 'dm'
        ? 'dms'
        : chat.scope === 'workspace' ? 'workspace-chats' : 'personal'
    const targetScope = targetView === 'dms' || targetView === 'channels' || targetView === 'workspace-chats'
      ? 'workspace'
      : 'personal'
    const targetBaseHref = buildWorkspaceHref(workspaceId ?? null, baseHref, targetScope)
    rememberLastChatForView(workspaceId, targetView, chat._id)
    const href = mergeHrefSearchParams(targetBaseHref, new URLSearchParams({
      ...({}),
      view: targetView,
      id: chat._id,
    }))
    // Soft-navigate on the same chat surface so Next does not remount the app
    // shell (and WorkspaceProvider) on every switch.
    navigateChatHref(href, { chatId: chat._id, view: targetView })
    onNavigate?.()
  }, [baseHref, buildWorkspaceHref, navigateChatHref, onNavigate, workspaceId])

  const {
    newDirectMessageOpen,
    setNewDirectMessageOpen,
    newChannelOpen,
    setNewChannelOpen,
  } = useNewConversationDialogs(chatView, workspaceId)
  const collaborationUnread = useCollaborationUnread({
    workspaceId,

    user,
    collaborationNotifications,
  })
  const {
    chats: legacyChats,
    setChats,
    loading,
    setLoading,
    hasMore,
    loadingMore,
    loadMoreChats,
  } = useChatListData({
    authLoading,
    chatView,
    nativePersonalView: nativePersonalOwner && (chatView === 'personal' || chatView === 'workspace-chats'),
    user,
    workspaceId,
  })
  const nativePersonalView = nativePersonalOwner && (chatView === 'personal' || chatView === 'workspace-chats')
  const nativePersonalRelevant = nativePersonalView || (nativePersonalOwner && chatView === 'all')
  const nativeWorkspaceReady = !nativePersonalOwner || Boolean(nativePersonal.workspaceId)
  const nativePersonalIds = useMemo(() => nativePersonalOwner ? new Set([
    ...nativePersonal.active.rows.map((chat) => chat._id),
    ...nativePersonal.archived.rows.map((chat) => chat._id),
    ...(nativePersonal.selectedSummary ? [nativePersonal.selectedSummary._id] : []),
  ]) : new Set<string>(), [
    nativePersonal.active.rows,
    nativePersonal.archived.rows,
    nativePersonal.selectedSummary,
    nativePersonalOwner,
  ])
  const getNativeSummary = useCallback((chatId: string) => (
    nativePersonalOwner
      ? nativePersonal.active.rows.find((chat) => chat._id === chatId)
        ?? nativePersonal.archived.rows.find((chat) => chat._id === chatId)
        ?? (nativePersonal.selectedSummary?._id === chatId ? nativePersonal.selectedSummary : undefined)
        ?? undefined
      : undefined
  ), [
    nativePersonal.active.rows,
    nativePersonal.archived.rows,
    nativePersonal.selectedSummary,
    nativePersonalOwner,
  ])
  const roomChats = useMemo(() => nativeWorkspaceReady
    ? excludeNativePersonalChats(legacyChats, workspaceId)
      .filter((chat) => !chat.workspaceId || chat.workspaceId === (nativePersonalOwner ? nativePersonal.workspaceId : workspaceId))
    : [], [legacyChats, nativePersonal.workspaceId, nativePersonalOwner, nativeWorkspaceReady, workspaceId])
  const chats: Conversation[] = useMemo(() => !nativeWorkspaceReady
    ? []
    : nativePersonalRelevant
      ? nativePersonalView
        ? nativePersonal.active.rows
        : [...nativePersonal.active.rows, ...roomChats]
      : legacyChats, [
    legacyChats,
    nativePersonal.active.rows,
    nativePersonalRelevant,
    nativePersonalView,
    nativeWorkspaceReady,
    roomChats,
  ])
  const listLoading = !nativeWorkspaceReady || (nativePersonalView
    ? nativePersonal.active.status === 'loading'
    : loading || (nativePersonalRelevant && nativePersonal.active.status === 'loading'))
  const listUnavailable = nativePersonalRelevant && nativePersonal.active.status === 'unavailable'
  const listHasMore = nativePersonalView
    ? nativePersonal.active.hasMore
    : hasMore || (chatView === 'all' && nativePersonalOwner && nativePersonal.active.hasMore)
  const listLoadingMore = nativePersonalView
    ? nativePersonal.active.loadingMore
    : loadingMore || (chatView === 'all' && nativePersonalOwner && nativePersonal.active.loadingMore)
  const loadMoreVisibleChats = async () => {
    if (!nativeWorkspaceReady) return
    if (nativePersonalView) {
      nativePersonal.active.loadMore()
      return
    }
    if (chatView === 'all' && nativePersonalOwner) nativePersonal.active.loadMore()
    if (hasMore) loadMoreChats()
  }
  const deletingChatIds = useChatListEvents({
    activeId,
    baseHref: scopedBaseHref,
    chatView,
    nativePersonalIds,
    nativePersonalView,
    openChat,
    pathname,
    router,
    user,
    workspaceId: nativePersonalOwner ? workspaceId : null,
    setChats,
    setLoading,
    currentChats: legacyChats,
  })
  const {
    editingChatId,
    editingTitle,
    setEditingChatId,
    setEditingTitle,
    beginRename,
    cancelRename,
    saveRename,
  } = useChatRename({
    chats,
    getNativeSummary,
    renameNative: nativePersonal.rename,
    setChats,
  })
  const navigateAwayFromArchivedChat = useCallback((archivedId: string) => {
    const isArchivedRoute = pathname === '/app/archived'
      || pathname.startsWith('/app/archived/')
      || pathname.endsWith('/archived')
    if (activeId !== archivedId
      || isArchivedRoute) return
    const nextChat = chats.find((candidate) => candidate._id !== archivedId && (
      chatView === 'personal' || chatView === 'workspace-chats'
        ? isAiChatInView(candidate, chatView)
        : chatView === 'dms'
          ? candidate.conversationType === 'dm'
          : chatView === 'channels'
            ? candidate.conversationType === 'channel'
            : true
    ))
    clearLastChatForView(workspaceId, chatView, archivedId)
    if (nextChat) {
      openChat(nextChat)
      return
    }
    const emptyHref = mergeHrefSearchParams(scopedBaseHref, new URLSearchParams({ view: chatView }))
    if (isSameChatSurface(pathname, baseHref)) {
      window.history.pushState(null, '', emptyHref)
      window.dispatchEvent(new CustomEvent('overlay:chat-route-selected', {
        detail: { chatId: null, view: chatView },
      }))
    } else {
      router.push(emptyHref)
    }
  }, [
    activeId,
    baseHref,
    chatView,
    chats,
    openChat,
    pathname,
    router,
    scopedBaseHref,
    workspaceId,
  ])
  const {
    pendingArchiveChat,
    closeArchiveDialog,
    archiveBusy,
    archiveError,
    requestArchive,
    archiveChat,
  } = useChatArchive({
    activeChatId: activeId,
    getNativeSummary,
    navigateAwayFromArchivedChat,
    setNativeArchived: nativePersonal.setArchived,
    setEditingChatId,
  })

  useEffect(() => {
    const archived = nativePersonal.selectedSummary
    if (!archived?.archivedAt) return
    navigateAwayFromArchivedChat(archived._id)
  }, [navigateAwayFromArchivedChat, nativePersonal.selectedSummary])

  return (
    <>
    <ChatListBody
      loading={listLoading}
      personalUnavailable={listUnavailable}
      chatView={chatView}
      chats={chats}
      searchQuery={searchQuery}
      activeId={activeId}
      editingChatId={editingChatId}
      deletingChatIds={deletingChatIds}
      sessions={sessions}
      getUnread={getUnread}
      collaborationUnread={collaborationUnread}
      nativePersonalIds={nativePersonalIds}
      editingTitle={editingTitle}

      hasMore={listHasMore}
      loadingMore={listLoadingMore}
      loadMoreChats={loadMoreVisibleChats}
      openChat={openChat}
      beginRename={beginRename}
      requestArchive={requestArchive}
      setEditingTitle={setEditingTitle}
      saveRename={saveRename}
      cancelRename={cancelRename}
    />
    <ChatListDialogs
      workspaceId={workspaceId}
      buildHref={buildWorkspaceHref}
      navigateChatHref={navigateChatHref}
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
  buildHref,
  navigateChatHref,
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
  buildHref: ReturnType<typeof useWorkspaceHref>
  navigateChatHref: (href: string, detail: { chatId: string | null; view: string }) => void
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
            if (agentId) {
              router.push(agentThreadHref(buildHref(workspaceId, '/app/agents'), agentId, id))
            } else {
              navigateChatHref(buildHref(
                workspaceId,
                `/app/chat?${new URLSearchParams({ view: 'dms', id, draft: '1', title }).toString()}`,
                'workspace',
              ), { chatId: id, view: 'dms' })
            }
            onNavigate?.()
          }}
        />
      ) : null}
      {workspaceId ? (
        <NewChannelDialog
          open={newChannelOpen}
          workspaceId={workspaceId}

          onOpenChange={setNewChannelOpen}
          onCreated={({ id, title }) => {
            navigateChatHref(buildHref(
              workspaceId ?? null,
              `/app/chat?${new URLSearchParams({ view: 'channels', id, title }).toString()}`,
              'workspace',
            ), { chatId: id, view: 'channels' })
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
