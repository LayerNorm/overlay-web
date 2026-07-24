import { ReactElement, useCallback } from 'react'
import { X } from 'lucide-react'
import { Theme } from '../../utils/theme'

interface UpdateNotificationProps {
  theme: Theme
  version?: string
  onInstall: () => void
  onDismiss: () => void
}

export function UpdateNotification({
  theme,
  version,
  onInstall,
  onDismiss
}: UpdateNotificationProps): ReactElement {
  const handleInstall = useCallback(() => {
    onInstall()
  }, [onInstall])

  const handleDismiss = useCallback(() => {
    onDismiss()
  }, [onDismiss])

  return (
    <div
      style={{
        position: 'fixed',
        bottom: '32px',
        left: '50%',
        transform: 'translateX(-50%)',
        background: theme.surface,
        border: `1px solid ${theme.border}`,
        borderRadius: '12px',
        padding: '14px 16px',
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        zIndex: 9999,
        boxShadow: '0 24px 80px rgba(0, 0, 0, 0.35)',
        animation: 'slideInFromBottom 0.2s ease-out'
      }}
    >
      <style>
        {`
          @keyframes slideInFromBottom {
            from {
              opacity: 0;
              transform: translateX(-50%) translateY(8px);
            }
            to {
              opacity: 1;
              transform: translateX(-50%) translateY(0);
            }
          }
        `}
      </style>

      <div
        style={{
          width: '32px',
          height: '32px',
          borderRadius: '8px',
          background: `linear-gradient(135deg, ${theme.accent || '#0a84ff'}dd, ${theme.accent || '#0a84ff'}88)`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '14px',
          flexShrink: 0,
          boxShadow: `0 4px 12px ${theme.accent || '#0a84ff'}40`
        }}
      >
        ✨
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: '13px',
            fontWeight: 600,
            color: theme.text,
            marginBottom: '2px'
          }}
        >
          Update available
        </div>
        <div
          style={{
            fontSize: '11px',
            color: theme.textSecondary
          }}
        >
          {version ? `v${version} ready` : 'Restart to install'}
        </div>
      </div>

      <button
        onClick={handleInstall}
        style={{
          padding: '6px 12px',
          borderRadius: '8px',
          fontSize: '12px',
          fontWeight: 500,
          fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, sans-serif',
          color: theme.toggleThumb,
          background: theme.buttonBg,
          border: 'none',
          cursor: 'pointer',
          transition: 'background 0.15s ease'
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = theme.buttonHover
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = theme.buttonBg
        }}
      >
        Install
      </button>

      <button
        onClick={handleDismiss}
        style={{
          background: 'transparent',
          border: 'none',
          borderRadius: '6px',
          cursor: 'pointer',
          padding: '6px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          opacity: 0.6,
          transition: 'opacity 0.2s ease'
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.opacity = '1'
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.opacity = '0.6'
        }}
        title="Dismiss"
      >
        <X size={14} color={theme.textSecondary} />
      </button>
    </div>
  )
}
