'use client'

import { useCallback, useEffect, useState } from 'react'
import { AtSign, Bell, Check, MessageCircle, Settings2, Smile } from 'lucide-react'
import type {
  WorkspaceNotification,
  WorkspaceNotificationFilter,
  WorkspaceNotificationPreferenceMode,
  WorkspaceNotificationPreferences,
} from '@overlay/workspace-contracts'
import { SidebarListSkeleton } from '@overlay/ui/feedback'
import { overlayAppClient } from '@/shared/app/overlay-app-client'

const FILTERS: Array<{ id: WorkspaceNotificationFilter; label: string; icon: typeof Bell }> = [
  { id: 'all', label: 'All', icon: Bell },
  { id: 'unread', label: 'Unread', icon: Bell },
  { id: 'mentions', label: 'Mentions', icon: AtSign },
  { id: 'threads', label: 'Threads', icon: MessageCircle },
  { id: 'reactions', label: 'Reactions', icon: Smile },
]

type NotificationPreferenceKey = keyof WorkspaceNotificationPreferences & string

const PREFERENCE_LABELS: Array<{ key: NotificationPreferenceKey; label: string }> = [
  { key: 'dmMessages', label: 'Direct messages' },
  { key: 'mentions', label: 'Mentions' },
  { key: 'threadReplies', label: 'Followed threads' },
  { key: 'reactions', label: 'Reactions' },
  { key: 'channelMessages', label: 'Channel messages' },
]

const MODES: WorkspaceNotificationPreferenceMode[] = ['activity', 'banner', 'off']

export function ChatActivityPanel({
  baseHref,
  onNavigate,
}: {
  baseHref: string
  onNavigate?: () => void
}) {
  const [filter, setFilter] = useState<WorkspaceNotificationFilter>('all')
  const [notifications, setNotifications] = useState<WorkspaceNotification[]>([])
  const [preferences, setPreferences] = useState<WorkspaceNotificationPreferences | null>(null)
  const [loading, setLoading] = useState(true)
  const [settingsOpen, setSettingsOpen] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [activity, settings] = await Promise.all([
        overlayAppClient.conversations.notifications({ filter, limit: 100 }),
        preferences ? Promise.resolve({ preferences }) : overlayAppClient.conversations.notificationPreferences(),
      ])
      setNotifications(activity.notifications)
      setPreferences(settings.preferences)
    } catch {
      setNotifications([])
    } finally {
      setLoading(false)
    }
  }, [filter, preferences])

  useEffect(() => {
    void load()
    const timer = window.setInterval(() => void load(), 15_000)
    return () => window.clearInterval(timer)
  }, [load])

  async function markRead(notification: WorkspaceNotification) {
    if (!notification.readAt) {
      await overlayAppClient.conversations.markNotificationsRead([notification.id]).catch(() => undefined)
      setNotifications((current) => current.map((row) => row.id === notification.id ? { ...row, readAt: Date.now() } : row))
    }
    if (!notification.conversationId) return
    const query = new URLSearchParams({ view: 'all', id: notification.conversationId })
    if (notification.messageId) query.set('message', notification.messageId)
    window.history.pushState(null, '', `${baseHref}?${query.toString()}`)
    window.dispatchEvent(new CustomEvent('overlay:chat-route-selected', { detail: { chatId: notification.conversationId } }))
    onNavigate?.()
  }

  async function cyclePreference(key: keyof WorkspaceNotificationPreferences) {
    if (!preferences) return
    const currentIndex = MODES.indexOf(preferences[key])
    const next = MODES[(currentIndex + 1) % MODES.length]!
    const result = await overlayAppClient.conversations.updateNotificationPreferences({ [key]: next })
    setPreferences(result.preferences)
  }

  return (
    <div className="flex min-h-0 flex-col">
      <div className="flex items-center gap-1 overflow-x-auto px-2 pb-2">
        {FILTERS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => setFilter(id)}
            className={`inline-flex h-7 shrink-0 items-center gap-1 rounded-md px-2 text-[11px] transition-colors ${filter === id ? 'bg-[var(--surface-subtle)] text-[var(--foreground)]' : 'text-[var(--muted)] hover:bg-[var(--surface-subtle)]'}`}
          >
            <Icon size={12} />{label}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setSettingsOpen((open) => !open)}
          aria-label="Activity notification settings"
          className="ml-auto inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[var(--muted)] hover:bg-[var(--surface-subtle)] hover:text-[var(--foreground)]"
        >
          <Settings2 size={13} />
        </button>
      </div>
      {settingsOpen && preferences ? (
        <div className="mx-2 mb-2 space-y-1 rounded-lg border border-[var(--border)] bg-[var(--surface-subtle)] p-2">
          <p className="px-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--muted-light)]">Notification delivery</p>
          {PREFERENCE_LABELS.map(({ key, label }) => (
            <button
              key={key}
              type="button"
              onClick={() => void cyclePreference(key)}
              className="flex w-full items-center justify-between rounded-md px-1 py-1 text-left text-[11px] text-[var(--muted)] hover:bg-[var(--surface-elevated)] hover:text-[var(--foreground)]"
            >
              <span>{label}</span>
              <span className="capitalize text-[var(--foreground)]">{preferences[key]}</span>
            </button>
          ))}
        </div>
      ) : null}
      <div className="min-h-0 overflow-y-auto px-2">
        {loading ? <SidebarListSkeleton rows={5} /> : notifications.length === 0 ? (
          <p className="px-2 py-5 text-center text-xs text-[var(--muted-light)]">You are all caught up.</p>
        ) : notifications.map((notification) => (
          <button
            key={notification.id}
            type="button"
            onClick={() => void markRead(notification)}
            className={`group flex w-full items-start gap-2 rounded-lg px-2 py-2 text-left transition-colors hover:bg-[var(--surface-subtle)] ${notification.readAt ? 'opacity-70' : ''}`}
          >
            <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--surface-muted)] text-[var(--muted)]">
              {notification.type === 'mention' ? <AtSign size={12} /> : notification.type === 'thread' ? <MessageCircle size={12} /> : notification.type === 'reaction' ? <Smile size={12} /> : <Bell size={12} />}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[11px] font-medium text-[var(--foreground)]">{notification.title}</span>
              {notification.body ? <span className="mt-0.5 line-clamp-2 block text-[11px] text-[var(--muted)]">{notification.body}</span> : null}
              <time className="mt-1 block text-[10px] text-[var(--muted-light)]">{new Date(notification.createdAt).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}</time>
            </span>
            {!notification.readAt ? <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--foreground)]" aria-label="Unread" /> : <Check size={12} className="mt-2 shrink-0 text-[var(--muted-light)]" />}
          </button>
        ))}
      </div>
    </div>
  )
}
