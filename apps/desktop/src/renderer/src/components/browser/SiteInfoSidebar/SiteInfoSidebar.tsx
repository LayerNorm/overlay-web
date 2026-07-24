import { ReactElement, useState, useEffect } from 'react'
import { X, ArrowLeft } from 'lucide-react'
import { Theme, SiteInfoView, CookieDomain, SitePermission } from '../types'
import { SiteInfoMain } from './SiteInfoMain'
import { SiteInfoCookies } from './SiteInfoCookies'
import { SiteInfoCookiesList } from './SiteInfoCookiesList'
import { SiteInfoPermissions } from './SiteInfoPermissions'

interface SiteInfoSidebarProps {
  currentUrl: string | undefined
  isSecure: boolean
  theme: Theme
  onClose: () => void
}

export function SiteInfoSidebar({
  currentUrl,
  isSecure,
  theme,
  onClose
}: SiteInfoSidebarProps): ReactElement {
  const [view, setView] = useState<SiteInfoView>('main')
  const [cookieDomains, setCookieDomains] = useState<CookieDomain[]>([])
  const [sitePermissions, setSitePermissions] = useState<SitePermission[]>([])

  const currentHostname = currentUrl
    ? (() => {
        try {
          return new URL(currentUrl).hostname
        } catch {
          return currentUrl
        }
      })()
    : ''

  const loadCookieDomains = async (): Promise<void> => {
    if (currentUrl) {
      const domains = await window.bridge.browser.getCookieDomains(currentUrl)
      setCookieDomains(domains)
    }
  }

  useEffect(() => {
    if (currentUrl) {
      loadCookieDomains()
    }
  }, [currentUrl])

  const handleDeleteCookiesForDomain = async (domain: string): Promise<void> => {
    await window.bridge.browser.deleteCookiesForDomain(domain)
    await loadCookieDomains()
  }

  const loadSitePermissions = async (): Promise<void> => {
    if (currentUrl) {
      try {
        const origin = new URL(currentUrl).origin
        const allPerms = await window.bridge.browser.getAllPermissions()
        const sitePerms = allPerms.find((p) => p.origin === origin)
        setSitePermissions(sitePerms?.permissions || [])
      } catch {
        setSitePermissions([])
      }
    }
  }

  const handleDeletePermission = async (permission: string): Promise<void> => {
    if (currentUrl) {
      try {
        const origin = new URL(currentUrl).origin
        await window.bridge.browser.deletePermission(origin, permission)
        await loadSitePermissions()
      } catch {
        // ignore
      }
    }
  }

  const handleBack = (): void => {
    if (view === 'cookies-list') {
      setView('cookies')
    } else {
      setView('main')
    }
  }

  const getTitle = (): string => {
    switch (view) {
      case 'main':
        return currentHostname
      case 'cookies':
        return 'Cookies and site data'
      case 'cookies-list':
        return 'On-device site data'
      case 'permissions':
        return 'Permissions for this site'
    }
  }

  return (
    <div
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        bottom: 0,
        width: 280,
        background: theme.surface,
        display: 'flex',
        flexDirection: 'column',
        fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, sans-serif',
        zIndex: 50,
        animation: 'slideInLeft 0.15s ease-out'
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          padding: '12px 16px',
          gap: 12
        }}
      >
        {view !== 'main' && (
          <button
            onClick={handleBack}
            style={{
              background: 'transparent',
              border: 'none',
              padding: 4,
              cursor: 'pointer',
              borderRadius: 4,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}
          >
            <ArrowLeft size={16} color={theme.text} />
          </button>
        )}
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 600, color: theme.text, fontSize: 14 }}>{getTitle()}</div>
          {(view === 'cookies' || view === 'permissions') && (
            <div style={{ fontSize: 12, color: theme.textSecondary }}>{currentHostname}</div>
          )}
        </div>
        <button
          onClick={onClose}
          style={{
            background: 'transparent',
            border: 'none',
            padding: 4,
            cursor: 'pointer',
            borderRadius: 4,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}
        >
          <X size={16} color={theme.textSecondary} />
        </button>
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {view === 'main' && (
          <SiteInfoMain
            isSecure={isSecure}
            theme={theme}
            onNavigateToCookies={() => setView('cookies')}
            onNavigateToPermissions={() => {
              loadSitePermissions()
              setView('permissions')
            }}
          />
        )}

        {view === 'cookies' && (
          <SiteInfoCookies
            cookieDomainsCount={cookieDomains.length}
            theme={theme}
            onNavigateToCookiesList={() => {
              loadCookieDomains()
              setView('cookies-list')
            }}
          />
        )}

        {view === 'cookies-list' && (
          <SiteInfoCookiesList
            cookieDomains={cookieDomains}
            theme={theme}
            onDeleteCookiesForDomain={handleDeleteCookiesForDomain}
          />
        )}

        {view === 'permissions' && (
          <SiteInfoPermissions
            permissions={sitePermissions}
            theme={theme}
            onDeletePermission={handleDeletePermission}
          />
        )}
      </div>

      {/* Footer - Done button for cookies-list view */}
      {view === 'cookies-list' && (
        <div
          style={{
            padding: '12px 16px',
            borderTop: `1px solid ${theme.border}`,
            display: 'flex',
            justifyContent: 'flex-end'
          }}
        >
          <button
            onClick={onClose}
            style={{
              padding: '8px 20px',
              borderRadius: 20,
              border: 'none',
              background: '#4ade80',
              color: '#000',
              fontSize: 13,
              fontWeight: 500,
              cursor: 'pointer'
            }}
          >
            Done
          </button>
        </div>
      )}
    </div>
  )
}
