'use client'

import { useEffect, useMemo, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { AtSign, Bell, BellOff, Check, Inbox, MessageCircle, Smile } from 'lucide-react'
import type {
  WorkspaceNotification,
  WorkspaceNotificationFilter,
} from '@overlay/workspace-contracts'
import { Button, SegmentedControl } from '@overlay/ui/primitives'
import { AppScreenHeader, AppScreenShell } from '@overlay/modules-react/shell'
import { SidebarListSkeleton } from '@overlay/ui/feedback'
import { overlayAppClient } from '@/shared/app/overlay-app-client'
import { dispatchCollaborationNotificationsChanged } from '@/shared/chat/collaboration-events'
import { conversationActivityLabel } from '@/shared/chat/conversation-activity-state'
import { useCollaborationRealtime } from './collaboration/CollaborationRealtimeProvider'
import { ChatSurfaceEmptyState } from './ChatSurfaceEmptyState'
import {
  buildWorkspaceHref,
  mergeHrefSearchParams,
  readWorkspaceIdFromPath,
} from '@/shared/workspaces/routing'
import { useWorkspaceHref } from '@/hooks/use-workspace-href'

const FILTERS: Array<{ value: WorkspaceNotificationFilter; label: string; icon: typeof Bell }> = [
  { value: 'all', label: 'All', icon: Inbox },
  { value: 'unread', label: 'Unread', icon: Bell },
  { value: 'mentions', label: 'Mentions', icon: AtSign },
  { value: 'threads', label: 'Threads', icon: MessageCircle },
  { value: 'reactions', label: 'Reactions', icon: Smile },
]

const EMPTY_STATES: Record<
  WorkspaceNotificationFilter,
  { title: string; description: string }
> = {
  all: { title: 'No activity yet', description: 'You are all caught up.' },
  unread: { title: 'Nothing unread', description: 'New unread activity will appear here.' },
  mentions: { title: 'No mentions', description: 'Mentions from people and agents will appear here.' },
  threads: { title: 'No thread replies', description: 'Replies in threads you follow will appear here.' },
  reactions: { title: 'No reactions', description: 'Reactions to your messages will appear here.' },
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
  const buildScopedHref = useWorkspaceHref()
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

  // Mark all notifications as read when the Activity view is opened.
  // This is intentionally a side effect of opening the view, not a user action.
  useEffect(() => {
    const unreadIds = sourceNotifications
      .filter((notification) => !notification.readAt)
      .map(({ id }) => id)
    if (unreadIds.length === 0) return
    // Optimistically mark read in the local state so the badge drops immediately.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLocallyRead((current) => {
      const next = new Map(current)
      const readAt = Date.now()
      for (const id of unreadIds) next.set(id, readAt)
      return next
    })
    void overlayAppClient.conversations
      .markNotificationsRead(unreadIds)
      .then(() => dispatchCollaborationNotificationsChanged())
      .catch(() => undefined)
  }, [sourceNotifications])

  async function openNotification(notification: WorkspaceNotification) {
    const conversationPromise = notification.conversationId
      ? overlayAppClient.conversations
          .get<{
          conversationType?: 'personal' | 'dm' | 'channel'
          }>({ conversationId: notification.conversationId })
          .catch(() => null)
      : Promise.resolve(null)
    if (!notification.readAt) {
      void overlayAppClient.conversations
        .markNotificationsRead([notification.id])
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
    const chatBase = buildScopedHref(
      readWorkspaceIdFromPath(pathname),
      baseHref,
      view === 'personal' ? 'personal' : 'workspace',
    )
    router.push(mergeHrefSearchParams(chatBase, query))
  }

  async function markAllRead() {
    const unreadIds = notifications
      .filter((notification) => !notification.readAt)
      .map(({ id }) => id)
    if (unreadIds.length === 0) return
    setLocallyRead((current) => {
      const next = new Map(current)
      const readAt = Date.now()
      for (const id of unreadIds) next.set(id, readAt)
      return next
    })
    await overlayAppClient.conversations
      .markNotificationsRead(unreadIds)
      .then(() => dispatchCollaborationNotificationsChanged())
      .catch(() => undefined)
  }

  return (
    <AppScreenShell
      className="h-full"
      header={
        <AppScreenHeader
          title="Activity"
          subtitle={unreadCount > 0 ? `${unreadCount} unread` : undefined}
          actions={
            <SegmentedControl
              value={filter}
              options={FILTERS}
              onChange={setFilter}
              ariaLabel="Activity filters"
            />
          }
        />
      }
    >
      <div className="h-full min-h-0 overflow-y-auto">
        {loading ? (
          <div className="mx-auto w-full max-w-3xl px-4 py-4 sm:px-6">
            <SidebarListSkeleton rows={8} />
          </div>
        ) : notifications.length === 0 ? (
          <ChatSurfaceEmptyState
            icon={Inbox}
            title={EMPTY_STATES[filter].title}
            description={EMPTY_STATES[filter].description}
          />
        ) : (
          <div className="mx-auto w-full max-w-3xl px-4 py-4 sm:px-6">
            {unreadCount > 0 ? (
              <div className="mb-2 flex justify-end">
                <Button
                  variant="ghost"
                  type="button"
                  onClick={() => void markAllRead()}
                  className="h-auto gap-1.5 rounded-md px-2 py-1 text-xs font-normal text-(--muted) transition-colors hover:bg-(--surface-subtle) hover:text-(--foreground)"
                >
                  <BellOff size={13} /> Mark all read
                </Button>
              </div>
            ) : null}
            <ul className="space-y-0.5">
              {notifications.map((notification) => (
                <li key={notification.id}>
                  <Button
                    variant="ghost"
                    type="button"
                    onClick={() => void openNotification(notification)}
                    className={`flex h-auto w-full items-start justify-start gap-3 rounded-lg px-3 py-3 text-left font-normal transition-colors hover:bg-(--surface-subtle) hover:text-current ${notification.readAt ? 'opacity-70' : ''}`}
                  >
                    <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-(--surface-muted) text-(--muted)">
                      {notificationIcon(notification.type)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className='block text-sm font-medium text-(--foreground)'>
                        {notification.title}
                      </span>
                      {notification.body ? (
                        <span className='mt-0.5 line-clamp-2 block text-xs leading-5 text-(--muted)'>
                          {notification.body}
                        </span>
                      ) : null}
                      <time className="mt-1 block text-[11px] text-(--muted-light)">
                        {
                          // Locale pinned to 'en-US' — SSR and client output are identical.
                          // react-doctor-disable-next-line react-doctor/no-locale-format-in-render
                          new Date(notification.createdAt).toLocaleString(
                            'en-US',
                            { dateStyle: 'short', timeStyle: 'short' },
                          )
                        }
                        {conversationActivityLabel(
                          notification.conversationState,
                        )
                          ? ` · ${conversationActivityLabel(notification.conversationState)}`
                          : ''}
                      </time>
                    </span>
                    {notification.readAt ? (
                      <Check
                        size={13}
                        className='mt-2 shrink-0 text-(--muted-light)'
                      />
                    ) : (
                      <span
                        className='mt-2.5 h-1.5 w-1.5 shrink-0 rounded-full bg-(--muted)'
                        aria-label='Unread'
                      />
                    )}
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </AppScreenShell>
  )
}
