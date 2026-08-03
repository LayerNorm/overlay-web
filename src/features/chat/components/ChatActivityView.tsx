'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AtSign, Bell, BellOff, Check, Inbox, MessageCircle, Settings2, Smile } from 'lucide-react'
import type {
  WorkspaceNotification,
  WorkspaceNotificationFilter,
  WorkspaceNotificationPreferenceMode,
  WorkspaceNotificationPreferences,
} from '@overlay/workspace-contracts'
import { IconButton, SegmentedControl } from '@overlay/ui'
import { AppScreenHeader, AppScreenShell, AppScreenSidePanel } from '@overlay/modules-react/shell'
import { SidebarListSkeleton } from '@overlay/ui/feedback'
import { overlayAppClient } from '@/shared/app/overlay-app-client'

const FILTERS: Array<{ value: WorkspaceNotificationFilter; label: string; icon: typeof Bell }> = [
  { value: 'all', label: 'All', icon: Inbox },
  { value: 'unread', label: 'Unread', icon: Bell },
  { value: 'mentions', label: 'Mentions', icon: AtSign },
  { value: 'threads', label: 'Threads', icon: MessageCircle },
  { value: 'reactions', label: 'Reactions', icon: Smile },
]

const EMPTY_LABELS: Record<WorkspaceNotificationFilter, string> = {
  all: 'You are all caught up.',
  unread: 'Nothing unread.',
  mentions: 'No one has mentioned you.',
  threads: 'No replies in threads you follow.',
  reactions: 'No reactions yet.',
}

type NotificationPreferenceKey = keyof WorkspaceNotificationPreferences & string

const PREFERENCE_LABELS: Array<{ key: NotificationPreferenceKey; label: string; hint: string }> = [
  { key: 'dmMessages', label: 'Direct messages', hint: 'Every message in a one-to-one conversation.' },
  { key: 'mentions', label: 'Mentions', hint: 'When someone @-mentions you directly or in a channel.' },
  { key: 'threadReplies', label: 'Followed threads', hint: 'Replies in threads you started or joined.' },
  { key: 'reactions', label: 'Reactions', hint: 'Reactions people add to your messages.' },
  { key: 'channelMessages', label: 'Channel messages', hint: 'Every message in channels you belong to.' },
]

const MODES: WorkspaceNotificationPreferenceMode[] = ['activity', 'banner', 'off']

const MODE_LABELS: Record<WorkspaceNotificationPreferenceMode, string> = {
  activity: 'Activity',
  banner: 'Banner',
  off: 'Off',
}

function notificationIcon(type: WorkspaceNotification['type']) {
  if (type === 'mention') return <AtSign size={13} />
  if (type === 'thread') return <MessageCircle size={13} />
  if (type === 'reaction') return <Smile size={13} />
  return <Bell size={13} />
}

/**
 * Activity as a full screen: the filter toggle lives in the header, and the
 * body is only ever the list for the selected filter.
 */
export function ChatActivityView({ baseHref = '/app/chat' }: { baseHref?: string }) {
  const router = useRouter()
  const [filter, setFilter] = useState<WorkspaceNotificationFilter>('all')
  const [notifications, setNotifications] = useState<WorkspaceNotification[]>([])
  const [preferences, setPreferences] = useState<WorkspaceNotificationPreferences | null>(null)
  const [loading, setLoading] = useState(true)
  const [settingsOpen, setSettingsOpen] = useState(false)

  // Notifications refetch per filter and on a poll; preferences load once, so
  // they stay out of this callback and never re-trigger the list skeleton.
  const load = useCallback(async () => {
    try {
      const activity = await overlayAppClient.conversations.notifications({ filter, limit: 100 })
      setNotifications(activity.notifications)
    } catch {
      setNotifications([])
    } finally {
      setLoading(false)
    }
  }, [filter])

  useEffect(() => {
    setLoading(true)
    void load()
    const timer = window.setInterval(() => void load(), 15_000)
    return () => window.clearInterval(timer)
  }, [load])

  useEffect(() => {
    let cancelled = false
    void overlayAppClient.conversations.notificationPreferences()
      .then(({ preferences: loaded }) => {
        if (!cancelled) setPreferences(loaded)
      })
      .catch(() => undefined)
    return () => { cancelled = true }
  }, [])

  const unreadCount = notifications.filter((notification) => !notification.readAt).length

  async function openNotification(notification: WorkspaceNotification) {
    if (!notification.readAt) {
      await overlayAppClient.conversations.markNotificationsRead([notification.id]).catch(() => undefined)
      setNotifications((current) => current.map((row) => row.id === notification.id ? { ...row, readAt: Date.now() } : row))
    }
    if (!notification.conversationId) return
    const query = new URLSearchParams({ view: 'all', id: notification.conversationId })
    if (notification.messageId) query.set('message', notification.messageId)
    router.push(`${baseHref}?${query.toString()}`)
  }

  async function markAllRead() {
    const unreadIds = notifications.filter((notification) => !notification.readAt).map(({ id }) => id)
    if (unreadIds.length === 0) return
    const readAt = Date.now()
    setNotifications((current) => current.map((row) => row.readAt ? row : { ...row, readAt }))
    await overlayAppClient.conversations.markNotificationsRead(unreadIds).catch(() => undefined)
  }

  async function cyclePreference(key: NotificationPreferenceKey) {
    if (!preferences) return
    const next = MODES[(MODES.indexOf(preferences[key]) + 1) % MODES.length]!
    const result = await overlayAppClient.conversations.updateNotificationPreferences({ [key]: next })
    setPreferences(result.preferences)
  }

  return (
    <AppScreenShell
      className="h-full"
      header={(
        <AppScreenHeader
          title="Activity"
          subtitle={unreadCount > 0 ? `${unreadCount} unread` : undefined}
          actions={(
            <>
              <SegmentedControl
                value={filter}
                options={FILTERS}
                onChange={setFilter}
                ariaLabel="Activity filters"
              />
              <IconButton
                aria-label="Notification settings"
                aria-pressed={settingsOpen}
                onClick={() => setSettingsOpen((open) => !open)}
              >
                <Settings2 size={16} />
              </IconButton>
            </>
          )}
        />
      )}
      rightPanel={settingsOpen ? (
        <AppScreenSidePanel
          title="Notification settings"
          description="How each kind of update reaches you."
          onClose={() => setSettingsOpen(false)}
          closeLabel="Close notification settings"
        >
          <div className="space-y-1 p-3">
            {preferences ? PREFERENCE_LABELS.map(({ key, label, hint }) => (
              <button
                key={key}
                type="button"
                onClick={() => void cyclePreference(key)}
                className="flex w-full items-start gap-3 rounded-lg px-2.5 py-2.5 text-left transition-colors hover:bg-[var(--surface-subtle)]"
              >
                <span className="min-w-0 flex-1">
                  <span className="block text-xs font-medium text-[var(--foreground)]">{label}</span>
                  <span className="mt-0.5 block text-[11px] leading-4 text-[var(--muted)]">{hint}</span>
                </span>
                <span className="shrink-0 rounded-md border border-[var(--border)] px-2 py-1 text-[11px] text-[var(--foreground)]">
                  {MODE_LABELS[preferences[key]]}
                </span>
              </button>
            )) : (
              <p className="px-2 py-4 text-xs text-[var(--muted)]">Loading preferences…</p>
            )}
          </div>
        </AppScreenSidePanel>
      ) : null}
      rightPanelOpen={settingsOpen}
      rightPanelWidth={380}
      onRightPanelClose={() => setSettingsOpen(false)}
      rightPanelOverlayLabel="Notification settings"
    >
      <div className="h-full min-h-0 overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl px-4 py-4 sm:px-6">
          {unreadCount > 0 ? (
            <div className="mb-2 flex justify-end">
              <button
                type="button"
                onClick={() => void markAllRead()}
                className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-[var(--muted)] transition-colors hover:bg-[var(--surface-subtle)] hover:text-[var(--foreground)]"
              >
                <BellOff size={13} /> Mark all read
              </button>
            </div>
          ) : null}
          {loading ? (
            <SidebarListSkeleton rows={8} />
          ) : notifications.length === 0 ? (
            <p className="px-2 py-16 text-center text-sm text-[var(--muted-light)]">{EMPTY_LABELS[filter]}</p>
          ) : (
            <ul className="space-y-0.5">
              {notifications.map((notification) => (
                <li key={notification.id}>
                  <button
                    type="button"
                    onClick={() => void openNotification(notification)}
                    className={`flex w-full items-start gap-3 rounded-lg px-3 py-3 text-left transition-colors hover:bg-[var(--surface-subtle)] ${notification.readAt ? 'opacity-70' : ''}`}
                  >
                    <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--surface-muted)] text-[var(--muted)]">
                      {notificationIcon(notification.type)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium text-[var(--foreground)]">{notification.title}</span>
                      {notification.body ? (
                        <span className="mt-0.5 line-clamp-2 block text-xs leading-5 text-[var(--muted)]">{notification.body}</span>
                      ) : null}
                      <time className="mt-1 block text-[11px] text-[var(--muted-light)]">
                        {new Date(notification.createdAt).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}
                      </time>
                    </span>
                    {notification.readAt
                      ? <Check size={13} className="mt-2 shrink-0 text-[var(--muted-light)]" />
                      : <span className="mt-2.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--foreground)]" aria-label="Unread" />}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </AppScreenShell>
  )
}
