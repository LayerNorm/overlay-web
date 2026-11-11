import { useEffect, useRef } from 'react'
import { Alert, Platform } from 'react-native'
import { router } from 'expo-router'
import * as Notifications from 'expo-notifications'
import { useAuth } from '../contexts/AuthContext'
import { useNativeDataReady } from '../contexts/ConvexAuthProvider'
import { useWorkspace } from '../contexts/WorkspaceContext'
import { startPushRegistration } from '../services/pushRegistrationService'
import {
  openNotificationDestination,
  openPushNotificationDestination,
} from '../lib/notificationRouting'

export function usePushNotifications() {
  const { user } = useAuth()
  const ready = useNativeDataReady()
  const { switchWorkspace } = useWorkspace()
  const mounted = useRef(true)
  const currentUser = useRef(user?.id)
  currentUser.current = user?.id
  const handling = useRef(new Set<string>())
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  useEffect(
    () => (ready && user?.id ? startPushRegistration(user.id) : undefined),
    [ready, user?.id],
  )
  useEffect(() => {
    if (!ready || !user?.id || Platform.OS === 'web') return
    const userId = user.id
    const current = () => mounted.current && currentUser.current === userId
    const handle = async (response: Notifications.NotificationResponse | null) => {
      if (!response || !current()) return
      const id = response.notification.request.identifier
      if (handling.current.has(id)) return
      handling.current.add(id)
      try {
        const data = response.notification.request.content.data ?? {}
        if (typeof data.url === 'string')
          await openPushNotificationDestination(router, data.url, switchWorkspace, current)
        else if (data.kind === 'workspace-notification' && typeof data.conversationId === 'string')
          await openNotificationDestination(
            router,
            {
              conversationId: data.conversationId,
              threadRootMessageId:
                typeof data.threadRootMessageId === 'string' ? data.threadRootMessageId : undefined,
            },
            current,
          )
        if (current()) await Notifications.clearLastNotificationResponseAsync()
      } catch {
        if (current())
          Alert.alert('Could not open notification', 'Check your connection and workspace access.')
      } finally {
        handling.current.delete(id)
      }
    }
    const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
      void handle(response)
    })
    void Notifications.getLastNotificationResponseAsync()
      .then(handle)
      .catch(() => undefined)
    return () => subscription.remove()
  }, [ready, user?.id, switchWorkspace])
}
