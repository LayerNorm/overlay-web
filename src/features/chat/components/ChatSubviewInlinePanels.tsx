'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Archive, Bell, Loader2 } from 'lucide-react'
import { overlayAppClient } from '@/shared/app/overlay-app-client'

/**
 * Sidebar lists for the Chats subviews that are not conversation lists.
 *
 * Activity and Archived are their own routes, but the secondary panel kept
 * rendering the chat list underneath them, so selecting either left the sidebar
 * showing something unrelated to the page beside it.
 */

const rowClass =
  'flex w-full items-start gap-2 rounded-md px-2 py-2 text-left text-sm text-[var(--muted)] transition-colors hover:bg-[var(--surface-subtle)] hover:text-[var(--foreground)]'

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

  if (items === null) {
    return <PanelState icon={<Loader2 size={15} className="animate-spin" />} message="Loading activity…" />
  }
  if (items.length === 0) {
    return <PanelState icon={<Bell size={16} />} message="No activity yet." />
  }

  return (
    <div className="space-y-0.5 px-1">
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          className={rowClass}
          onClick={() => {
            onNavigate?.()
            if (item.conversationId) router.push(`/app/chat?id=${encodeURIComponent(item.conversationId)}`)
          }}
        >
          {!item.readAt ? (
            <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--muted)]" aria-label="Unread" />
          ) : (
            <span className="mt-1.5 h-1.5 w-1.5 shrink-0" aria-hidden />
          )}
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] text-[var(--foreground)]">
              {item.title?.trim() || 'Notification'}
            </span>
            {item.body?.trim() ? (
              <span className="mt-0.5 block truncate text-[11px] text-[var(--muted)]">{item.body}</span>
            ) : null}
          </span>
        </button>
      ))}
    </div>
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
      const conversations = await response.json() as ArchivedConversation[]
      setItems(Array.isArray(conversations) ? conversations : [])
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
    <div className="space-y-0.5 px-1">
      {items.map((conversation) => (
        <button
          key={conversation._id}
          type="button"
          className={rowClass}
          onClick={() => {
            onNavigate?.()
            router.push(`/app/chat?id=${encodeURIComponent(conversation._id)}`)
          }}
        >
          <Archive size={13} className="mt-0.5 shrink-0" aria-hidden />
          <span className="min-w-0 flex-1 truncate text-[13px] text-[var(--foreground)]">
            {conversation.title?.trim() || 'Untitled conversation'}
          </span>
        </button>
      ))}
    </div>
  )
}
