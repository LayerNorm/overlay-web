'use client'

import { useCallback, useEffect, useState, type MouseEvent } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Archive, Bell, Hash, Loader2, MessageSquare, RotateCcw, UsersRound } from 'lucide-react'
import { SidebarResourceList, SidebarResourceRow } from '@overlay/ui/primitives'
import { overlayAppClient } from '@/shared/app/overlay-app-client'
import { dispatchCollaborationNotificationsChanged } from '@/shared/chat/collaboration-events'
import { conversationActivityLabel } from '@/shared/chat/conversation-activity-state'
import {
  CHAT_ARCHIVED_EVENT,
  dispatchChatModified,
  type ChatArchivedDetail,
} from '@/shared/chat/chat-title'
import {
  buildWorkspaceHref,
  readWorkspaceIdFromPath,
} from '@/features/workspaces/lib/workspace-routing'
import type { WorkspaceNotification } from '@overlay/workspace-contracts'

/**
 * Sidebar lists for the Chats subviews that are not conversation list.
 *
 * Activity and Archived are their own routes, but the secondary panel kept
 * rendering the chat list underneath them, so selecting either left the sidebar
 * showing something unrelated to the page beside it.
 */

function unwrapList<T>(body: unknown): T[] {
  if (Array.isArray(body)) return body as T[]
  if (body && typeof body === 'object' && Array.isArray((body as { data?: unknown }).data)) {
    return (body as { data: T[] }).data
  }
  return []
}

function PanelState({ icon, message }: { icon: React.ReactNode; message: string }) {
  return (
    <div className="flex flex-col items-center gap-2 px-3 py-8 text-center text-xs text-[var(--muted)]">
      {icon}
      <span>{message}</span>
    </div>
  )
}

type ActivityNotification = Pick<
  WorkspaceNotification,
  'id' | 'title' | 'body' | 'createdAt' | 'readAt' | 'conversationId' | 'messageId' | 'conversationState'
>

function viewForConversationType(conversationType?: string): 'personal' | 'dms' | 'channels' {
  if (conversationType === 'channel') return 'channels'
  if (conversationType === 'dm') return 'dms'
  return 'personal'
}

export function ActivityInlinePanel({ onNavigate }: { onNavigate?: () => void }) {
  const router = useRouter()
  const pathname = usePathname() ?? ''
  const [items, setItems] = useState<ActivityNotification[] | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const activity = await overlayAppClient.conversations.notifications({ filter: 'all', limit: 50 })
        if (cancelled) return
        setItems(Array.isArray(activity?.notifications) ? activity.notifications : [])
      } catch {
        if (!cancelled) setItems([])
      }
    })()
    return () => { cancelled = true }
  }, [])

  async function openNotification(item: ActivityNotification) {
    onNavigate?.()
    if (!item.conversationId) return
    if (item.conversationState === 'archived') {
      const workspaceId = readWorkspaceIdFromPath(pathname)
      const archivedBase = workspaceId
        ? buildWorkspaceHref(workspaceId, '/app/archived')
        : '/app/archived'
      router.push(`${archivedBase}?id=${encodeURIComponent(item.conversationId)}`)
      return
    }
    if (!item.readAt) {
      void overlayAppClient.conversations.markNotificationsRead([item.id])
        .then(() => dispatchCollaborationNotificationsChanged())
        .catch(() => undefined)
      setItems((current) => current?.map((row) => row.id === item.id ? { ...row, readAt: Date.now() } : row) ?? null)
    }
    let view: 'personal' | 'dms' | 'channels' = 'personal'
    try {
      const conversation = await overlayAppClient.conversations.get<{
        conversationType?: 'personal' | 'dm' | 'channel'
      }>({ conversationId: item.conversationId }).catch(() => null)
      view = viewForConversationType(conversation?.conversationType)
    } catch {
      // Fall back to personal so we still route somewhere usable.
    }
    const query = new URLSearchParams({ view, id: item.conversationId })
    if (item.messageId) query.set('message', item.messageId)
    router.push(`/app/chat?${query.toString()}`)
  }

  if (items === null) {
    return <PanelState icon={<Loader2 size={15} className="animate-spin" />} message="Loading activity…" />
  }
  if (items.length === 0) {
    return <PanelState icon={<Bell size={16} />} message="No activity yet." />
  }

  return (
    <SidebarResourceList>
      {items.map((item) => (
        <SidebarResourceRow
          key={item.id}
          onClick={() => void openNotification(item)}
          className="cursor-pointer"
        >
          <Bell size={12} className="shrink-0" aria-hidden />
          <span className="min-w-0 flex-1 truncate">
            {item.title?.trim() || 'Notification'}
          </span>
          {conversationActivityLabel(item.conversationState) ? (
            <span className="shrink-0 text-[10px] text-[var(--muted-light)]">
              {conversationActivityLabel(item.conversationState)}
            </span>
          ) : null}
          {!item.readAt ? (
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--muted)]" aria-label="Unread" />
          ) : null}
        </SidebarResourceRow>
      ))}
    </SidebarResourceList>
  )
}

type ArchivedConversation = {
  _id: string
  title?: string | null
  conversationType?: string
}

export function ArchivedInlinePanel({ onNavigate }: { onNavigate?: () => void }) {
  const router = useRouter()
  const pathname = usePathname() ?? ''
  const searchParams = useSearchParams()
  const [items, setItems] = useState<ArchivedConversation[] | null>(null)
  const activeId = searchParams?.get('id')
    ?? (typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get('id'))
  const archivedBase = (() => {
    const workspaceId = readWorkspaceIdFromPath(pathname)
    return workspaceId ? buildWorkspaceHref(workspaceId, '/app/archived') : '/app/archived'
  })()

  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/v1/conversations?archived=true', {
        cache: 'no-store',
        credentials: 'same-origin',
      })
      if (!response.ok) throw new Error('failed')
      setItems(unwrapList<ArchivedConversation>(await response.json()))
    } catch {
      setItems([])
    }
  }, [])

  useEffect(() => { void load() }, [load])

  useEffect(() => {
    function handleChatArchived(event: Event) {
      const archived = (event as CustomEvent<ChatArchivedDetail>).detail?.chat
      if (!archived?._id) return
      setItems((current) => {
        const next = current ?? []
        if (next.some((conversation) => conversation._id === archived._id)) return next
        return [{
          _id: archived._id,
          title: archived.title,
          conversationType: archived.conversationType,
        }, ...next]
      })
    }
    window.addEventListener(CHAT_ARCHIVED_EVENT, handleChatArchived)
    return () => window.removeEventListener(CHAT_ARCHIVED_EVENT, handleChatArchived)
  }, [])

  function openArchived(conversation: ArchivedConversation) {
    onNavigate?.()
    const href = `${archivedBase}?id=${encodeURIComponent(conversation._id)}`
    if (pathname.includes('/archived')) {
      window.history.pushState(null, '', href)
      window.dispatchEvent(new CustomEvent('overlay:chat-route-selected', {
        detail: { chatId: conversation._id },
      }))
    }
    router.push(href)
  }

  async function restore(conversation: ArchivedConversation, event: MouseEvent<HTMLButtonElement>) {
    event.stopPropagation()
    try {
      await overlayAppClient.conversations.updateParticipantState(conversation._id, { archived: false })
      setItems((current) => current?.filter((item) => item._id !== conversation._id) ?? null)
      dispatchChatModified({
        chat: {
          _id: conversation._id,
          title: conversation.title?.trim() || 'Untitled conversation',
          lastModified: Date.now(),
          conversationType: conversation.conversationType === 'channel' || conversation.conversationType === 'dm'
            ? conversation.conversationType
            : 'personal',
        },
      })
      const view = viewForConversationType(conversation.conversationType)
      const workspaceId = readWorkspaceIdFromPath(pathname)
      const chatBase = workspaceId ? buildWorkspaceHref(workspaceId, '/app/chat') : '/app/chat'
      router.push(`${chatBase}?${new URLSearchParams({ view, id: conversation._id }).toString()}`)
    } catch {
      void load()
    }
  }

  if (items === null) {
    return <PanelState icon={<Loader2 size={15} className="animate-spin" />} message="Loading archived…" />
  }
  if (items.length === 0) {
    return <PanelState icon={<Archive size={16} />} message="Nothing archived." />
  }

  return (
    <SidebarResourceList>
      {items.map((conversation) => (
        <SidebarResourceRow
          key={conversation._id}
          active={activeId === conversation._id}
          onClick={() => openArchived(conversation)}
          className="cursor-pointer"
        >
          {conversation.conversationType === 'channel' ? (
            <Hash size={12} className="shrink-0" aria-hidden />
          ) : conversation.conversationType === 'dm' ? (
            <UsersRound size={12} className="shrink-0" aria-hidden />
          ) : (
            <MessageSquare size={12} className="shrink-0" aria-hidden />
          )}
          <span className="min-w-0 flex-1 truncate">
            {conversation.title?.trim() || 'Untitled conversation'}
          </span>
          <button
            type="button"
            onClick={(event) => void restore(conversation, event)}
            className="ml-1 shrink-0 rounded p-0.5 opacity-0 transition-opacity hover:bg-[var(--border)] group-hover:opacity-100"
            aria-label={`Restore ${conversation.title?.trim() || 'conversation'}`}
          >
            <RotateCcw size={11} />
          </button>
        </SidebarResourceRow>
      ))}
    </SidebarResourceList>
  )
}
