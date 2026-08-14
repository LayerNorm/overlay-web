'use client'

import { useMemo, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { AtSign, Bell, BellOff, Check, Inbox, MessageCircle, Smile } from 'lucide-react'
import type {
  WorkspaceNotification,
  WorkspaceNotificationFilter,
} from '@overlay/workspace-contracts'
import { SegmentedControl } from '@overlay/ui'
import { AppScreenHeader, AppScreenShell } from '@overlay/modules-react/shell'
import { SidebarListSkeleton } from '@overlay/ui/feedback'
import { overlayAppClient } from '@/shared/app/overlay-app-client'
import { dispatchCollaborationNotificationsChanged } from '@/shared/chat/collaboration-events'
import { conversationActivityLabel } from '@/shared/chat/conversation-activity-state'
import { useCollaborationRealtime } from './collaboration/CollaborationRealtimeProvider'
import {
  buildWorkspaceHref,
  readWorkspaceIdFromPath,
} from '@/features/workspaces/lib/workspace-routing'

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
  const pathname = usePathname() ?? ''
  const [filter, setFilter] = useState<WorkspaceNotificationFilter>('all')
  const { notifications: sourceNotifications, notificationsReady } = useCollaborationRealtime()
  const [locallyRead, setLocallyRead] = useState<Map<string, number>>(() => new Map())
  const notifications = useMemo(() => sourceNotifications
    .filter((notification) => {
      if (filter === 'unread') return !notification.readAt && !locallyRead.has(notification.id)
      if (filter === 'mentions') return notification.type === 'mention'
      if (filter === 'threads') return notification.type === 'thread'
      if (filter === 'reactions') return notification.type === 'reaction'
      return true
    })
    .map((notification) => locallyRead.has(notification.id)
      ? { ...notification, readAt: notification.readAt ?? locallyRead.get(notification.id) }
      : notification), [filter, locallyRead, sourceNotifications])
  const loading = !notificationsReady

  const unreadCount = notifications.filter((notification) => !notification.readAt).length

  async function openNotification(notification: WorkspaceNotification) {
    const conversationPromise = notification.conversationId
      ? overlayAppClient.conversations.get<{
          conversationType?: 'personal' | 'dm' | 'channel'
        }>({ conversationId: notification.conversationId }).catch(() => null)
      : Promise.resolve(null)
    if (!notification.readAt) {
      void overlayAppClient.conversations.markNotificationsRead([notification.id])
        .then(() => dispatchCollaborationNotificationsChanged())
        .catch(() => undefined)
      setLocallyRead((current) => new Map(current).set(notification.id, Date.now()))
    }
    if (!notification.conversationId) return
    if (notification.conversationState === 'archived') {
      const workspaceId = readWorkspaceIdFromPath(pathname)
      const archivedBase = workspaceId
        ? buildWorkspaceHref(workspaceId, '/app/archived')
        : '/app/archived'
      router.push(`${archivedBase}?id=${encodeURIComponent(notification.conversationId)}`)
      return
    }
    const conversation = await conversationPromise
    const view = conversation?.conversationType === 'channel'
      ? 'channels'
      : conversation?.conversationType === 'dm'
        ? 'dms'
        : 'personal'
    const query = new URLSearchParams({ view, id: notification.conversationId })
    if (notification.messageId) query.set('message', notification.messageId)
    router.push(`${baseHref}?${query.toString()}`)
  }

  async function markAllRead() {
    const unreadIds = notifications.filter((notification) => !notification.readAt).map(({ id }) => id)
    if (unreadIds.length === 0) return
    setLocallyRead((current) => {
      const next = new Map(current)
      const readAt = Date.now()
      for (const id of unreadIds) next.set(id, readAt)
      return next
    })
    await overlayAppClient.conversations.markNotificationsRead(unreadIds)
      .then(() => dispatchCollaborationNotificationsChanged())
      .catch(() => undefined)
  }

  return (
    <AppScreenShell
      className="h-full"
      header={(
        <AppScreenHeader
          title="Activity"
          subtitle={unreadCount > 0 ? `${unreadCount} unread` : undefined}
          actions={(
            <SegmentedControl
              value={filter}
              options={FILTERS}
              onChange={setFilter}
              ariaLabel="Activity filters"
            />
          )}
        />
      )}
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
                        {conversationActivityLabel(notification.conversationState)
                          ? ` · ${conversationActivityLabel(notification.conversationState)}`
                          : ''}
                      </time>
                    </span>
                    {notification.readAt
                      ? <Check size={13} className="mt-2 shrink-0 text-[var(--muted-light)]" />
                      : <span className="mt-2.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--muted)]" aria-label="Unread" />}
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
