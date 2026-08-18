import { ReactElement } from 'react'
import { Database, Globe, ChevronRight, ChevronDown, Trash2 } from 'lucide-react'
import { CookieDomain, CookieDetail, Theme } from '../types'

interface CookiesTabProps {
  allCookieDomains: CookieDomain[]
  expandedCookieDomain: string | null
  domainCookies: CookieDetail[]
  theme: Theme
  onLoadAll: () => void
  onExpandDomain: (domain: string | null) => void
  onLoadDomainCookies: (domain: string) => Promise<CookieDetail[]>
  onDeleteForDomain: (domain: string) => void
}

export function CookiesTab({
  allCookieDomains,
  expandedCookieDomain,
  domainCookies,
  theme,
  onLoadAll,
  onExpandDomain,
  onLoadDomainCookies,
  onDeleteForDomain
}: CookiesTabProps): ReactElement<any> {
  const handleExpandDomain = async (domain: string): Promise<void> => {
    if (expandedCookieDomain === domain) {
      onExpandDomain(null)
    } else {
      onExpandDomain(domain)
      await onLoadDomainCookies(domain)
    }
  }

  return (
    <div style={{ maxWidth: 700 }}>
      <h2
        style={{
          margin: '0 0 16px',
          fontSize: 18,
          fontWeight: 600,
          color: theme.text,
          fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, sans-serif'
        }}
      >
        Cookies & Site Data
      </h2>
      <p
        style={{
          fontSize: 14,
          color: theme.textSecondary,
          margin: '0 0 24px',
          lineHeight: 1.5,
          fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, sans-serif'
        }}
      >
        View and manage cookies stored by all websites. Click on a site to see its individual
        cookies.
      </p>

      <div style={{ display: 'flex', gap: 12, marginBottom: 24 }}>
        <button
          onClick={onLoadAll}
          style={{
            padding: '10px 16px',
            borderRadius: 8,
            border: `1px solid ${theme.border}`,
            background: theme.surface,
            color: theme.text,
            fontSize: 13,
            fontFamily: 'system-ui, -apple-system, sans-serif',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 8
          }}
        >
          <Database size={16} />
          Load All Cookies
        </button>
      </div>

      <div
        style={{
          background: theme.surface,
          borderRadius: 8,
          border: `1px solid ${theme.border}`,
          overflow: 'hidden'
        }}
      >
        <div
          style={{
            padding: '12px 16px',
            borderBottom: `1px solid ${theme.border}`,
            background: theme.background
          }}
        >
          <div
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: theme.text,
              fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, sans-serif'
            }}
          >
            All sites with cookies ({allCookieDomains.length})
          </div>
        </div>

        <div style={{ maxHeight: 500, overflowY: 'auto' }}>
          {allCookieDomains.length === 0 ? (
            <div
              style={{
                padding: 24,
                textAlign: 'center',
                color: theme.textSecondary,
                fontSize: 14,
                fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, sans-serif'
              }}
            >
              No cookies found. Click &quot;Load All Cookies&quot; to refresh.
            </div>
          ) : (
            allCookieDomains.map((item) => (
              <div key={item.domain}>
                <div
                  onClick={() => handleExpandDomain(item.domain)}
                  style={{
                    padding: '12px 16px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    cursor: 'pointer',
                    background:
                      expandedCookieDomain === item.domain ? theme.background : 'transparent'
                  }}
                >
                  {expandedCookieDomain === item.domain ? (
                    <ChevronDown size={16} color={theme.textSecondary} />
                  ) : (
                    <ChevronRight size={16} color={theme.textSecondary} />
                  )}
                  <Globe size={18} color={theme.textSecondary} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: 14,
                        color: theme.text,
                        fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, sans-serif'
                      }}
                    >
                      {item.domain}
                    </div>
                    <div
                      style={{
                        fontSize: 12,
                        color: theme.textSecondary,
                        fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, sans-serif'
                      }}
                    >
                      {item.cookieCount} cookie{item.cookieCount !== 1 ? 's' : ''}
                    </div>
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      onDeleteForDomain(item.domain)
                    }}
                    style={{
                      padding: '6px 12px',
                      borderRadius: 6,
                      border: 'none',
                      background: 'rgba(239, 68, 68, 0.1)',
                      color: '#ef4444',
                      fontSize: 12,
                      fontFamily: 'system-ui, -apple-system, sans-serif',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 4
                    }}
                  >
                    <Trash2 size={14} />
                    Delete All
                  </button>
                </div>

                {expandedCookieDomain === item.domain && domainCookies.length > 0 && (
                  <div
                    style={{
                      background: theme.background
                    }}
                  >
                    {domainCookies.map((cookie, idx) => (
                      <div
                        key={`${cookie.name}-${idx}`}
                        style={{
                          padding: '10px 16px 10px 56px',
                          fontSize: 13,
                          fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, sans-serif'
                        }}
                      >
                        <div
                          style={{
                            fontWeight: 600,
                            color: theme.text,
                            marginBottom: 4
                          }}
                        >
                          {cookie.name}
                        </div>
                        <div
                          style={{
                            color: theme.textSecondary,
                            fontSize: 12,
                            wordBreak: 'break-all',
                            marginBottom: 4
                          }}
                        >
                          {cookie.value.length > 100
                            ? cookie.value.substring(0, 100) + '...'
                            : cookie.value}
                        </div>
                        <div
                          style={{
                            display: 'flex',
                            gap: 12,
                            fontSize: 11,
                            color: theme.textSecondary
                          }}
                        >
                          <span>Path: {cookie.path}</span>
                          {cookie.secure && <span>🔒 Secure</span>}
                          {cookie.httpOnly && <span>HTTP Only</span>}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
