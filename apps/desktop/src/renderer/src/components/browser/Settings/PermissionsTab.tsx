import { ReactElement } from 'react'
import { Shield, Globe, ChevronRight, ChevronDown, Trash2 } from 'lucide-react'
import { SavedPermission, Theme } from '../types'

interface PermissionsTabProps {
  savedPermissions: SavedPermission[]
  expandedOrigin: string | null
  theme: Theme
  onLoad: () => void
  onExpandOrigin: (origin: string | null) => void
  onDeleteForOrigin: (origin: string) => void
  onDeletePermission: (origin: string, permission: string) => void
}

export function PermissionsTab({
  savedPermissions,
  expandedOrigin,
  theme,
  onLoad,
  onExpandOrigin,
  onDeleteForOrigin,
  onDeletePermission
}: PermissionsTabProps): ReactElement<any> {
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
        Site Permissions
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
        Manage permissions you&apos;ve granted to websites, such as camera, microphone, and location
        access.
      </p>

      <div style={{ display: 'flex', gap: 12, marginBottom: 24 }}>
        <button
          onClick={onLoad}
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
          <Shield size={16} />
          Load Permissions
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
            Sites with saved permissions ({savedPermissions.length})
          </div>
        </div>

        <div style={{ maxHeight: 500, overflowY: 'auto' }}>
          {savedPermissions.length === 0 ? (
            <div
              style={{
                padding: 24,
                textAlign: 'center',
                color: theme.textSecondary,
                fontSize: 14,
                fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, sans-serif'
              }}
            >
              No saved permissions. Click &quot;Load Permissions&quot; to refresh.
            </div>
          ) : (
            savedPermissions.map((site) => (
              <div key={site.origin}>
                <div
                  onClick={() => {
                    if (expandedOrigin === site.origin) {
                      onExpandOrigin(null)
                    } else {
                      onExpandOrigin(site.origin)
                    }
                  }}
                  style={{
                    padding: '12px 16px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    cursor: 'pointer',
                    background: expandedOrigin === site.origin ? theme.background : 'transparent'
                  }}
                >
                  {expandedOrigin === site.origin ? (
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
                      {site.origin}
                    </div>
                    <div
                      style={{
                        fontSize: 12,
                        color: theme.textSecondary,
                        fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, sans-serif'
                      }}
                    >
                      {site.permissions.length} permission{site.permissions.length !== 1 ? 's' : ''}
                    </div>
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      onDeleteForOrigin(site.origin)
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

                {expandedOrigin === site.origin && (
                  <div
                    style={{
                      background: theme.background
                    }}
                  >
                    {site.permissions.map((perm) => (
                      <div
                        key={perm.permission}
                        style={{
                          padding: '10px 16px 10px 56px',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          fontSize: 13,
                          fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, sans-serif'
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ color: theme.text, textTransform: 'capitalize' }}>
                            {perm.permission}
                          </span>
                          <span
                            style={{
                              padding: '2px 6px',
                              borderRadius: 4,
                              fontSize: 11,
                              background: perm.granted
                                ? 'rgba(34, 197, 94, 0.1)'
                                : 'rgba(239, 68, 68, 0.1)',
                              color: perm.granted ? '#22c55e' : '#ef4444'
                            }}
                          >
                            {perm.granted ? 'Allowed' : 'Denied'}
                          </span>
                        </div>
                        <button
                          onClick={() => onDeletePermission(site.origin, perm.permission)}
                          style={{
                            padding: '4px 8px',
                            borderRadius: 4,
                            border: 'none',
                            background: 'transparent',
                            color: theme.textSecondary,
                            fontSize: 12,
                            cursor: 'pointer'
                          }}
                        >
                          <Trash2 size={14} />
                        </button>
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
