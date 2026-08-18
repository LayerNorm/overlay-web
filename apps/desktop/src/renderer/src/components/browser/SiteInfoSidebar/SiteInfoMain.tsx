import { ReactElement } from 'react'
import { Lock, LockOpen, Cookie, Shield, Settings, ChevronRight, ExternalLink } from 'lucide-react'
import { Theme } from '../types'

interface SiteInfoMainProps {
  isSecure: boolean
  theme: Theme
  onNavigateToCookies: () => void
  onNavigateToPermissions: () => void
}

export function SiteInfoMain({
  isSecure,
  theme,
  onNavigateToCookies,
  onNavigateToPermissions
}: SiteInfoMainProps): ReactElement<any> {
  return (
    <>
      {/* Connection security */}
      <div
        style={{
          padding: '16px',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          cursor: 'default'
        }}
      >
        {isSecure ? (
          <Lock size={20} color={theme.textSecondary} />
        ) : (
          <LockOpen size={20} color={theme.textSecondary} />
        )}
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 14, color: theme.text }}>
            {isSecure ? 'Connection is secure' : 'Connection is not secure'}
          </div>
        </div>
        <ChevronRight size={16} color={theme.textSecondary} />
      </div>

      {/* Cookies and site data */}
      <div
        onClick={onNavigateToCookies}
        style={{
          padding: '16px',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          cursor: 'pointer'
        }}
      >
        <Cookie size={20} color={theme.textSecondary} />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 14, color: theme.text }}>Cookies and site data</div>
        </div>
        <ChevronRight size={16} color={theme.textSecondary} />
      </div>

      {/* Permissions for this site */}
      <div
        onClick={onNavigateToPermissions}
        style={{
          padding: '16px',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          cursor: 'pointer'
        }}
      >
        <Shield size={20} color={theme.textSecondary} />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 14, color: theme.text }}>Permissions for this site</div>
        </div>
        <ChevronRight size={16} color={theme.textSecondary} />
      </div>

      {/* Site settings - placeholder */}
      <div
        style={{
          padding: '16px',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          cursor: 'default',
          opacity: 0.5
        }}
      >
        <Settings size={20} color={theme.textSecondary} />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 14, color: theme.text }}>Site settings</div>
        </div>
        <ExternalLink size={16} color={theme.textSecondary} />
      </div>
    </>
  )
}
