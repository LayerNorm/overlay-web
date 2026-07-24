import { useState, useEffect, ReactElement } from 'react'
import { X } from 'lucide-react'
import { usePanelTheme } from '../../hooks/usePanelTheme'
import logoImage from '../../../../../resources/logos/logo-big-no-bg.png'

export interface NotificationItem {
  id: string
  type: 'success' | 'error'
  title: string
  summary: string
  trace: string[]
  timestamp: number
}

interface NotificationCardProps {
  notification: NotificationItem
  onDismiss: (id: string) => void
  autoDismissSeconds: number
}

function NotificationCard({
  notification,
  onDismiss,
  autoDismissSeconds
}: NotificationCardProps): ReactElement {
  const { isDarkMode } = usePanelTheme()
  const [progress, setProgress] = useState(100)

  useEffect(() => {
    const startTime = Date.now()
    const duration = autoDismissSeconds * 1000

    const interval = setInterval(() => {
      const elapsed = Date.now() - startTime
      const remaining = Math.max(0, 100 - (elapsed / duration) * 100)
      setProgress(remaining)

      if (remaining <= 0) {
        clearInterval(interval)
        onDismiss(notification.id)
      }
    }, 50)

    return () => clearInterval(interval)
  }, [notification.id, autoDismissSeconds, onDismiss])

  const borderColor = notification.type === 'success' ? '#22c55e' : '#ef4444'
  const bgColor = isDarkMode ? '#1a1a1a' : '#ffffff'
  const textColor = isDarkMode ? '#ffffff' : '#000000'
  const textSecondary = isDarkMode ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.6)'

  return (
    <div
      style={{
        background: bgColor,
        border: 'none',
        borderRadius: 12,
        padding: 12,
        minWidth: 240,
        maxWidth: 280,
        boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
        position: 'relative',
        overflow: 'hidden',
        fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, sans-serif'
      }}
    >
      {/* Progress bar */}
      <div
        style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          height: 3,
          width: `${progress}%`,
          background: borderColor,
          transition: 'width 50ms linear',
          opacity: 0.6
        }}
      />

      {/* Close button - top right */}
      <button
        onClick={() => onDismiss(notification.id)}
        style={{
          position: 'absolute',
          top: 8,
          right: 8,
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          padding: 4,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: 4,
          color: textSecondary,
          zIndex: 1
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = isDarkMode
            ? 'rgba(255,255,255,0.1)'
            : 'rgba(0,0,0,0.1)'
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = 'transparent'
        }}
      >
        <X size={14} />
      </button>

      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          marginBottom: 0,
          paddingRight: 24
        }}
      >
        {/* Overlay logo */}
        <img
          src={logoImage}
          alt="Overlay"
          style={{
            width: 28,
            height: 28,
            flexShrink: 0,
            objectFit: 'contain'
          }}
        />

        {/* Title only */}
        <div
          style={{
            flex: 1,
            minWidth: 0,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center'
          }}
        >
          <div
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: textColor
            }}
          >
            {notification.title}
          </div>
        </div>
      </div>
    </div>
  )
}

interface NotificationPanelProps {
  notifications: NotificationItem[]
  onDismiss: (id: string) => void
  autoDismissSeconds: number
}

export function NotificationPanel({
  notifications,
  onDismiss,
  autoDismissSeconds
}: NotificationPanelProps): ReactElement {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-end',
        gap: 8,
        padding: '8px 0 8px 8px'
      }}
    >
      {notifications.map((notification) => (
        <NotificationCard
          key={notification.id}
          notification={notification}
          onDismiss={onDismiss}
          autoDismissSeconds={autoDismissSeconds}
        />
      ))}
    </div>
  )
}
