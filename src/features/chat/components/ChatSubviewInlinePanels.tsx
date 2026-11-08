'use client'

import { useEffect, useMemo } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { Bell, Loader2 } from 'lucide-react'
import { SidebarMenuSub, SidebarMenuSubButton, SidebarMenuSubItem } from '@overlay/ui/primitives'
import { conversationActivityLabel } from '@/shared/chat/conversation-activity-state'
import { mergeHrefSearchParams, readWorkspaceIdFromPath } from '@/shared/workspaces/routing'
import { useWorkspaceHref } from '@/hooks/use-workspace-href'
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
    <div className="flex flex-col items-center gap-2 px-3 py-8 text-center text-xs text-(--muted)">
      {icon}
      <span>{message}</span>
    </div>
  )
}

type ActivityNotification = Pick<
  WorkspaceNotification,
  'id' | 'workspaceId' | 'title' | 'body' | 'createdAt' | 'readAt' | 'conversationId' | 'messageId' | 'conversationType' | 'conversationState'
>

function viewForConversationType(conversationType?: string): 'personal' | 'dms' | 'channels' {
  if (conversationType === 'channel') return 'channels'
  if (conversationType === 'dm') return 'dms'
  return 'personal'
}

export function ActivityInlinePanel({ onNavigate }: { onNavigate?: () => void }) {
  const router = useRouter()
  const pathname = usePathname() ?? ''
  const buildWorkspaceHref = useWorkspaceHref()
  const { notifications, notificationsReady, markNotificationsRead } = useCollaborationRealtime()
  const items: ActivityNotification[] = useMemo(() => notifications.slice(0, 50), [notifications])

  // Opening the panel marks what it shows as read; later arrivals stay unread until seen.
  const shownUnreadIds = useMemo(() => items.filter((item) => !item.readAt).map(({ id }) => id), [items])
  useEffect(() => {
    markNotificationsRead(shownUnreadIds)
  }, [markNotificationsRead, shownUnreadIds])

  function openNotification(item: ActivityNotification) {
    onNavigate?.()
    if (!item.conversationId) return
    if (item.conversationState === 'archived') {
      // The chat lives in the notification's workspace; handle-based routes carry no id to read.
      const workspaceId = item.workspaceId || readWorkspaceIdFromPath(pathname)
      const archivedBase = workspaceId
        ? buildWorkspaceHref(workspaceId, '/app/archived')
        : '/app/archived'
      router.push(`${archivedBase}?id=${encodeURIComponent(item.conversationId)}`)
      return
    }
    if (!item.readAt) markNotificationsRead([item.id])
    const view = viewForConversationType(item.conversationType)
    const query = new URLSearchParams({ view, id: item.conversationId })
    if (item.messageId) query.set('message', item.messageId)
    const chatBase = buildWorkspaceHref(
      readWorkspaceIdFromPath(pathname),
      '/app/chat',
      view === 'personal' ? 'personal' : 'workspace',
    )
    router.push(mergeHrefSearchParams(chatBase, query))
  }

  if (!notificationsReady) {
    return <PanelState icon={<Loader2 size={15} className="animate-spin" />} message="Loading activity…" />
  }
  if (items.length === 0) {
    return <PanelState icon={<Bell size={16} />} message="No activity yet." />
  }

  return (
    <SidebarMenuSub className="ml-0 border-l-0 pl-0">
      {items.map((item) => (
        <SidebarMenuSubItem key={item.id}>
          <SidebarMenuSubButton className="h-8 gap-2.5 text-sm" onClick={() => openNotification(item)}>
            <Bell aria-hidden />
            <span className="min-w-0 flex-1 truncate">
              {item.title?.trim() || 'Notification'}
            </span>
            {conversationActivityLabel(item.conversationState) ? (
              <span className="shrink-0 text-[10px] text-(--muted-light)">
                {conversationActivityLabel(item.conversationState)}
              </span>
            ) : null}
            {!item.readAt ? (
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-(--muted)" aria-label="Unread" />
            ) : null}
          </SidebarMenuSubButton>
        </SidebarMenuSubItem>
      ))}
    </SidebarMenuSub>
  )
}
