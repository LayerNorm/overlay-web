import { ReactElement } from 'react'
import { Globe, Trash2 } from 'lucide-react'
import { CookieDomain, Theme } from '../types'

interface SiteInfoCookiesListProps {
  cookieDomains: CookieDomain[]
  theme: Theme
  onDeleteCookiesForDomain: (domain: string) => void
}

export function SiteInfoCookiesList({
  cookieDomains,
  theme,
  onDeleteCookiesForDomain
}: SiteInfoCookiesListProps): ReactElement<any> {
  return (
    <>
      <div style={{ padding: '16px' }}>
        <p
          style={{
            fontSize: 13,
            color: theme.textSecondary,
            margin: '0 0 8px 0',
            lineHeight: 1.5
          }}
        >
          To improve your visit, sites often save your activity – often to your device.
        </p>
      </div>

      <div
        style={{
          padding: '12px 16px',
          background: theme.background
        }}
      >
        <div style={{ fontSize: 13, fontWeight: 600, color: theme.text }}>
          Data from the site you&apos;re visiting
        </div>
        <p
          style={{
            fontSize: 12,
            color: theme.textSecondary,
            margin: '4px 0 0 0',
            lineHeight: 1.4
          }}
        >
          A site might save your preferred language or items you want to buy.
        </p>
      </div>

      {cookieDomains.map((item) => (
        <div
          key={item.domain}
          style={{
            padding: '12px 16px',
            display: 'flex',
            alignItems: 'center',
            gap: 12
          }}
        >
          <Globe size={20} color={theme.textSecondary} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                fontSize: 13,
                color: theme.text,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis'
              }}
            >
              {item.domain}
            </div>
          </div>
          <button
            onClick={() => onDeleteCookiesForDomain(item.domain)}
            style={{
              background: 'transparent',
              border: 'none',
              padding: 6,
              cursor: 'pointer',
              borderRadius: 4,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}
            title="Delete cookies for this domain"
          >
            <Trash2 size={16} color={theme.textSecondary} />
          </button>
        </div>
      ))}

      {cookieDomains.length === 0 && (
        <div
          style={{
            padding: 16,
            color: theme.textSecondary,
            textAlign: 'center',
            fontSize: 13
          }}
        >
          No cookies found for this site
        </div>
      )}
    </>
  )
}
