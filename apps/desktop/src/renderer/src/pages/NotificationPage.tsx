import { useState, useEffect, useCallback, ReactElement } from 'react'
import { NotificationPanel, NotificationItem } from '../components/notifications'

export function NotificationPage(): ReactElement {
  const [notifications, setNotifications] = useState<NotificationItem[]>([])
  const [autoDismissSeconds, setAutoDismissSeconds] = useState(3)

  useEffect(() => {
    // Load settings
    const saved = localStorage.getItem('overlay-settings')
    if (saved) {
      const settings = JSON.parse(saved)
      setAutoDismissSeconds(settings.notificationAutoDismissSeconds ?? 3)
    }

    // Listen for new notifications from main process
    const unsubscribe = window.bridge?.onNotification?.((data: {
      id: string
      type: 'success' | 'error'
      title: string
      summary: string
      trace: string[]
    }) => {
      const notification: NotificationItem = {
        ...data,
        timestamp: Date.now()
      }
      setNotifications((prev) => [...prev, notification])
    })

    // Listen for settings changes
    const handleStorageChange = (e: StorageEvent): void => {
      if (e.key === 'overlay-settings' && e.newValue) {
        const settings = JSON.parse(e.newValue)
        setAutoDismissSeconds(settings.notificationAutoDismissSeconds ?? 3)
      }
    }
    window.addEventListener('storage', handleStorageChange)

    return () => {
      unsubscribe?.()
      window.removeEventListener('storage', handleStorageChange)
    }
  }, [])

  const handleDismiss = useCallback((id: string) => {
    setNotifications((prev) => prev.filter((n) => n.id !== id))
    // Notify main process to potentially close window if no more notifications
    window.bridge?.dismissNotification?.(id)
  }, [])

  // Close window when no notifications left
  useEffect(() => {
    if (notifications.length === 0) {
      // Small delay to allow for new notifications
      const timeout = setTimeout(() => {
        if (notifications.length === 0) {
          window.bridge?.closeNotificationWindow?.()
        }
      }, 100)
      return () => clearTimeout(timeout)
    }
  }, [notifications.length])

  return (
    <div
      style={{
        width: '100vw',
        height: '100vh',
        background: 'transparent',
        overflow: 'hidden'
      }}
    >
      <NotificationPanel
        notifications={notifications}
        onDismiss={handleDismiss}
        autoDismissSeconds={autoDismissSeconds}
      />
    </div>
  )
}
