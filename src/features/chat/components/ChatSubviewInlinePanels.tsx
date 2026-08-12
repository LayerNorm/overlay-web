'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Archive, Bell, Hash, Loader2, MessageSquare, UsersRound } from 'lucide-react'
import { SidebarResourceList, SidebarResourceRow } from '@overlay/ui/primitives'
import { overlayAppClient } from '@/shared/app/overlay-app-client'
import { dispatchCollaborationNotificationsChanged } from '@/shared/chat/collaboration-events'

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

type ActivityNotification = {
  id: string
  title?: string
  body?: string
  createdAt?: number
  readAt?: number | null
  conversationId?: string
  messageId?: string
}

function viewForConversationType(conversationType?: string): 'personal' | 'dms' | 'channels' {
  if (conversationType === 'channel') return 'channels'
  if (conversationType === 'dm') return 'dms'
  return 'personal'
}

export function ActivityInlinePanel({ onNavigate }: { onNavigate?: () => void }) {
  const router = useRouter()
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
  const [items, setItems] = useState<ArchivedConversation[] | null>(null)

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

  if (items === null) {
    return <PanelState icon={<Loader2 size={15} className="animate-spin" />} message="Loading archived…" />
  }
  if (items.length === 0) {
    return <PanelState icon={<Archive size={16} />} message="Nothing archived." />
  }

  return (
    <SidebarResourceList>
      {items.map((conversation) => {
        const view = viewForConversationType(conversation.conversationType)
        return (
          <SidebarResourceRow
            key={conversation._id}
            onClick={() => {
              onNavigate?.()
              const query = new URLSearchParams({ view, id: conversation._id })
              router.push(`/app/chat?${query.toString()}`)
            }}
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
            <Archive size={11} className="shrink-0 opacity-40" aria-hidden />
          </SidebarResourceRow>
        )
      })}
    </SidebarResourceList>
  )
}
