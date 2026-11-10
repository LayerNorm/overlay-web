import { useEffect } from 'react'
import { useNativeDataReady } from '../contexts/ConvexAuthProvider'
import { useWorkspace } from '../contexts/WorkspaceContext'
import { subscribeNotifications } from '../services/collaborationService'
import { presentLocalBanner } from '../services/notificationsService'

export function useNotificationWatcher(enabled: boolean): void {
  const ready = useNativeDataReady()
  const { activeWorkspaceId } = useWorkspace()
  useEffect(() => {
    if (!enabled || !ready || !activeWorkspaceId) return
    let seen: Set<string> | null = null
    return subscribeNotifications(items => {
      const previous = seen
      seen = new Set(items.map(item => item.id))
      if (!previous) return
      for (const item of items) {
        if (item.readAt || previous.has(item.id)) continue
        void presentLocalBanner({ title: item.title, body: item.body, data: {
          kind: 'workspace-notification', conversationId: item.conversationId, threadRootMessageId: item.threadRootMessageId,
        } })
      }
    })
  }, [enabled, ready, activeWorkspaceId])
}
