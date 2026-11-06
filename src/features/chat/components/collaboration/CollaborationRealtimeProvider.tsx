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
import { useDesktopBridge } from '@/components/desktop/DesktopProvider'
import { buildWorkspaceHref } from '@/shared/workspaces/routing'
import type { WorkspaceNotification } from '@overlay/workspace-contracts'
import { useQuery } from '@/components/providers/convex-hooks'
import { useConvexAuthToken } from '@/components/providers/ConvexAuthProvider'
import { useOverlayCapabilities } from '@/components/providers/CapabilitiesProvider'
import { useAuth } from '@/contexts/AuthContext'
import { useWorkspace } from '@/contexts/WorkspaceContext'
import { api } from '../../../../../convex/_generated/api'
import { usePersonalChat } from '@/components/providers/PersonalChatProvider'
import { useNativeActivity, type NativeNotification } from '@/components/providers/native-activity-context'
import { NativeActivityProvider } from './NativeActivityProvider'
import { nativeNotificationHref } from './native-notification-navigation'

type CollaborationRealtimeContextValue = {
  conversationListVersion: number | null
  notifications: WorkspaceNotification[]
  notificationsReady: boolean
  refreshNotifications(): void
}

const CollaborationRealtimeContext = createContext<CollaborationRealtimeContextValue>({
  conversationListVersion: null,
  notifications: [],
  notificationsReady: false,
  refreshNotifications: () => undefined,
})

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

function ConvexCollaborationSubscriptions({
  accessToken,
  actorUserId,
  enabled,
  workspaceLegacy,
  personalLegacy,
  onConversationListVersion,
  onNotifications,
  workspaceId,
}: {
  accessToken: string | null
  actorUserId: string | null
  enabled: boolean
  workspaceLegacy: boolean
  personalLegacy: boolean
  onConversationListVersion(version: number): void
  onNotifications(notifications: WorkspaceNotification[]): void
  workspaceId: string | null
}) {
  const args = enabled && workspaceLegacy && accessToken && actorUserId && workspaceId
    ? { accessToken, actorUserId, workspaceId }
    : 'skip'
  const listVersion = useQuery(api.collaboration.directMessages.watchConversationListVersion, args)
  const notificationResult = useQuery(
    api.collaboration.directMessages.watchNotifications,
    args === 'skip' ? 'skip' : { ...args, filter: 'all' as const, limit: 100 },
  )

  // Personal conversation list version subscription (user-scoped).
  // Merged with the workspace version so the client detects both
  // personal and collaboration conversation changes.
  const personalArgs = enabled && personalLegacy && accessToken && actorUserId
    ? { userId: actorUserId, accessToken }
    : 'skip'
  const personalListVersion = useQuery(
    api.chat.conversations.watchPersonalConversationListVersion,
    personalArgs,
  )

  useEffect(() => {
    const workspaceVersion = listVersion?.ok ? listVersion.version : 0
    const personalVersion = personalListVersion?.ok ? personalListVersion.version : 0
    // Use the max of both versions so any change triggers a refresh.
    // react-doctor-disable-next-line react-doctor/no-pass-data-to-parent
    onConversationListVersion(workspaceLegacy ? Math.max(workspaceVersion, personalVersion) : personalVersion)
  }, [listVersion, personalListVersion, onConversationListVersion, workspaceLegacy])

  useEffect(() => {
    if (notificationResult?.ok) {
      // react-doctor-disable-next-line react-doctor/no-pass-data-to-parent
      onNotifications(notificationResult.notifications as WorkspaceNotification[])
    }
  }, [notificationResult, onNotifications])

  return null
}

function CollaborationRealtimeLive({ children }: { children: ReactNode }) {
  const native = useNativeActivity()
  const personal = usePersonalChat()
  const { appDataCapabilities } = useOverlayCapabilities()
  const { user } = useAuth()
  const { activeWorkspaceId } = useWorkspace()
  const accessToken = useConvexAuthToken()
  const visible = usePageVisibility()
  const desktop = useDesktopBridge()
  const seen = useRef<Set<string> | null>(null)
  const [notifications, setNotifications] = useState<WorkspaceNotification[]>([])
  const [notificationsReady, setNotificationsReady] = useState(false)
  const [conversationListVersion, setConversationListVersion] = useState<number | null>(null)
  const convexEnabled = appDataCapabilities.provider === 'convex'
    && appDataCapabilities.requiresConvexClient
    && appDataCapabilities.supportsRealtime

  useEffect(() => {
    let alive = true
    void Promise.resolve().then(() => {
      if (!alive) return
      seen.current = null
      setNotifications([])
      setNotificationsReady(false)
      setConversationListVersion(null)
    })
    return () => { alive = false }
  }, [activeWorkspaceId, user?.id])

  const refreshNotifications = useCallback(() => {}, [])

  const deliverNotifications = useCallback((next: WorkspaceNotification[], unreadCount?: number) => {
    if (desktop?.info.capabilities.includes('window')) void desktop.bridge.call('window.setBadgeCount', { count: Math.min(99999, unreadCount ?? next.filter((item) => !item.readAt).length) }).catch(() => {})
    if (seen.current && desktop?.info.capabilities.includes('notifications') && !visible) {
      for (const item of next) {
        if (seen.current.has(item.id) || item.readAt || item.conversationState === 'deleted') continue
        const nativeItem = item as WorkspaceNotification & { destination?: NativeNotification['destination'] }
        const route = nativeItem.destination ? nativeNotificationHref({ workspaceId: item.workspaceId, destination: nativeItem.destination })
          : buildWorkspaceHref(item.workspaceId, '/app/chat') + (item.conversationId ? `?id=${encodeURIComponent(item.conversationId)}` : '')
        void desktop.bridge.call('notifications.show', { title: item.title.slice(0, 200), body: (item.body ?? '').slice(0, 2000), route }).catch(() => {})
      }
    }
    seen.current = new Set(next.map((item) => item.id))
  }, [desktop, visible])

  const handleNotifications = useCallback((next: WorkspaceNotification[]) => {
    deliverNotifications(next)
    setNotifications(next)
    setNotificationsReady(true)
  }, [deliverNotifications])

  useEffect(() => {
    if (native?.ready) deliverNotifications(native.notifications, native.counts?.notifications.count ?? 0)
  }, [deliverNotifications, native?.counts?.notifications.count, native?.notifications, native?.ready])

  const value = useMemo(() => ({
    conversationListVersion,
    notifications: native?.notifications ?? notifications,
    notificationsReady: native ? native.ready : notificationsReady,
    refreshNotifications,
  }), [conversationListVersion, native, notifications, notificationsReady, refreshNotifications])

  return (
    <CollaborationRealtimeContext.Provider value={value}>
      {convexEnabled ? (
        <ConvexCollaborationSubscriptions
          accessToken={accessToken}
          actorUserId={user?.id ?? null}
          enabled={visible || Boolean(desktop)}
          workspaceLegacy={!native}
          personalLegacy={!personal.configured}
          onConversationListVersion={setConversationListVersion}
          onNotifications={handleNotifications}
          workspaceId={activeWorkspaceId}
        />
      ) : null}
      {children}
    </CollaborationRealtimeContext.Provider>
  )
}

export function CollaborationRealtimeProvider({ children }: { children: ReactNode }) {
  return <NativeActivityProvider><CollaborationRealtimeLive>{children}</CollaborationRealtimeLive></NativeActivityProvider>
}

export function useCollaborationRealtime(): CollaborationRealtimeContextValue {
  return useContext(CollaborationRealtimeContext)
}
