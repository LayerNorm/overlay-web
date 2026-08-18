import { ReactElement } from 'react'
import { Database, ExternalLink } from 'lucide-react'
import { Theme } from '../types'

interface SiteInfoCookiesProps {
  cookieDomainsCount: number
  theme: Theme
  onNavigateToCookiesList: () => void
}

export function SiteInfoCookies({
  cookieDomainsCount,
  theme,
  onNavigateToCookiesList
}: SiteInfoCookiesProps): ReactElement<any> {
  return (
    <>
      <div
        style={{
          padding: '16px'
        }}
      >
        <p
          style={{
            fontSize: 13,
            color: theme.textSecondary,
            margin: 0,
            lineHeight: 1.5
          }}
        >
          Cookies and other site data are used to remember you, for example to sign you in or to
          personalize ads. To manage cookies for all sites, see Settings.
        </p>
      </div>

      <div
        onClick={onNavigateToCookiesList}
        style={{
          padding: '16px',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          cursor: 'pointer'
        }}
      >
        <Database size={20} color={theme.textSecondary} />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 14, color: theme.text }}>Manage on-device site data</div>
          <div style={{ fontSize: 12, color: theme.textSecondary }}>
            {cookieDomainsCount} sites allowed
          </div>
        </div>
        <ExternalLink size={16} color={theme.textSecondary} />
      </div>
    </>
  )
}
