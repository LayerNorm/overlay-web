import { useEffect } from 'react'
import { useNativeDataReady } from '../contexts/ConvexAuthProvider'
import { useWorkspace } from '../contexts/WorkspaceContext'
import { subscribeNotifications } from '../services/collaborationService'
import { presentLocalBanner } from '../services/notificationsService'
import { useAuth } from '../contexts/AuthContext'
import { allowsBanner, loadBannerPreferences } from '../services/bannerPreferencesService'

export function useNotificationWatcher(enabled: boolean): void {
  const ready = useNativeDataReady()
  const { user } = useAuth()
  const { activeWorkspaceId } = useWorkspace()
  useEffect(() => {
    if (!enabled || !ready || !activeWorkspaceId || !user?.id) return
    let active = true
    let seen: Set<string> | null = null
    const stop = subscribeNotifications(items => {
      const previous = seen
      seen = new Set(items.map(item => item.id))
      if (!previous) return
      for (const item of items) {
        if (item.readAt || previous.has(item.id)) continue
        void loadBannerPreferences(user.id).then(preferences => active && allowsBanner(preferences, item.type, item.conversationType) ? presentLocalBanner({ title: item.title, body: item.body, data: {
          kind: 'workspace-notification', conversationId: item.conversationId, threadRootMessageId: item.threadRootMessageId,
        } }) : undefined).catch(() => undefined)
      }
    })
    return () => { active = false; stop() }
  }, [enabled, ready, activeWorkspaceId, user?.id])
}
