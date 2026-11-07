'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { useConvexAuth, useMutation, useQuery } from 'convex/react'
import type { OptimisticLocalStore } from 'convex/browser'
import type { FunctionArgs } from 'convex/server'
import { useDesktopBridge } from '@/components/desktop/DesktopProvider'
import { buildWorkspaceHref } from '@/shared/workspaces/routing'
import type { WorkspaceNotification } from '@overlay/workspace-contracts'
import { useWorkspace } from '@/contexts/WorkspaceContext'
import { api } from '../../../../../convex/_generated/api'
import type { Id } from '../../../../../convex/_generated/dataModel'

type CollaborationRealtimeContextValue = {
  notifications: WorkspaceNotification[]
  notificationsReady: boolean
  /** Marks exactly these notifications read. Anything that arrives meanwhile stays unread. */
  markNotificationsRead(ids: string[]): void
  /** Marks one open room's notifications read. */
  markConversationRead(conversationId: string): void
}

const NO_NOTIFICATIONS: WorkspaceNotification[] = []

const CollaborationRealtimeContext = createContext<CollaborationRealtimeContextValue>({
  notifications: NO_NOTIFICATIONS,
  notificationsReady: false,
  markNotificationsRead: () => undefined,
  markConversationRead: () => undefined,
})

/** Shows notifications read at once; the server answer replaces this, so a failure restores them. */
function markReadOptimistically(
  store: OptimisticLocalStore,
  change: FunctionArgs<typeof api.collaboration.activity.markRead>,
) {
  const current = store.getQuery(api.collaboration.activity.notifications, { workspaceId: change.workspaceId })
  if (!current) return
  const ids = change.notificationIds ? new Set(change.notificationIds) : null
  const readAt = Date.now()
  store.setQuery(api.collaboration.activity.notifications, { workspaceId: change.workspaceId }, current.map((item) => (
    !item.readAt && (ids?.has(item.id) || (change.conversationId && item.conversationId === change.conversationId))
      ? { ...item, readAt }
      : item
  )))
}

function usePageVisibility(): boolean {
  const [visible, setVisible] = useState(() => (
    typeof document === 'undefined' || document.visibilityState === 'visible'
  ))
  useEffect(() => {
    const update = () => setVisible(document.visibilityState === 'visible')
    document.addEventListener('visibilitychange', update)
    return () => document.removeEventListener('visibilitychange', update)
  }, [])
  return visible
}

/**
 * Activity notifications for the active workspace, read live with native
 * identity. Read state is optimistic: marking read updates the live list at once and the server
 * result replaces it, so a failure restores the unread state by itself.
 */
export function CollaborationRealtimeProvider({ children }: { children: ReactNode }) {
  const { activeWorkspaceId } = useWorkspace()
  const { isAuthenticated, isLoading } = useConvexAuth()
  const visible = usePageVisibility()
  const desktop = useDesktopBridge()
  const args = activeWorkspaceId && isAuthenticated && !isLoading ? { workspaceId: activeWorkspaceId } : null
  const result = useQuery(api.collaboration.activity.notifications, args ?? 'skip')
  const notifications = (result as WorkspaceNotification[] | null | undefined) ?? NO_NOTIFICATIONS

  const markReadMutation = useMutation(api.collaboration.activity.markRead)
  const markRead = useMemo(() => markReadMutation.withOptimisticUpdate(markReadOptimistically), [markReadMutation])
  const workspaceId = args?.workspaceId ?? null
  const markNotificationsRead = useCallback((ids: string[]) => {
    if (!workspaceId || ids.length === 0) return
    void markRead({ workspaceId, notificationIds: ids }).catch(() => undefined)
  }, [markRead, workspaceId])
  const markConversationRead = useCallback((conversationId: string) => {
    if (!workspaceId) return
    void markRead({ workspaceId, conversationId: conversationId as Id<'conversations'> }).catch(() => undefined)
  }, [markRead, workspaceId])

  // Desktop badge and banners for notifications that arrive while the window is hidden.
  const seen = useRef<{ workspaceId: string | null; ids: Set<string> } | null>(null)
  useEffect(() => {
    if (result === undefined || result === null) return
    if (desktop?.info.capabilities.includes('window')) {
      void desktop.bridge.call('window.setBadgeCount', { count: Math.min(99999, notifications.filter((item) => !item.readAt).length) }).catch(() => {})
    }
    const previous = seen.current?.workspaceId === workspaceId ? seen.current.ids : null
    if (previous && desktop?.info.capabilities.includes('notifications') && !visible) {
      for (const item of notifications) {
        if (previous.has(item.id) || item.readAt || item.conversationState === 'deleted') continue
        const route = buildWorkspaceHref(item.workspaceId, '/app/chat') + (item.conversationId ? `?id=${encodeURIComponent(item.conversationId)}` : '')
        void desktop.bridge.call('notifications.show', { title: item.title.slice(0, 200), body: (item.body ?? '').slice(0, 2000), route }).catch(() => {})
      }
    }
    seen.current = { workspaceId, ids: new Set(notifications.map((item) => item.id)) }
  }, [desktop, notifications, result, visible, workspaceId])

  const value = useMemo(() => ({
    notifications,
    notificationsReady: result !== undefined,
    markNotificationsRead,
    markConversationRead,
  }), [markConversationRead, markNotificationsRead, notifications, result])

  return (
    <CollaborationRealtimeContext.Provider value={value}>
      {children}
    </CollaborationRealtimeContext.Provider>
  )
}

export function useCollaborationRealtime(): CollaborationRealtimeContextValue {
  return useContext(CollaborationRealtimeContext)
}
