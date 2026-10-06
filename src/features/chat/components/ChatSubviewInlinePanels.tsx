'use client'

import { useEffect, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { Bell, Loader2 } from 'lucide-react'
import { SidebarResourceList, SidebarResourceRow } from '@overlay/ui/primitives'
import { overlayAppClient } from '@/shared/app/overlay-app-client'
import { dispatchCollaborationNotificationsChanged } from '@/shared/chat/collaboration-events'
import { conversationActivityLabel } from '@/shared/chat/conversation-activity-state'
import {
  buildWorkspaceHref,
  readWorkspaceIdFromPath,
} from '@/shared/workspaces/routing'
import type { WorkspaceNotification } from '@overlay/workspace-contracts'
import { useCollaborationRealtime } from './collaboration/CollaborationRealtimeProvider'

/**
 * Sidebar lists for the Chats subviews that are not conversation list.
 *
 * Activity is its own route, but the secondary panel kept rendering the chat list
 * underneath it, so selecting it left the sidebar showing something unrelated to the
 * page beside it.
 */

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
  const { notifications, notificationsReady } = useCollaborationRealtime()
  const [locallyRead, setLocallyRead] = useState<Map<string, number>>(() => new Map())
  const items: ActivityNotification[] = notifications.slice(0, 50).map((item) => (
    locallyRead.has(item.id) ? { ...item, readAt: item.readAt ?? locallyRead.get(item.id) } : item
  ))

  // Mark all notifications as read when the inline Activity panel opens.
  // This is intentionally a side effect of opening the panel, not a user action.
  useEffect(() => {
    const unreadIds = notifications
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
    void overlayAppClient.conversations.markNotificationsRead(unreadIds)
      .then(() => dispatchCollaborationNotificationsChanged())
      .catch(() => undefined)
  }, [notifications])

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
      setLocallyRead((current) => new Map(current).set(item.id, Date.now()))
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

  if (!notificationsReady) {
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
