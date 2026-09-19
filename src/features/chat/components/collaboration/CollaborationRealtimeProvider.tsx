'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import type { WorkspaceNotification } from '@overlay/workspace-contracts'
import { useQuery } from '@/components/providers/convex-hooks'
import { useConvexAuthToken } from '@/components/providers/ConvexAuthProvider'
import { useOverlayCapabilities } from '@/components/providers/CapabilitiesProvider'
import { useAuth } from '@/contexts/AuthContext'
import { useWorkspace } from '@/contexts/WorkspaceContext'
import { api } from '../../../../../convex/_generated/api'

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
  onConversationListVersion,
  onNotifications,
  workspaceId,
}: {
  accessToken: string | null
  actorUserId: string | null
  enabled: boolean
  onConversationListVersion(version: number): void
  onNotifications(notifications: WorkspaceNotification[]): void
  workspaceId: string | null
}) {
  const args = enabled && accessToken && actorUserId && workspaceId
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
  const personalArgs = enabled && accessToken && actorUserId
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
    onConversationListVersion(Math.max(workspaceVersion, personalVersion))
  }, [listVersion, personalListVersion, onConversationListVersion])

  useEffect(() => {
    if (notificationResult?.ok) {
      onNotifications(notificationResult.notifications as WorkspaceNotification[])
    }
  }, [notificationResult, onNotifications])

  return null
}

export function CollaborationRealtimeProvider({ children }: { children: ReactNode }) {
  const { appDataCapabilities } = useOverlayCapabilities()
  const { user } = useAuth()
  const { activeWorkspaceId } = useWorkspace()
  const accessToken = useConvexAuthToken()
  const visible = usePageVisibility()
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
      setNotifications([])
      setNotificationsReady(false)
      setConversationListVersion(null)
    })
    return () => { alive = false }
  }, [activeWorkspaceId, user?.id])

  const refreshNotifications = useCallback(() => {}, [])

  const handleNotifications = useCallback((next: WorkspaceNotification[]) => {
    setNotifications(next)
    setNotificationsReady(true)
  }, [])

  const value = useMemo(() => ({
    conversationListVersion,
    notifications,
    notificationsReady,
    refreshNotifications,
  }), [conversationListVersion, notifications, notificationsReady, refreshNotifications])

  return (
    <CollaborationRealtimeContext.Provider value={value}>
      {convexEnabled ? (
        <ConvexCollaborationSubscriptions
          accessToken={accessToken}
          actorUserId={user?.id ?? null}
          enabled={visible}
          onConversationListVersion={setConversationListVersion}
          onNotifications={handleNotifications}
          workspaceId={activeWorkspaceId}
        />
      ) : null}
      {children}
    </CollaborationRealtimeContext.Provider>
  )
}

export function useCollaborationRealtime(): CollaborationRealtimeContextValue {
  return useContext(CollaborationRealtimeContext)
}
